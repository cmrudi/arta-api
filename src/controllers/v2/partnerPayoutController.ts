import { Request, Response } from 'express';

import { AuthenticatedLocals, getAuth0Email } from '../../middlewares/auth0BearerAuth';
import {
  OPEN_WITHDRAWAL_STATUSES,
  WITHDRAWAL_STATUSES,
  WithdrawalStatus,
  isWithdrawalStatus,
} from '../../models/partnerPayout';
import {
  PayoutFailure,
  WithdrawalResult,
  adjustPartnerBalance,
  approvePartnerWithdrawal,
  cancelPartnerWithdrawal,
  checkWithdrawalAccount,
  handleXenithPayWebhook,
  listWithdrawalChannels,
  sendWithdrawalPayout,
  getPartnerPayoutSummary,
  getPartnerWalletDetail,
  getPartnerWithdrawal,
  listPartnerWallets,
  listPartnerWithdrawals,
  markPartnerWithdrawalPaid,
  rejectPartnerWithdrawal,
  requestPartnerWithdrawal,
  toPartnerWithdrawalView,
} from '../../services/partnerPayoutService';

const STATUS_BY_REASON: Record<string, number> = {
  PARTNER_NOT_FOUND: 404,
  WALLET_NOT_FOUND: 404,
  WITHDRAWAL_NOT_FOUND: 404,
  NOT_OWNER: 403,
  WITHDRAWAL_OPEN: 409,
  DUPLICATE_ENTRY: 409,
  INVALID_STATE: 409,
  INSUFFICIENT_BALANCE: 422,
  AMOUNT_BELOW_MINIMUM: 422,
  ACCOUNT_NOT_FOUND: 422,
  ACCOUNT_CHECK_UNAVAILABLE: 503,
  PAYOUT_UNAVAILABLE: 503,
};

const param = (req: Request, name: string): string => String(req.params[name] || '').trim();

const body = (req: Request): Record<string, unknown> =>
  req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

const fail = (res: Response, result: PayoutFailure): Response =>
  res.status(STATUS_BY_REASON[result.reason] || 400).json(result);

const serverError = (res: Response, message: string, error: unknown): Response =>
  res.status(500).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : 'unknown error',
  });

const emailOf = (res: Response<unknown, AuthenticatedLocals>): string => getAuth0Email(res.locals.auth) || '';

const actorOf = (res: Response<unknown, AuthenticatedLocals>): string => {
  const auth = res.locals.auth;

  return getAuth0Email(auth) || (typeof auth?.sub === 'string' ? auth.sub : 'unknown');
};

const sendWithdrawal = (res: Response, result: WithdrawalResult, status = 200): Response =>
  result.success ? res.status(status).json({ success: true, withdrawal: result.withdrawal }) : fail(res, result);

const toPartnerView = (result: WithdrawalResult): WithdrawalResult =>
  result.success ? { success: true, withdrawal: toPartnerWithdrawalView(result.withdrawal) } : result;

// ---------------------------------------------------------------------------
// Partner routes (the partner portal's own token; its email leads to the
// partner account, and the wallet belongs to that account's partnerId)

export const getMyPartnerWallet = async (
  _req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const summary = await getPartnerPayoutSummary(emailOf(res));

    return summary.success ? res.status(200).json(summary) : fail(res, summary);
  } catch (error) {
    return serverError(res, 'failed to read partner wallet', error);
  }
};

export const postMyPartnerWithdrawal = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const input = body(req);

  try {
    const result = await requestPartnerWithdrawal({
      email: emailOf(res),
      amount: input.amount,
      bankAccount: input.bankAccount,
      note: input.note,
    });

    return sendWithdrawal(res, toPartnerView(result), 201);
  } catch (error) {
    return serverError(res, 'failed to request withdrawal', error);
  }
};

export const postCancelMyPartnerWithdrawal = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    return sendWithdrawal(res, toPartnerView(await cancelPartnerWithdrawal(emailOf(res), param(req, 'withdrawalId'))));
  } catch (error) {
    return serverError(res, 'failed to cancel withdrawal', error);
  }
};

// ---------------------------------------------------------------------------
// Finance routes (arta-admin access token with the finance role)

export const getAdminPartnerWallets = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const items = await listPartnerWallets();

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (error) {
    return serverError(res, 'failed to list partner wallets', error);
  }
};

