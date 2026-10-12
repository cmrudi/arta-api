import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { randomUUID } from 'crypto';

import {
  createRefundForOrder,
  getOrderById,
  getRefundById,
  getSimBySimId,
  queryRefundsByStatus,
  transitionRefund,
} from '../lib/dynamoDb';
import {
  MAX_NOTE_LENGTH,
  REFUND_WINDOW_DAYS,
  REVIEW_SLA_HOURS,
  RefundItem,
  RefundStatus,
  isRefundReason,
} from '../models/refund';
import { requestMidtransRefund } from './midtransService';
import { sendRefundEmail } from './refundEmailService';

const lambdaClient = new LambdaClient({});

// The provider rules (eSIMAccess / Maya status checks and their cancel calls)
// already live in these two Lambdas, along with the provider credentials. The
// refund flow invokes them directly instead of re-implementing either.
const ELIGIBILITY_LAMBDA = process.env.REFUND_ELIGIBILITY_LAMBDA || 'refundEligibilityByOrderId';
const EXECUTE_LAMBDA = process.env.REFUND_EXECUTE_LAMBDA || 'refundExecute';

// A run that has sat in APPROVED or ESIM_CANCELLED this long died mid-way
// (e.g. a Lambda timeout) rather than still being in progress.
const STUCK_AFTER_MS = 2 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value: unknown): string => str(value).toLowerCase();

const isConditionFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException');

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error';

/** Invoke a Lambda synchronously and unwrap an API Gateway proxy-style answer. */
const invokeLambdaSync = async (
  functionName: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );

  if (response.FunctionError) {
    throw new Error(`${functionName} failed: ${response.FunctionError}`);
  }

  const raw = response.Payload ? Buffer.from(response.Payload).toString('utf-8') : '';
  const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};

  if (typeof parsed.body === 'string') {
    return JSON.parse(parsed.body) as Record<string, unknown>;
  }

  return parsed;
};

// ---------------------------------------------------------------------------
// Eligibility

export type IneligibleReason =
  | 'PHYSICAL_SIM'
  | 'NOT_SELF_SERVICE'
  | 'NOT_PAID'
  | 'WINDOW_EXPIRED'
  | 'ESIM_IN_USE'
  | 'PROVIDER_UNAVAILABLE';

export type Eligibility = {
  eligible: boolean;
  reason?: IneligibleReason;
  windowEndsAt?: string;
  snapshot?: Record<string, unknown>;
};

const evaluateEligibility = async (
  sim: Record<string, unknown>,
  order: Record<string, unknown>,
): Promise<Eligibility> => {
  const createdAt = new Date(str(order.createdAt));
  const windowEndsAt = Number.isNaN(createdAt.getTime())
    ? undefined
    : new Date(createdAt.getTime() + REFUND_WINDOW_DAYS * DAY_MS).toISOString();

  // A physical SIM has no profile to cancel at the provider.
  if (parseInt(String(sim.simType), 10) === 0) {
    return { eligible: false, reason: 'PHYSICAL_SIM', windowEndsAt };
  }

  // Partner and distributor-wallet orders were not paid through Midtrans, so
  // there is no payment to return; those go through CS.
  if (str(order.paymentType) === 'distributorWallet' || str(order.distributorId)) {
    return { eligible: false, reason: 'NOT_SELF_SERVICE', windowEndsAt };
  }

  if (['CREATED', 'PAYMENT_EXPIRED'].includes(str(order.status))) {
    return { eligible: false, reason: 'NOT_PAID', windowEndsAt };
  }

  if (!windowEndsAt || Date.now() > new Date(windowEndsAt).getTime()) {
    return { eligible: false, reason: 'WINDOW_EXPIRED', windowEndsAt };
  }

  let snapshot: Record<string, unknown>;

  try {
    snapshot = await invokeLambdaSync(ELIGIBILITY_LAMBDA, { orderId: str(order.orderId) });
  } catch (error) {
    console.error('[refund] eligibility lambda failed', { orderId: order.orderId, error });
    return { eligible: false, reason: 'PROVIDER_UNAVAILABLE', windowEndsAt };
  }

  if (snapshot.reason === 'Upstream API error') {
    return { eligible: false, reason: 'PROVIDER_UNAVAILABLE', windowEndsAt, snapshot };
  }

  return snapshot.eligible === true
    ? { eligible: true, windowEndsAt, snapshot }
    : { eligible: false, reason: 'ESIM_IN_USE', windowEndsAt, snapshot };
};

// ---------------------------------------------------------------------------
// Customer side

