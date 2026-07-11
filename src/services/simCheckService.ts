import { getOrderById, querySimCardsByIccid } from '../lib/dynamoDb';
import { getXploriSimInfo, getXploriUsage } from './xploriService';

type XploriSection = Record<string, unknown> | { error: string };

type SimCheckSuccess = {
  success: true;
  iccid: string;
  order: Record<string, unknown>;
  simCard: Record<string, unknown>;
  simInfo: XploriSection;
  usage: XploriSection;
};

type SimCheckError = {
  success: false;
  reason: 'NOT_FOUND';
  message: string;
};

export type SimCheckResult = SimCheckSuccess | SimCheckError;

// Xplori lookups are best-effort — one provider failure shouldn't blank the
// whole response, so the failing section carries an { error } instead.
const settle = async (
  fn: () => Promise<Record<string, unknown>>,
): Promise<XploriSection> => {
  try {
    return await fn();
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'unknown error' };
  }
};

export const checkSim = async (iccid: string): Promise<SimCheckResult> => {
  const simResult = await querySimCardsByIccid(iccid);
  const simCard = (simResult.Items || [])[0];

  if (!simCard) {
    return {
      success: false,
      reason: 'NOT_FOUND',
      message: 'no SIMCards entry found for iccid',
    };
  }

  const orderId = String(simCard.orderId || '');
  const orderResult = orderId ? await getOrderById(orderId) : { Item: undefined };
  const order = orderResult.Item;

  if (!order) {
    return {
      success: false,
      reason: 'NOT_FOUND',
      message: 'no Order entry found for iccid',
    };
  }

  const [simInfo, usage] = await Promise.all([
    settle(() => getXploriSimInfo(iccid)),
    settle(() => getXploriUsage(orderId)),
  ]);

  return {
    success: true,
    iccid,
    order,
    simCard,
    simInfo,
    usage,
  };
};
