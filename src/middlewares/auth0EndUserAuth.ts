import { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { AuthenticatedLocals, getAuth0Email } from './auth0BearerAuth';

const END_USER_MIDDLEWARE_VERSION = '2026-08-10-1';
const isAuth0DebugEnabled = (): boolean => process.env.AUTH0_DEBUG === 'true';

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

let cachedIssuer = '';
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

const getJwks = (issuer: string): ReturnType<typeof createRemoteJWKSet> => {
  if (cachedJwks && cachedIssuer === issuer) {
    return cachedJwks;
  }

  cachedIssuer = issuer;
  cachedJwks = createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));

  return cachedJwks;
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
    const verified = await jwtVerify(token, getJwks(issuer), {
      issuer,
      audience: audiences,
      algorithms: ['RS256'],
    });

    payload = verified.payload as Record<string, unknown>;
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
