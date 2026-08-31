import { getSimBySimId, getSimReview, putSimReview, querySimReviews } from '../lib/dynamoDb';
import {
  MAX_COMMENT_LENGTH,
  MAX_RATING,
  MIN_RATING,
  ReviewKind,
  SimReviewItem,
  isValidReason,
} from '../models/simReview';

export type SubmitReviewInput = {
  simId: string;
  kind: ReviewKind;
  rating?: unknown;
  reason?: unknown;
  comment?: unknown;
  /**
   * Install stage as the customer saw it. Supplied by the client because
   * SIMCards does not store it — getEsimBySimId derives it at read time from
   * the notification table. Diagnostic only, never used for authorization.
   */
  smdpStatus?: unknown;
};

export type SubmitReviewResult =
  | { success: true; review: SimReviewItem; action: 'created' | 'updated' }
  | {
      success: false;
      reason:
        | 'SIM_NOT_FOUND'
        | 'INVALID_RATING'
        | 'INVALID_REASON';
    };

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Store one answer.
 *
 * Everything describing the SIM - provider, region, order, lifecycle status,
 * and the buyer's email - is read from the SIMCards row rather than accepted
 * from the caller. Those fields are the point: an answer without its provider,
 * region and smdpStatus can't tell you whether a supplier migration changed the
 * customer experience, or where an install actually broke.
 *
 * There is no ownership check. The endpoint is unauthenticated by design so a
 * shared eSIM's actual user can answer, and the SimId is already the bearer
 * capability for the SIM. The trade-off is that anyone holding a SimId can
 * overwrite that SIM's answers - last writer wins.
 */
export const submitSimReview = async (
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> => {
  // Both kinds are a 1-5 rating: INSTALL rates the setup process, SERVICE the
  // connection.
  const rating = Number(input.rating);

  if (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING) {
    return { success: false, reason: 'INVALID_RATING' };
  }

  const reason = str(input.reason);

  if (reason && !isValidReason(input.kind, reason)) {
    return { success: false, reason: 'INVALID_REASON' };
  }

  const found = await getSimBySimId(input.simId);
  const sim = found.Item;

  if (!sim) {
    return { success: false, reason: 'SIM_NOT_FOUND' };
  }

  // The buyer's address, for joining answers back to a customer. Not used for
  // authorization - see the note above.
  const email = str(sim.email).toLowerCase();

  const existing = await getSimReview(input.simId, input.kind);
  const now = new Date().toISOString();
  const comment = str(input.comment).slice(0, MAX_COMMENT_LENGTH);

  const review: SimReviewItem = {
    SimId: input.simId,
    kind: input.kind,
    rating,
    email,
    iccid: str(sim.iccid) || undefined,
    orderId: str(sim.orderId) || undefined,
    regionCode: str(sim.firstRegion) || undefined,
    provider: str(sim.provider) || undefined,
    simStatus: str(sim.status) || undefined,
    smdpStatus: str(input.smdpStatus).toUpperCase() || undefined,
    reason: reason || undefined,
    comment: comment || undefined,
    createdAt: str(existing.Item?.createdAt) || now,
    updatedAt: existing.Item ? now : undefined,
  };

  // Strip undefined so the stored item stays clean.
  const item = Object.fromEntries(
    Object.entries(review).filter(([, value]) => value !== undefined),
  );

  await putSimReview(item);

  return { success: true, review, action: existing.Item ? 'updated' : 'created' };
};

/** Every answer left for one SIM, keyed by kind. */
export const findSimReviews = async (
  simId: string,
): Promise<Partial<Record<ReviewKind, SimReviewItem>>> => {
  const found = await querySimReviews(simId);
  const out: Partial<Record<ReviewKind, SimReviewItem>> = {};

  for (const raw of found.Items || []) {
    const item = raw as SimReviewItem;
    out[item.kind] = item;
  }

  return out;
};
