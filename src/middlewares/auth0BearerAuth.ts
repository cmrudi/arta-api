import { NextFunction, Request, Response } from 'express';

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

type JoseModule = {
  createRemoteJWKSet: (url: URL) => unknown;
  jwtVerify: (
    token: string,
    key: unknown,
    options: { issuer: string; audience?: string },
  ) => Promise<{ payload: Record<string, unknown> }>;
};

let cachedIssuer = '';
let cachedJwks: unknown;
let cachedJoseModule: JoseModule | undefined;

const loadJose = async (): Promise<JoseModule> => {
  if (!cachedJoseModule) {
    cachedJoseModule = (await import('jose')) as unknown as JoseModule;
  }

  return cachedJoseModule;
};

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

const getJwks = async (issuer: string): Promise<unknown> => {
  const jose = await loadJose();

  if (!cachedJwks || cachedIssuer !== issuer) {
    cachedIssuer = issuer;
    cachedJwks = jose.createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`));
  }

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

export const requireAuth0Bearer = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
  next: NextFunction,
): Promise<void | Response> => {
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
    });
  }

  try {
    const jose = await loadJose();
    const jwks = await getJwks(issuer);
    const audience = process.env.AUTH0_AUDIENCE;

    const { payload } = await jose.jwtVerify(
      token,
      jwks,
      audience
        ? {
            issuer,
            audience,
          }
        : {
            issuer,
          },
    );

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
    });
  }
};