export const getAdminPartnerWallet = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await getPartnerWalletDetail(param(req, 'partnerId'));

    return result.success ? res.status(200).json(result) : fail(res, result);
  } catch (error) {
    return serverError(res, 'failed to read partner wallet', error);
  }
};

export const postAdminPartnerAdjustment = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const input = body(req);

  try {
    const result = await adjustPartnerBalance({
      partnerId: input.partnerId,
      email: input.email,
      type: input.type,
      amount: input.amount,
      note: input.note,
      entryId: input.entryId,
      partnerKey: input.partnerKey,
      partnerName: input.partnerName,
      by: actorOf(res),
    });

    return result.success
      ? res.status(201).json({ success: true, wallet: result.wallet, entry: result.entry })
      : fail(res, result);
  } catch (error) {
    return serverError(res, 'failed to adjust partner balance', error);
  }
};

export const getAdminPartnerWithdrawals = async (req: Request, res: Response): Promise<Response> => {
  const requested = String(req.query.status || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (requested.some((value) => !isWithdrawalStatus(value))) {
    return res.status(400).json({
      success: false,
      message: `status must be a comma-separated list of: ${WITHDRAWAL_STATUSES.join(', ')}`,
    });
  }

  const statuses = (requested.length > 0 ? requested : OPEN_WITHDRAWAL_STATUSES) as WithdrawalStatus[];

  try {
    const items = await listPartnerWithdrawals(statuses);

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (error) {
    return serverError(res, 'failed to list withdrawals', error);
  }
};

export const getAdminPartnerWithdrawal = async (req: Request, res: Response): Promise<Response> => {
  try {
    const withdrawal = await getPartnerWithdrawal(param(req, 'withdrawalId'));

    if (!withdrawal) {
      return res.status(404).json({ success: false, reason: 'WITHDRAWAL_NOT_FOUND', message: 'withdrawal not found' });
    }

    return res.status(200).json({ success: true, withdrawal });
  } catch (error) {
    return serverError(res, 'failed to read withdrawal', error);
  }
};

export const postApprovePartnerWithdrawal = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    return sendWithdrawal(res, await approvePartnerWithdrawal(param(req, 'withdrawalId'), actorOf(res)));
  } catch (error) {
    return serverError(res, 'failed to approve withdrawal', error);
  }
};

export const postRejectPartnerWithdrawal = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    return sendWithdrawal(
      res,
      await rejectPartnerWithdrawal(param(req, 'withdrawalId'), actorOf(res), body(req).reason),
    );
  } catch (error) {
    return serverError(res, 'failed to reject withdrawal', error);
  }
};

export const postPayPartnerWithdrawal = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const input = body(req);

  try {
    return sendWithdrawal(
      res,
      await markPartnerWithdrawalPaid(param(req, 'withdrawalId'), actorOf(res), input.transferReference, input.note),
    );
  } catch (error) {
    return serverError(res, 'failed to mark withdrawal paid', error);
  }
};

// ---------------------------------------------------------------------------
// Payout destinations (partner portal) and XenithPay

export const getWithdrawalChannels = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const items = await listWithdrawalChannels();

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (error) {
    return res.status(503).json({
      success: false,
      reason: 'PAYOUT_UNAVAILABLE',
      message: 'payout channels are not available right now',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};

export const postCheckWithdrawalAccount = async (req: Request, res: Response): Promise<Response> => {
  try {
    const result = await checkWithdrawalAccount(body(req));

    return result.success ? res.status(200).json(result) : fail(res, result);
  } catch (error) {
    return serverError(res, 'failed to check account', error);
  }
};

export const postSendPartnerWithdrawalPayout = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    return sendWithdrawal(res, await sendWithdrawalPayout(param(req, 'withdrawalId'), actorOf(res)));
  } catch (error) {
    return serverError(res, 'failed to send payout', error);
  }
};

/** Public: XenithPay calls this; the signature check is inside the service. */
export const postXenithPayWebhook = async (req: Request, res: Response): Promise<Response> => {
  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
  const result = await handleXenithPayWebhook({
    rawBody,
    signature: String(req.header('x-xenith-signature') || ''),
    timestamp: String(req.header('x-xenith-timestamp') || ''),
  });

  return res.status(result.status).json(result.body);
};
