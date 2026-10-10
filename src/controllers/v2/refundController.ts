import { Request, Response } from 'express';

import { AuthenticatedLocals, getAuth0Email } from '../../middlewares/auth0BearerAuth';
import { OPEN_REFUND_STATUSES, REFUND_STATUSES, RefundStatus, isRefundStatus } from '../../models/refund';
import {
  AdminRefundResult,
  approveRefund,
  completeRefundManually,
  createRefundRequest,
  getSimRefundState,
  listRefunds,
  rejectRefund,
  retryRefund,
} from '../../services/refundService';
import { getRefundById } from '../../lib/dynamoDb';

const STATUS_BY_REASON: Record<string, number> = {
  SIM_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  REFUND_NOT_FOUND: 404,
  NOT_OWNER: 403,
  INVALID_REASON: 400,
  NOTE_TOO_LONG: 400,
  REJECT_REASON_REQUIRED: 400,
  ALREADY_REQUESTED: 409,
  INVALID_STATE: 409,
  NOT_ELIGIBLE: 422,
};

const param = (req: Request, name: string): string => String(req.params[name] || '').trim();

const fail = (res: Response, result: { reason: string } & Record<string, unknown>): Response =>
  res.status(STATUS_BY_REASON[result.reason] || 400).json({ ...result, success: false });

const serverError = (res: Response, message: string, error: unknown): Response =>
  res.status(500).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : 'unknown error',
  });

const actorOf = (res: Response<unknown, AuthenticatedLocals>): string => {
  const auth = res.locals.auth;

  return getAuth0Email(auth) || (typeof auth?.sub === 'string' ? auth.sub : 'unknown');
};

const sendAdminResult = (res: Response, result: AdminRefundResult): Response =>
  result.success ? res.status(200).json({ success: true, refund: result.refund }) : fail(res, result);

// ---------------------------------------------------------------------------
// Customer routes (browser Auth0 ID token)

export const getSimRefund = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const result = await getSimRefundState(param(req, 'SimId'), getAuth0Email(res.locals.auth) || '');

    if (!result.success) {
      return fail(res, result);
    }

    return res.status(200).json({
      success: true,
      refund: result.refund,
      eligibility: result.eligibility,
    });
  } catch (error) {
    return serverError(res, 'failed to read refund', error);
  }
};

export const postSimRefund = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const body = (req.body || {}) as { reason?: unknown; note?: unknown };

  try {
    const result = await createRefundRequest({
      simId: param(req, 'SimId'),
      email: getAuth0Email(res.locals.auth) || '',
      reason: body.reason,
      note: body.note,
    });

    if (!result.success) {
      return fail(res, result);
    }

    return res.status(201).json({ success: true, refund: result.refund });
  } catch (error) {
    return serverError(res, 'failed to create refund', error);
  }
};

// ---------------------------------------------------------------------------
// Admin routes (API access token with the reviewer role)

export const getAdminRefunds = async (req: Request, res: Response): Promise<Response> => {
  const requested = String(req.query.status || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (requested.some((value) => !isRefundStatus(value))) {
    return res.status(400).json({
      success: false,
      message: `status must be a comma-separated list of: ${REFUND_STATUSES.join(', ')}`,
    });
  }

  const statuses = (requested.length > 0 ? requested : OPEN_REFUND_STATUSES) as RefundStatus[];

  try {
    const items = await listRefunds(statuses);

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (error) {
    return serverError(res, 'failed to list refunds', error);
  }
};

export const getAdminRefund = async (req: Request, res: Response): Promise<Response> => {
  try {
    const refund = (await getRefundById(param(req, 'refundId'))).Item;

    if (!refund) {
      return fail(res, { reason: 'REFUND_NOT_FOUND' });
    }

    return res.status(200).json({ success: true, refund });
  } catch (error) {
    return serverError(res, 'failed to read refund', error);
  }
};

export const postApproveRefund = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    return sendAdminResult(res, await approveRefund(param(req, 'refundId'), actorOf(res)));
  } catch (error) {
    return serverError(res, 'failed to approve refund', error);
  }
};

export const postRejectRefund = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const reason = (req.body as { reason?: unknown })?.reason;

    return sendAdminResult(res, await rejectRefund(param(req, 'refundId'), actorOf(res), reason));
  } catch (error) {
    return serverError(res, 'failed to reject refund', error);
  }
};

export const postRetryRefund = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const esimAlreadyCancelled =
      (req.body as { esimAlreadyCancelled?: unknown })?.esimAlreadyCancelled === true;

    return sendAdminResult(
      res,
      await retryRefund(param(req, 'refundId'), actorOf(res), { esimAlreadyCancelled }),
    );
  } catch (error) {
    return serverError(res, 'failed to retry refund', error);
  }
};

export const postCompleteRefund = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const note = (req.body as { note?: unknown })?.note;

    return sendAdminResult(res, await completeRefundManually(param(req, 'refundId'), actorOf(res), note));
  } catch (error) {
    return serverError(res, 'failed to complete refund', error);
  }
};
