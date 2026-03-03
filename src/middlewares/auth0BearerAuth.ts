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
  const token = extractBearerToken(req.header('authorization'));

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'missing or invalid authorization bearer token',
    });
  }

  const issuer = resolveIssuer();

  if (!issuer) {
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
  } catch (_error) {
    return res.status(401).json({
      success: false,
      message: 'invalid or expired access token',
    });
  }
};
