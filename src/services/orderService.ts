import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import {
  getOrderById,
  queryOrdersByStatusAndDateRange,
  scanPartnerOrdersByDateRange,
  scanProductMappingByProductCode,
  updateOrderForceRefund,
  updateOrderStatus,
} from '../lib/dynamoDb';
import { OrderItem } from '../models/order';

const ORDER_STATUS_ATTRIBUTE = 'status';
const IN_PROGRESS_STATUSES = ['CREATED', 'PAID', 'ESIM_ORDERED', 'ESIM_FULFILLED'];
const ORDER_TYPE_ATTRIBUTE = 'orderType';
const ORDER_STATUS_CREATED = 'CREATED';
const ORDER_STATUS_PAID = 'PAID';
const ESIM_ACCESS_PROVIDER = 'ESIM_ACCESS';

type FindOrdersResult = {
  tableName: string;
  count: number;
  items: OrderItem[];
};

type ForceRefundSuccessResult = {
  success: true;
  item: OrderItem;
};

type ForceRefundErrorResult = {
  success: false;
  reason: 'ORDER_NOT_FOUND' | 'ORDER_PRICE_INVALID' | 'AMOUNT_EXCEEDS_PRICE';
};

export type ForceRefundResult = ForceRefundSuccessResult | ForceRefundErrorResult;

type RecoverOrderSuccessResult = {
  success: true;
  order: OrderItem;
  midtrans: Record<string, unknown>;
  action: 'NO_ACTION' | 'STATUS_UPDATED_AND_LAMBDA_INVOKED';
  invokedFunctionName?: string;
};

type RecoverOrderErrorResult = {
  success: false;
  reason: 'ORDER_NOT_FOUND' | 'STATUS_NOT_CREATED' | 'PRODUCT_NOT_FOUND' | 'MIDTRANS_FAILED';
  message?: string;
};

export type RecoverOrderResult = RecoverOrderSuccessResult | RecoverOrderErrorResult;

const ORDER_PRICE_ATTRIBUTE = 'price';
const ORDER_PRODUCT_CODE_ATTRIBUTE = 'productCode';

const lambdaClient = new LambdaClient({});

const normalizeString = (value: unknown): string => String(value || '').trim();

const invokeLambdaAsyncByName = async (functionName: string, orderId: string): Promise<void> => {
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ orderId })),
    }),
  );
};

const readProviderByProductCode = async (productCode: string): Promise<string | null> => {
  const result = await scanProductMappingByProductCode(productCode);

  const first = (result.Items || [])[0] as Record<string, unknown> | undefined;

  if (!first) {
    return null;
  }

  return normalizeString(first.provider) || null;
};

const selectRecoveryLambdaName = (orderType: string, provider: string): string => {
  const isTopup = orderType.toLowerCase() === 'topup';
  const isEsimAccess = provider.toUpperCase() === ESIM_ACCESS_PROVIDER;

  if (isTopup) {
    return isEsimAccess ? 'esimAccessTopup' : 'mayaEsimTopup';
  }

  return isEsimAccess ? 'esimAccessCreateOrderProfile' : 'mayaEsimIssuance';
};

const fetchMidtransTransactionStatus = async (orderId: string): Promise<Record<string, unknown>> => {
  const midtransBaseUrl = process.env.MIDTRANS_STATUS_BASE_URL || 'https://api.midtrans.com/v2';
  const midtransAuthorization = process.env.MIDTRANS_AUTHORIZATION || "";

  const response = await fetch(`${midtransBaseUrl}/${orderId}/status`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: midtransAuthorization,
    },
  });

  let payload: Record<string, unknown> = {};

  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(`midtrans request failed with status ${response.status}`);
  }

  return payload;
};

export const findPartnerOrdersByDateRange = async (
  startDate: string,
  endDate: string,
): Promise<FindOrdersResult> => {
  const result = await scanPartnerOrdersByDateRange(startDate, endDate);

  return {
    tableName: 'Order',
    count: result.Count || 0,
    items: (result.Items || []) as OrderItem[],
  };
};

export const findInProgressOrdersByDateRange = async (
  startDate: string,
  endDate: string,
): Promise<FindOrdersResult> => {
  const items: OrderItem[] = [];

  for (const status of IN_PROGRESS_STATUSES) {
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const result = await queryOrdersByStatusAndDateRange(
        status,
        startDate,
        endDate,
        lastEvaluatedKey,
      );

      items.push(...((result.Items || []) as OrderItem[]));
      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);
  }

  return {
    tableName: 'Order',
    count: items.length,
    items,
  };
};

export const forceRefundOrderById = async (
  orderId: string,
  amount: number,
): Promise<ForceRefundResult> => {
  const getResult = await getOrderById(orderId);

  if (!getResult.Item) {
    return {
      success: false,
      reason: 'ORDER_NOT_FOUND',
    };
  }

  const orderPriceRaw = (getResult.Item as Record<string, unknown>)[ORDER_PRICE_ATTRIBUTE];
  const orderPrice =
    typeof orderPriceRaw === 'number' ? orderPriceRaw : Number(String(orderPriceRaw));

  if (Number.isNaN(orderPrice)) {
    return {
      success: false,
      reason: 'ORDER_PRICE_INVALID',
    };
  }

  if (amount > orderPrice) {
    return {
      success: false,
      reason: 'AMOUNT_EXCEEDS_PRICE',
    };
  }

  const updateResult = await updateOrderForceRefund(orderId, amount);

  return {
    success: true,
    item: (updateResult.Attributes || {}) as OrderItem,
  };
};

export const recoverOrderById = async (orderId: string): Promise<RecoverOrderResult> => {
  const getOrderResult = await getOrderById(orderId);

  if (!getOrderResult.Item) {
    return {
      success: false,
      reason: 'ORDER_NOT_FOUND',
    };
  }

  const order = getOrderResult.Item as Record<string, unknown>;
  const status = normalizeString(order[ORDER_STATUS_ATTRIBUTE]);

  if (status !== ORDER_STATUS_CREATED) {
    return {
      success: false,
      reason: 'STATUS_NOT_CREATED',
    };
  }

  let midtransResponse: Record<string, unknown>;

  try {
    midtransResponse = await fetchMidtransTransactionStatus(orderId);
  } catch (error) {
    return {
      success: false,
      reason: 'MIDTRANS_FAILED',
      message: error instanceof Error ? error.message : 'unknown error',
    };
  }

  const transactionStatus = normalizeString(midtransResponse.transaction_status).toLowerCase();

  if (transactionStatus !== 'settlement') {
    return {
      success: true,
      order: order as OrderItem,
      midtrans: midtransResponse,
      action: 'NO_ACTION',
    };
  }

  const updateResult = await updateOrderStatus(orderId, ORDER_STATUS_PAID);

  const updatedOrder = (updateResult.Attributes || {}) as Record<string, unknown>;
  const productCode = normalizeString(updatedOrder[ORDER_PRODUCT_CODE_ATTRIBUTE]);
  const orderType = normalizeString(updatedOrder[ORDER_TYPE_ATTRIBUTE]);

  const provider = await readProviderByProductCode(productCode);

  if (!provider) {
    return {
      success: false,
      reason: 'PRODUCT_NOT_FOUND',
    };
  }

  const functionName = selectRecoveryLambdaName(orderType, provider);
  await invokeLambdaAsyncByName(functionName, orderId);

  return {
    success: true,
    order: updatedOrder as OrderItem,
    midtrans: midtransResponse,
    action: 'STATUS_UPDATED_AND_LAMBDA_INVOKED',
    invokedFunctionName: functionName,
  };
};
