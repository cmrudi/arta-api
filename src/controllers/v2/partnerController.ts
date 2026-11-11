import { Request, Response } from 'express';

import { AuthenticatedLocals, getAuth0Email } from '../../middlewares/auth0BearerAuth';
import {
  PartnerFailure,
  findPartnerByEmail,
  getPartnerDetail,
  getPartnerOrders,
  listPartners,
  partnerKeyExists,
  registerPartner,
  updatePartner,
} from '../../services/partnerService';

const STATUS_BY_REASON: Record<string, number> = {
  PARTNER_NOT_FOUND: 404,
  KEY_TAKEN: 409,
  EMAIL_TAKEN: 409,
  ALREADY_REGISTERED: 409,
  CONFLICT: 409,
};

const param = (req: Request, name: string): string => String(req.params[name] || '').trim();

const body = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

const fail = (res: Response, result: PartnerFailure): Response =>
  res.status(STATUS_BY_REASON[result.reason] || 400).json(result);

const serverError = (res: Response, message: string, error: unknown): Response =>
  res.status(500).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : 'unknown error',
  });

const emailOf = (res: Response<unknown, AuthenticatedLocals>): string => getAuth0Email(res.locals.auth) || '';

// ---------------------------------------------------------------------------
// Public

/** Registration form: is go.artamobile.id/<key> still free? */
export const getPartnerKeyExists = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.status(200).json({ exist: await partnerKeyExists(param(req, 'key')) });
  } catch (error) {
    return serverError(res, 'failed to check partner key', error);
  }
};

// ---------------------------------------------------------------------------
// Partner portal (the partner's own token)

export const postRegisterPartner = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const result = await registerPartner({ email: emailOf(res), key: body(req).key });

    return result.success ? res.status(201).json(result) : fail(res, result);
  } catch (error) {
    return serverError(res, 'failed to register partner', error);
  }
};

export const getMyPartner = async (
  _req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const account = await findPartnerByEmail(emailOf(res));

    if (!account) {
      return res.status(404).json({ success: false, reason: 'PARTNER_NOT_FOUND', message: 'Partner not found' });
    }

    return res.status(200).json({ success: true, partner: account });
  } catch (error) {
    return serverError(res, 'failed to read partner', error);
  }
};

export const getMyPartnerOrders = async (
  _req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const result = await getPartnerOrders(emailOf(res));

    return result.success ? res.status(200).json(result) : fail(res, result);
  } catch (error) {
    return serverError(res, 'failed to read partner orders', error);
  }
};

// ---------------------------------------------------------------------------
// Finance

export const getAdminPartners = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const items = await listPartners();

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (error) {
    return serverError(res, 'failed to list partners', error);
  }
};

export const getAdminPartner = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await getPartnerDetail(param(req, 'partnerId'));

    return result.success ? res.status(200).json(result) : fail(res, result);
  } catch (error) {
    return serverError(res, 'failed to read partner', error);
  }
};

export const patchAdminPartner = async (req: Request, res: Response): Promise<Response> => {
  const input = body(req);

  try {
    const result = await updatePartner({
      partnerId: param(req, 'partnerId'),
      email: input.email,
      key: input.key,
      name: input.name,
    });

    return result.success ? res.status(200).json(result) : fail(res, result);
  } catch (error) {
    return serverError(res, 'failed to update partner', error);
  }
};