/** What the customer may see: no provider or gateway payloads, no reviewer. */
export const toCustomerView = (refund: Record<string, unknown>): Record<string, unknown> => ({
  refundId: refund.refundId,
  orderId: refund.orderId,
  status: refund.status,
  amount: refund.amount,
  paymentType: refund.paymentType,
  reason: refund.reason,
  rejectReason: refund.rejectReason,
  deadlineAt: refund.deadlineAt,
  createdAt: refund.createdAt,
  esimCancelledAt: refund.esimCancelledAt,
  refundedAt: refund.refundedAt,
  events: Array.isArray(refund.events)
    ? refund.events.map((event) => ({
        at: (event as Record<string, unknown>).at,
        status: (event as Record<string, unknown>).status,
      }))
    : [],
});

type LoadFailure = { success: false; reason: 'SIM_NOT_FOUND' | 'ORDER_NOT_FOUND' | 'NOT_OWNER' };

/**
 * Only the buyer may see or start a refund. A shared eSIM gets its own
 * SIMCards row under the recipient's email but keeps the buyer's orderId, so
 * the check is against the Order's email, not the SIM row's.
 */
const loadOwnedSim = async (
  simId: string,
  email: string,
): Promise<
  { success: true; sim: Record<string, unknown>; order: Record<string, unknown> } | LoadFailure
> => {
  const sim = (await getSimBySimId(simId)).Item;

  if (!sim) {
    return { success: false, reason: 'SIM_NOT_FOUND' };
  }

  const order = str(sim.orderId) ? (await getOrderById(str(sim.orderId))).Item : undefined;

  if (!order) {
    return { success: false, reason: 'ORDER_NOT_FOUND' };
  }

  if (!normalizeEmail(order.email) || normalizeEmail(order.email) !== normalizeEmail(email)) {
    return { success: false, reason: 'NOT_OWNER' };
  }

  return { success: true, sim, order };
};

export type SimRefundState =
  | { success: true; refund: Record<string, unknown> | null; eligibility: Eligibility | null }
  | LoadFailure;

export const getSimRefundState = async (simId: string, email: string): Promise<SimRefundState> => {
  const loaded = await loadOwnedSim(simId, email);

  if (!loaded.success) {
    return loaded;
  }

  const refundId = str(loaded.order.refundId);

  if (refundId) {
    const refund = (await getRefundById(refundId)).Item;

    if (refund) {
      return { success: true, refund: toCustomerView(refund), eligibility: null };
    }
  }

  const eligibility = await evaluateEligibility(loaded.sim, loaded.order);
  // The provider payload stays server-side.
  const { snapshot: _snapshot, ...publicEligibility } = eligibility;

  return { success: true, refund: null, eligibility: publicEligibility };
};

export type CreateRefundResult =
  | { success: true; refund: Record<string, unknown> }
  | LoadFailure
  | { success: false; reason: 'INVALID_REASON' | 'NOTE_TOO_LONG' | 'ALREADY_REQUESTED' }
  | { success: false; reason: 'NOT_ELIGIBLE'; ineligibleReason?: IneligibleReason };

export const createRefundRequest = async (input: {
  simId: string;
  email: string;
  reason: unknown;
  note?: unknown;
}): Promise<CreateRefundResult> => {
  if (!isRefundReason(input.reason)) {
    return { success: false, reason: 'INVALID_REASON' };
  }

  const note = str(input.note);

  if (note.length > MAX_NOTE_LENGTH) {
    return { success: false, reason: 'NOTE_TOO_LONG' };
  }

  const loaded = await loadOwnedSim(input.simId, input.email);

  if (!loaded.success) {
    return loaded;
  }

  const { sim, order } = loaded;

  if (str(order.refundId)) {
    return { success: false, reason: 'ALREADY_REQUESTED' };
  }

  const eligibility = await evaluateEligibility(sim, order);

  if (!eligibility.eligible) {
    return { success: false, reason: 'NOT_ELIGIBLE', ineligibleReason: eligibility.reason };
  }

  const now = new Date();
  const createdAt = now.toISOString();
  const refund: RefundItem = {
    refundId: `REF-${randomUUID().slice(0, 8).toUpperCase()}`,
    orderId: str(order.orderId),
    SimId: str(sim.SimId),
    iccid: str(sim.iccid) || undefined,
    email: normalizeEmail(order.email),
    status: 'PENDING_REVIEW',
    amount: Number(order.price) || 0,
    paymentType: str(order.paymentType) || undefined,
    provider: str(sim.provider) || undefined,
    regionCode: str(sim.regionCode) || undefined,
    reason: input.reason,
    note: note || undefined,
    source: 'CUSTOMER',
    eligibilitySnapshot: eligibility.snapshot,
    deadlineAt: new Date(now.getTime() + REVIEW_SLA_HOURS * 60 * 60 * 1000).toISOString(),
    retryCount: 0,
    events: [{ at: createdAt, status: 'PENDING_REVIEW', by: normalizeEmail(order.email) }],
    createdAt,
    updatedAt: createdAt,
  };

  try {
    await createRefundForOrder(refund);
  } catch (error) {
    if (isConditionFailure(error)) {
      return { success: false, reason: 'ALREADY_REQUESTED' };
    }

    throw error;
  }

  await sendRefundEmail('RECEIVED', refund);

  return { success: true, refund: toCustomerView(refund) };
};

