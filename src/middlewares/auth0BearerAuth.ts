import { NextFunction, Request, Response } from 'express';
import jwt, {
  Algorithm,
  JwtHeader,
  JwtPayload,
  SigningKeyCallback,
  VerifyErrors,
  VerifyOptions,
} from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';

const AUTH0_MIDDLEWARE_VERSION = '2026-03-04-2';
const isAuth0DebugEnabled = (): boolean => process.env.AUTH0_DEBUG === 'true';

export type AuthenticatedLocals = {
  auth?: Record<string, unknown>;
};

export const getAuth0ClientId = (payload?: Record<string, unknown>): string | undefined => {
  if (!payload) {
    return undefined;
  }

  if (typeof payload.client_id === 'string') {
    return payload.client_id;
  }

  if (typeof payload.azp === 'string') {
    return payload.azp;
  }

  if (typeof payload.sub === 'string') {
    if (payload.sub.endsWith('@clients')) {
      return payload.sub.replace(/@clients$/, '');
    }

    return payload.sub;
  }

  return undefined;
};

let cachedIssuer = '';
let cachedJwksClient: JwksClient | undefined;

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

const getJwksClient = (issuer: string): JwksClient => {
  if (!cachedJwksClient || cachedIssuer !== issuer) {
    cachedIssuer = issuer;
    cachedJwksClient = jwksClient({
      jwksUri: `${issuer}.well-known/jwks.json`,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
    });
  }

  return cachedJwksClient;
};

const verifyAuth0Token = async (
  token: string,
  issuer: string,
  audience?: string,
): Promise<Record<string, unknown>> => {
  const client = getJwksClient(issuer);

  const getKey = (header: JwtHeader, callback: SigningKeyCallback): void => {
    if (!header.kid) {
      callback(new Error('missing kid in token header'));
      return;
    }

    client.getSigningKey(header.kid, (error, key) => {
      if (error || !key) {
        callback(error || new Error('unable to resolve signing key'));
        return;
      }

      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  };

  const verifyOptions: VerifyOptions = {
    algorithms: ['RS256'] as Algorithm[],
    issuer,
    ...(audience ? { audience } : {}),
  };

  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, verifyOptions, (error: VerifyErrors | null, decoded?: JwtPayload | string) => {
      if (error) {
        reject(error);
        return;
      }

      if (!decoded || typeof decoded === 'string') {
        reject(new Error('invalid JWT payload'));
        return;
      }

      resolve(decoded as Record<string, unknown>);
    });
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

export const requireAuth0Bearer = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
  next: NextFunction,
): Promise<void | Response> => {
  res.setHeader('x-auth0-middleware-version', AUTH0_MIDDLEWARE_VERSION);

  const requestPath = req.originalUrl || req.url;
  const token = extractBearerToken(req.header('authorization'));

  if (!token) {
    // eslint-disable-next-line no-console
    console.error('[auth0Bearer] missing bearer token', {
      path: requestPath,
      method: req.method,
      hasAuthorizationHeader: Boolean(req.header('authorization')),
    });

    return res.status(401).json({
      success: false,
      message: 'missing or invalid authorization bearer token',
      ...(isAuth0DebugEnabled()
        ? {
            debug: {
              reason: 'MISSING_OR_INVALID_BEARER_TOKEN',
              middlewareVersion: AUTH0_MIDDLEWARE_VERSION,
            },
          }
        : {}),
    });
  }

  const issuer = resolveIssuer();

  if (!issuer) {
    // eslint-disable-next-line no-console
    console.error('[auth0Bearer] issuer not configured', {
      path: requestPath,
      method: req.method,
      hasAuth0IssuerBaseUrl: Boolean(process.env.AUTH0_ISSUER_BASE_URL),
      hasAuth0Issuer: Boolean(process.env.AUTH0_ISSUER),
      hasAuth0Domain: Boolean(process.env.AUTH0_DOMAIN),
    });

    return res.status(500).json({
      success: false,
      message: 'auth0 issuer is not configured',
      ...(isAuth0DebugEnabled()
        ? {
            debug: {
              reason: 'ISSUER_NOT_CONFIGURED',
              middlewareVersion: AUTH0_MIDDLEWARE_VERSION,
            },
          }
        : {}),
    });
  }

  try {
    const audience = process.env.AUTH0_AUDIENCE;
    const payload = await verifyAuth0Token(token, issuer, audience);

    res.locals.auth = payload;

    next();
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const errorMessage = error instanceof Error ? error.message : 'unknown error';

    // eslint-disable-next-line no-console
    console.error('[auth0Bearer] token verification failed', {
      path: requestPath,
      method: req.method,
      issuer,
      audience: process.env.AUTH0_AUDIENCE || '(not set)',
      errorName,
      errorMessage,
    });

    return res.status(401).json({
      success: false,
      message: 'invalid or expired access token',
      ...(isAuth0DebugEnabled()
        ? {
            debug: {
              reason: 'JWT_VERIFY_FAILED',
              errorName,
              errorMessage,
              issuer,
              audience: process.env.AUTH0_AUDIENCE || '(not set)',
              middlewareVersion: AUTH0_MIDDLEWARE_VERSION,
            },
          }
        : {}),
    });
  }
};
