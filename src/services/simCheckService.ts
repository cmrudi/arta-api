import {
  getOrderById,
  getSimInventoryByIccid,
  querySimCardsByIccid,
} from '../lib/dynamoDb';
import { getXploriSimInfo, getXploriUsage } from './xploriService';

type XploriSection = Record<string, unknown> | { error: string } | null;

type SimCheckSuccess = {
  success: true;
  iccid: string;
  inventory: Record<string, unknown>;
  eligibleToAddPackage: boolean;
  order: Record<string, unknown> | null;
  simCard: Record<string, unknown> | null;
  simInfo: XploriSection;
  usage: XploriSection;
};

type SimCheckError = {
  success: false;
  reason: 'ICCID_NOT_FOUND';
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
  // Gate on the inventory first: an iccid we don't own is "not found".
  const inventoryResult = await getSimInventoryByIccid(iccid);
  const inventory = inventoryResult.Item;

  if (!inventory) {
    return {
      success: false,
      reason: 'ICCID_NOT_FOUND',
      message: 'ICCID not found',
    };
  }

  // The remaining data is best-effort: an in-inventory SIM may not be sold yet
  // (no SIMCards / Order row), so absence is null rather than an error.
  const simResult = await querySimCardsByIccid(iccid);
  const simCard = (simResult.Items || [])[0] ?? null;

  const orderId = simCard ? String(simCard.orderId || '') : '';
  const order = orderId ? (await getOrderById(orderId)).Item ?? null : null;

  const [simInfo, usage] = await Promise.all([
    settle(() => getXploriSimInfo(iccid)),
    orderId ? settle(() => getXploriUsage(orderId)) : Promise.resolve(null),
  ]);

  return {
    success: true,
    iccid,
    inventory,
    // In inventory but no order yet → the SIM can have a package added.
    eligibleToAddPackage: order === null,
    order,
    simCard,
    simInfo,
    usage,
  };
};