// ---------------------------------------------------------------------------
// Admin side

export const listRefunds = async (
  statuses: readonly RefundStatus[],
): Promise<Record<string, unknown>[]> => {
  const pages = await Promise.all(statuses.map((status) => queryRefundsByStatus(status)));

  return pages
    .flat()
    .sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt)));
};

export type AdminRefundResult =
  | { success: true; refund: Record<string, unknown> }
  | {
      success: false;
      reason: 'REFUND_NOT_FOUND' | 'INVALID_STATE' | 'REJECT_REASON_REQUIRED';
      status?: string;
    };

const reload = async (refundId: string): Promise<AdminRefundResult> => {
  const refund = (await getRefundById(refundId)).Item;

  return refund ? { success: true, refund } : { success: false, reason: 'REFUND_NOT_FOUND' };
};

/**
 * Move to `to` if the refund is still in one of `from`. Returns false when
 * another request moved it first.
 */
const tryTransition = async (
  refund: Record<string, unknown>,
  from: readonly RefundStatus[],
  to: RefundStatus,
  actor: string,
  set?: Record<string, unknown>,
  options: { note?: string; incrementRetry?: boolean } = {},
): Promise<boolean> => {
  try {
    await transitionRefund({
      refundId: str(refund.refundId),
      orderId: str(refund.orderId),
      from,
      to,
      set,
      incrementRetry: options.incrementRetry,
      event: { at: new Date().toISOString(), status: to, by: actor, note: options.note },
    });
    return true;
  } catch (error) {
    if (isConditionFailure(error)) {
      return false;
    }

    throw error;
  }
};

/** Step 2 of an approved refund: return the money through Midtrans. */
const runGatewayStep = async (refund: Record<string, unknown>, actor: string): Promise<void> => {
  const refundId = str(refund.refundId);

  try {
    const result = await requestMidtransRefund({
      orderId: str(refund.orderId),
      refundKey: refundId,
      amount: Number(refund.amount),
      reason: `Refund ${refundId}`,
    });

    if (result.success) {
      const completed = {
        refundedAt: new Date().toISOString(),
        ...(result.paymentType ? { paymentType: result.paymentType } : {}),
      };
      const moved = await tryTransition(refund, ['ESIM_CANCELLED'], 'REFUNDED', actor, {
        ...completed,
        gatewayResponse: result.response,
      });

      if (moved) {
        await sendRefundEmail('COMPLETED', { ...refund, ...completed, status: 'REFUNDED' });
      }
      return;
    }

    await tryTransition(refund, ['ESIM_CANCELLED'], 'REFUND_FAILED', actor, {
      lastError: result.message,
      gatewayResponse: result.response,
      ...(result.paymentType ? { paymentType: result.paymentType } : {}),
    });
  } catch (error) {
    await tryTransition(refund, ['ESIM_CANCELLED'], 'REFUND_FAILED', actor, {
      lastError: errorMessage(error),
    });
  }
};

/**
 * Step 1 of an approved refund: cancel the eSIM at the provider, then hand
 * over to the gateway step. The money only moves once the cancel succeeded,
 * so a failed cancel never leaves a refunded eSIM still working.
 */
const runCancelStep = async (refund: Record<string, unknown>, actor: string): Promise<void> => {
  let response: Record<string, unknown>;

  try {
    // refundExecute re-checks eligibility, cancels at the provider and
    // records Order.refund - the same Lambda the admin's old button called.
    response = await invokeLambdaSync(EXECUTE_LAMBDA, { orderId: str(refund.orderId) });
  } catch (error) {
    await tryTransition(refund, ['APPROVED'], 'ESIM_CANCEL_FAILED', actor, {
      lastError: errorMessage(error),
    });
    return;
  }

  if (response.cancelled !== true) {
    await tryTransition(refund, ['APPROVED'], 'ESIM_CANCEL_FAILED', actor, {
      lastError: str(response.reason) || str(response.message) || 'eSIM was not cancelled',
      esimCancelResponse: response,
    });
    return;
  }

  const moved = await tryTransition(refund, ['APPROVED'], 'ESIM_CANCELLED', actor, {
    esimCancelledAt: new Date().toISOString(),
    esimCancelResponse: response,
  });

  if (moved) {
    await runGatewayStep(refund, actor);
  }
};

