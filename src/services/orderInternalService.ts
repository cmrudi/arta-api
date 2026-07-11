import { randomUUID } from 'crypto';

import {
  createOrder,
  findProductByProductCode,
  getRegionByCode,
  storeSim,
  updateOrderStatus,
} from '../lib/dynamoDb';
import { OrderItem } from '../models/order';
import { sendInternalOrderConfirm } from './brevoService';
import { createXploriOrder } from './xploriService';

const XPLORI_PROVIDER = 'xplori';
const PHYSICAL_SIM_TYPE = '0';

export type CreateInternalOrderPayload = {
  email?: string;
  productCode: string;
  iccid: string;
  customerName?: string;
  customerPhone?: string;
};

type CreateInternalOrderSuccess = {
  success: true;
  order: {
    orderId: string;
    productCode: string;
    price: number;
    status: string;
  };
  sim: {
    simId: string;
    iccid: string;
    simSerial: string;
    startUsingDate?: string;
  };
};

type CreateInternalOrderError = {
  success: false;
  reason: 'PRODUCT_NOT_FOUND' | 'PRODUCT_NOT_XPLORI' | 'PRODUCT_NOT_PHYSICAL' | 'PROVIDER_FAILED';
  message: string;
};

export type CreateInternalOrderResult =
  | CreateInternalOrderSuccess
  | CreateInternalOrderError;

const parseNumber = (value: unknown): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeString = (value: unknown): string => String(value || '').trim();

export const createInternalOrder = async (
  payload: CreateInternalOrderPayload,
): Promise<CreateInternalOrderResult> => {
  const productResult = await findProductByProductCode(payload.productCode);
  const product = (productResult.Items || [])[0] as Record<string, unknown> | undefined;

  if (!product) {
    return {
      success: false,
      reason: 'PRODUCT_NOT_FOUND',
      message: 'product mapping not found',
    };
  }

  const provider = normalizeString(product.provider).toLowerCase();
  const xploriProductId = normalizeString(product.xploriProductId);

  if (provider !== XPLORI_PROVIDER || !xploriProductId) {
    return {
      success: false,
      reason: 'PRODUCT_NOT_XPLORI',
      message: 'product is not a xplori product or is missing xploriProductId',
    };
  }

  // simType '0' means a physical SIM — this internal flow only provisions physical SIMs.
  if (normalizeString(product.simType) !== PHYSICAL_SIM_TYPE) {
    return {
      success: false,
      reason: 'PRODUCT_NOT_PHYSICAL',
      message: 'product is not a physical sim (simType must be 0)',
    };
  }

  const price = parseNumber(product.price) * 1000;

  const order: OrderItem = {
    orderId: randomUUID(),
    email: payload.email,
    customerName: payload.customerName,
    customerPhone: payload.customerPhone,
    productCode: payload.productCode,
    iccid: payload.iccid,
    price,
    paymentType: 'internal',
    orderType: 'sim',
    provider: XPLORI_PROVIDER,
    createdAt: new Date().toISOString(),
    status: 'PAID',
  };
  console.log('Creating internal xplori order:', order);

  await createOrder(order);

  const orderId = String(order.orderId);

  let xploriResult;
  try {
    xploriResult = await createXploriOrder({
      bookingId: orderId,
      sku: xploriProductId,
      productId: xploriProductId,
      simId: payload.iccid,
    });
  } catch (error) {
    await updateOrderStatus(orderId, 'SIM_FAILED');

    return {
      success: false,
      reason: 'PROVIDER_FAILED',
      message: error instanceof Error ? error.message : 'xplori order failed',
    };
  }

  // Xplori provisioned the SIM successfully — mark the order fulfilled.
  await updateOrderStatus(orderId, 'ORDER_FULFILLED');

  const simRecord = {
    SimId: randomUUID(),
    iccid: payload.iccid,
    simSerial: xploriResult.simSerial,
    orderId,
    email: payload.email,
    firstRegion: product.regionCode,
    provider: XPLORI_PROVIDER,
    simType: normalizeString(product.simType),
    status: 'SIM_CREATED',
    startUsingDate: xploriResult.startUsingDate,
    createdAt: new Date().toISOString(),
  };
  await storeSim(simRecord);

  // Best-effort internal notification — never block fulfillment on email.
  try {
    const regionResult = await getRegionByCode(String(product.regionCode || ''));
    const regionName = normalizeString(regionResult.Item?.name) || String(product.regionCode || '');

    await sendInternalOrderConfirm({
      email: payload.email,
      region: regionName,
      plan: normalizeString(product.balance),
      validity: `${normalizeString(product.validity)} Hari`,
      orderType: 'sim',
      price,
      iccid: payload.iccid,
    });
  } catch (error) {
    console.error('Failed to send internal order confirmation email', {
      orderId,
      error: error instanceof Error ? error.message : error,
    });
  }

  return {
    success: true,
    order: {
      orderId,
      productCode: payload.productCode,
      price,
      status: 'ORDER_FULFILLED',
    },
    sim: {
      simId: String(simRecord.SimId),
      iccid: payload.iccid,
      simSerial: xploriResult.simSerial,
      startUsingDate: xploriResult.startUsingDate,
    },
  };
};
