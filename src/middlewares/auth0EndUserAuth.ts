import { NextFunction, Request, Response } from 'express';
import jwt, { Algorithm, JwtPayload, VerifyErrors, VerifyOptions } from 'jsonwebtoken';

import { AuthenticatedLocals, getAuth0Email } from './auth0BearerAuth';

const END_USER_MIDDLEWARE_VERSION = '2026-08-10-2';
const isAuth0DebugEnabled = (): boolean => process.env.AUTH0_DEBUG === 'true';

// NOTE: the JWKS/PEM helpers below mirror auth0BearerAuth.ts rather than being
// shared. That duplication is deliberate — it keeps the machine-to-machine
// middleware guarding the distributor routes completely untouched. Do not
// replace this with `jose`: it is ESM-only from v6, and this service compiles to
// CommonJS, so requiring it crashes the Lambda at init.

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const resolveIssuer = (): string | undefined => {
  const issuerFromEnv = process.env.AUTH0_ISSUER_BASE_URL || process.env.AUTH0_ISSUER;

  if (issuerFromEnv) {
    return `${trimTrailingSlash(issuerFromEnv)}/`;
  }

  if (!process.env.AUTH0_DOMAIN) {
    return undefined;
  }

  const normalizedDomain = trimTrailingSlash(process.env.AUTH0_DOMAIN).replace(/^https?:\/\//, '');

  return `https://${normalizedDomain}/`;
};

// An Auth0 ID token is addressed to the SPA client, so its `aud` is the client
// id — not the API identifier that machine tokens carry. Listing the browser
// clients here is what lets a logged-in user call this API without the SPA
// having to request an API-audience access token.
const resolveEndUserAudiences = (): string[] => {
  const clientIds = (process.env.AUTH0_SPA_CLIENT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const apiAudience = process.env.AUTH0_AUDIENCE;

  // An API-audience access token carrying the email claim is still valid here,
  // so both token shapes work on end-user routes.
  return apiAudience ? [...clientIds, apiAudience] : clientIds;
};

const base64UrlDecode = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);

  return Buffer.from(`${base64}${padding}`, 'base64').toString('utf-8');
};

const parseJwtHeader = (token: string): { kid?: string } => {
  const [encodedHeader] = token.split('.');

  if (!encodedHeader) {
    return {};
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedHeader)) as Record<string, unknown>;

    return { kid: typeof parsed.kid === 'string' ? parsed.kid : undefined };
  } catch {
    return {};
  }
};