export const approveRefund = async (
  refundId: string,
  reviewer: string,
): Promise<AdminRefundResult> => {
  const refund = (await getRefundById(refundId)).Item;

  if (!refund) {
    return { success: false, reason: 'REFUND_NOT_FOUND' };
  }

  const approved = await tryTransition(refund, ['PENDING_REVIEW'], 'APPROVED', reviewer, {
    reviewedBy: reviewer,
    reviewedAt: new Date().toISOString(),
  });

  if (!approved) {
    return { success: false, reason: 'INVALID_STATE', status: str(refund.status) };
  }

  await runCancelStep(refund, reviewer);

  return reload(refundId);
};

export const rejectRefund = async (
  refundId: string,
  reviewer: string,
  rejectReason: unknown,
): Promise<AdminRefundResult> => {
  const reason = str(rejectReason);

  if (!reason) {
    return { success: false, reason: 'REJECT_REASON_REQUIRED' };
  }

  const refund = (await getRefundById(refundId)).Item;

  if (!refund) {
    return { success: false, reason: 'REFUND_NOT_FOUND' };
  }

  // ESIM_CANCEL_FAILED is rejectable too: it usually means the customer
  // started using the eSIM while the request waited, so it was never cancelled.
  const rejected = await tryTransition(
    refund,
    ['PENDING_REVIEW', 'ESIM_CANCEL_FAILED'],
    'REJECTED',
    reviewer,
    { reviewedBy: reviewer, reviewedAt: new Date().toISOString(), rejectReason: reason },
    { note: reason },
  );

  if (!rejected) {
    return { success: false, reason: 'INVALID_STATE', status: str(refund.status) };
  }

  const result = await reload(refundId);

  if (result.success) {
    await sendRefundEmail('REJECTED', result.refund);
  }

  return result;
};

const isStuck = (refund: Record<string, unknown>): boolean =>
  Date.now() - new Date(str(refund.updatedAt)).getTime() > STUCK_AFTER_MS;

/**
 * Resume a refund from the step that failed or stalled. `esimAlreadyCancelled`
 * is CS confirming by hand that the provider shows the eSIM cancelled - the
 * case where the cancel went through but its answer was lost, so a plain retry
 * would fail the eligibility check forever.
 */
export const retryRefund = async (
  refundId: string,
  actor: string,
  options: { esimAlreadyCancelled?: boolean } = {},
): Promise<AdminRefundResult> => {
  const refund = (await getRefundById(refundId)).Item;

  if (!refund) {
    return { success: false, reason: 'REFUND_NOT_FOUND' };
  }

  const status = str(refund.status) as RefundStatus;
  const cancelFromStatuses: RefundStatus[] = ['ESIM_CANCEL_FAILED', ...(isStuck(refund) ? ['APPROVED' as const] : [])];
  const gatewayFromStatuses: RefundStatus[] = ['REFUND_FAILED', ...(isStuck(refund) ? ['ESIM_CANCELLED' as const] : [])];

  if (cancelFromStatuses.includes(status)) {
    if (options.esimAlreadyCancelled) {
      const moved = await tryTransition(
        refund,
        cancelFromStatuses,
        'ESIM_CANCELLED',
        actor,
        { esimCancelledAt: new Date().toISOString() },
        { note: 'eSIM cancellation confirmed manually', incrementRetry: true },
      );

      if (moved) {
        await runGatewayStep(refund, actor);
      }
    } else {
      const moved = await tryTransition(refund, cancelFromStatuses, 'APPROVED', actor, undefined, {
        incrementRetry: true,
      });

      if (moved) {
        await runCancelStep(refund, actor);
      }
    }

    return reload(refundId);
  }

  if (gatewayFromStatuses.includes(status)) {
    const moved = await tryTransition(refund, gatewayFromStatuses, 'ESIM_CANCELLED', actor, undefined, {
      incrementRetry: true,
    });

    if (moved) {
      await runGatewayStep(refund, actor);
    }

    return reload(refundId);
  }

  return { success: false, reason: 'INVALID_STATE', status };
};

/** CS returned the money outside Midtrans, e.g. by bank transfer for a VA order. */
export const completeRefundManually = async (
  refundId: string,
  actor: string,
  note: unknown,
): Promise<AdminRefundResult> => {
  const refund = (await getRefundById(refundId)).Item;

  if (!refund) {
    return { success: false, reason: 'REFUND_NOT_FOUND' };
  }

  const moved = await tryTransition(
    refund,
    ['REFUND_FAILED'],
    'REFUNDED',
    actor,
    { refundedAt: new Date().toISOString(), manualRefund: true },
    { note: str(note) || 'refunded manually' },
  );

  if (!moved) {
    return { success: false, reason: 'INVALID_STATE', status: str(refund.status) };
  }

  const result = await reload(refundId);

  if (result.success) {
    await sendRefundEmail('COMPLETED', result.refund);
  }

  return result;
};
