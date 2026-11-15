import serverlessExpress from '@vendia/serverless-express';

import app from './app';
import { EsimCancelResultDetail, onEsimCancelResult } from './services/refundService';

const expressHandler = serverlessExpress({ app });

// Internal events, invoked directly on this Lambda (never through API Gateway,
// whose events always carry requestContext). EventBridge-shaped so they can
// come from a bus later without changing this code.
const ESIM_CANCEL_RESULT = { source: 'arta.refund', detailType: 'EsimCancelResult' };

type InternalEvent = {
  source?: unknown;
  'detail-type'?: unknown;
  detail?: unknown;
  requestContext?: unknown;
};

const isEsimCancelResult = (event: unknown): event is InternalEvent & { detail: EsimCancelResultDetail } => {
  const e = event as InternalEvent | null;
  return (
    !!e &&
    typeof e === 'object' &&
    e.requestContext === undefined &&
    e.source === ESIM_CANCEL_RESULT.source &&
    e['detail-type'] === ESIM_CANCEL_RESULT.detailType &&
    !!e.detail &&
    typeof e.detail === 'object'
  );
};

type ExpressHandler = (event: unknown, context: unknown, callback: () => void) => Promise<unknown>;

export const handler = async (event: unknown, context: unknown): Promise<unknown> => {
  if (isEsimCancelResult(event)) {
    // Errors propagate so Lambda's async retry tries again; the refund
    // transitions are conditional, so a retry never refunds twice.
    const result = await onEsimCancelResult(event.detail);
    console.log('[refund] EsimCancelResult handled', JSON.stringify({ detail: event.detail, result }));
    return result;
  }

  // serverless-express resolves the promise (resolutionMode PROMISE); the
  // callback is never used.
  return (expressHandler as unknown as ExpressHandler)(event, context, () => undefined);
};
