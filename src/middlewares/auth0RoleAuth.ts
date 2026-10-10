import { NextFunction, Request, Response } from 'express';

import { AuthenticatedLocals } from './auth0BearerAuth';

// Same namespace the tenant Action writes roles under and the admin app reads
// (arta-admin useAuth0Roles).
const AUTH0_ROLES_CLAIM = 'https://api.artamobile.id/roles';

export const getAuth0Roles = (payload?: Record<string, unknown>): string[] => {
  const roles = payload?.[AUTH0_ROLES_CLAIM];

  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
};

/**
 * Require an Auth0 role on top of a verified token. Mount after
 * `requireAuth0Bearer`, which puts the token payload on res.locals.auth.
 */
export const requireAuth0Role =
  (role: string) =>
  (
    _req: Request,
    res: Response<unknown, AuthenticatedLocals>,
    next: NextFunction,
  ): void | Response => {
    if (!getAuth0Roles(res.locals.auth).includes(role)) {
      return res.status(403).json({
        success: false,
        message: `role ${role} is required`,
      });
    }

    next();
  };