const certToPem = (cert: string): string => {
  const wrapped = cert.match(/.{1,64}/g)?.join('\n') || cert;

  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----`;
};

let cachedIssuer = '';
let cachedJwksByKid: Map<string, string> | undefined;

const getJwksByKid = async (issuer: string): Promise<Map<string, string>> => {
  if (cachedJwksByKid && cachedIssuer === issuer) {
    return cachedJwksByKid;
  }

  const response = await fetch(`${issuer}.well-known/jwks.json`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`failed to fetch jwks: ${response.status}`);
  }

  const payload = (await response.json()) as {
    keys?: Array<{ kid?: string; x5c?: string[] }>;
  };

  const keyMap = new Map<string, string>();

  (payload.keys || []).forEach((key) => {
    if (!key.kid || !Array.isArray(key.x5c) || key.x5c.length === 0) {
      return;
    }

    keyMap.set(key.kid, certToPem(String(key.x5c[0])));
  });

  cachedIssuer = issuer;
  cachedJwksByKid = keyMap;

  return keyMap;
};

const verifyEndUserToken = async (
  token: string,
  issuer: string,
  audiences: string[],
): Promise<Record<string, unknown>> => {
  const header = parseJwtHeader(token);

  if (!header.kid) {
    throw new Error('missing kid in token header');
  }

  const jwksByKid = await getJwksByKid(issuer);
  const signingKey = jwksByKid.get(header.kid);

  if (!signingKey) {
    throw new Error('signing key not found for token kid');
  }

  const verifyOptions: VerifyOptions = {
    algorithms: ['RS256'] as Algorithm[],
    issuer,
    // jsonwebtoken accepts a list and passes when aud matches any entry; its
    // type is a non-empty tuple, and resolveEndUserAudiences guarantees that.
    audience: audiences as [string, ...string[]],
  };

  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      signingKey,
      verifyOptions,
      (error: VerifyErrors | null, decoded?: JwtPayload | string) => {
        if (error) {
          reject(error);
          return;
        }

        if (!decoded || typeof decoded === 'string') {
          reject(new Error('invalid JWT payload'));
          return;
        }

        resolve(decoded as Record<string, unknown>);
      },
    );
  });
};

const extractBearerToken = (authorizationHeader?: string): string | undefined => {
  if (!authorizationHeader) {
    return undefined;
  }

  const [scheme, token] = authorizationHeader.split(' ');

  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return undefined;
  }

  return token;
};

const deny = (
  res: Response<unknown, AuthenticatedLocals>,
  status: number,
  message: string,
  reason: string,
  extra?: Record<string, unknown>,
): Response =>
  res.status(status).json({
    success: false,
    message,
    ...(isAuth0DebugEnabled()
      ? {
          debug: {
            reason,
            middlewareVersion: END_USER_MIDDLEWARE_VERSION,
            ...extra,
          },
        }
      : {}),
  });

/**
 * Authorizes a logged-in end user (browser session), as opposed to
 * `requireAuth0Bearer`, which authorizes machine-to-machine callers against the
 * API audience. Keep the two separate: widening the M2M middleware to accept
 * browser tokens would let any signed-in user reach the distributor routes.
 */
export const requireAuth0EndUser = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
  next: NextFunction,
): Promise<void | Response> => {
  res.setHeader('x-auth0-enduser-middleware-version', END_USER_MIDDLEWARE_VERSION);

  const requestPath = req.originalUrl || req.url;
  const token = extractBearerToken(req.header('authorization'));

  if (!token) {
    console.error('[auth0EndUser] missing bearer token', {
      path: requestPath,
      method: req.method,
      hasAuthorizationHeader: Boolean(req.header('authorization')),
    });

    return deny(
      res,
      401,
      'missing or invalid authorization bearer token',
      'MISSING_OR_INVALID_BEARER_TOKEN',
    );
  }

  const issuer = resolveIssuer();

  if (!issuer) {
    console.error('[auth0EndUser] issuer not configured', {
      path: requestPath,
      method: req.method,
    });

    return deny(res, 500, 'auth0 issuer is not configured', 'ISSUER_NOT_CONFIGURED');
  }

  const audiences = resolveEndUserAudiences();

  if (audiences.length === 0) {
    console.error('[auth0EndUser] no end-user audience configured', {
      path: requestPath,
      method: req.method,
      hasSpaClientIds: Boolean(process.env.AUTH0_SPA_CLIENT_IDS),
      hasAuth0Audience: Boolean(process.env.AUTH0_AUDIENCE),
    });

    return deny(res, 500, 'auth0 audience is not configured', 'AUDIENCE_NOT_CONFIGURED');
  }

  let payload: Record<string, unknown>;

  try {
    payload = await verifyEndUserToken(token, issuer, audiences);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'unknown error';

    console.error('[auth0EndUser] token verification failed', {
      path: requestPath,
      method: req.method,
      issuer,
      errorName,
      errorMessage,
    });

    return deny(res, 401, 'invalid or expired access token', 'JWT_VERIFY_FAILED', {
      errorName,
      errorMessage,
      issuer,
    });
  }

  // ID tokens carry `email` natively; access tokens only have it when a tenant
  // Action stamps the namespaced claim. getAuth0Email handles both.
  const email = getAuth0Email(payload);

  if (!email) {
    return deny(res, 403, 'token does not carry an email claim', 'EMAIL_CLAIM_MISSING');
  }

  // The email is the identity a SIM gets attached to, so an unverified one must
  // not be trusted — otherwise signing up with someone else's address would be
  // enough to claim their SIM.
  if (payload.email_verified === false) {
    return deny(res, 403, 'email address is not verified', 'EMAIL_NOT_VERIFIED');
  }

  res.locals.auth = payload;

  next();
};
