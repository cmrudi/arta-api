import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { randomUUID } from 'crypto';

import { createOrder, findProductByProductCode } from '../lib/dynamoDb';
import { OrderItem } from '../models/order';
import { findDistributorWalletBalance } from './distributorWalletService';

const lambdaClient = new LambdaClient({});

const ESIM_ACCESS_PROVIDER = 'esimaccess';

type CreateDistributorOrderPayload = {
  transactionId: string;
  productCode: string;
  clientId: string;
};

type CreateDistributorOrderSuccessResult = {
  success: true;
  order: OrderItem;
  invokedFunctionName: string;
};

type CreateDistributorOrderErrorResult = {
  success: false;
  reason: 'PRODUCT_NOT_FOUND' | 'PRODUCT_PRICE_INVALID' | 'INSUFFICIENT_BALANCE';
  currentBalance?: number;
  requiredBalance?: number;
};

export type CreateDistributorOrderResult =
  | CreateDistributorOrderSuccessResult
  | CreateDistributorOrderErrorResult;

const invokeLambdaAsyncByName = async (functionName: string, orderId: string): Promise<void> => {
  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ orderId })),
    }),
  );
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const normalizeString = (value: unknown): string => String(value || '').trim();

export const createDistributorOrder = async (
  payload: CreateDistributorOrderPayload,
): Promise<CreateDistributorOrderResult> => {
  const productResult = await findProductByProductCode(payload.productCode);
  const product = (productResult.Items || [])[0] as Record<string, unknown> | undefined;

  if (!product) {
    return {
      success: false,
      reason: 'PRODUCT_NOT_FOUND',
    };
  }

  const wholesalePrice = parseNumber(product.wholesalePrice);

  if (wholesalePrice === null) {
    return {
      success: false,
      reason: 'PRODUCT_PRICE_INVALID',
    };
  }

  const wallet = await findDistributorWalletBalance(payload.clientId);

  if (wallet.balance < wholesalePrice) {
    return {
      success: false,
      reason: 'INSUFFICIENT_BALANCE',
      currentBalance: wallet.balance,
      requiredBalance: wholesalePrice,
    };
  }

  const order: OrderItem = {
    orderId: randomUUID(),
    transactionId: payload.transactionId,
    email: '',
    productCode: payload.productCode,
    price: wholesalePrice * 1000,
    paymentType: 'distributorWallet',
    orderType: 'esim',
    createdAt: new Date().toISOString(),
    status: 'PAID',
  };

  await createOrder(order);

  const provider = normalizeString(product.provider).toLowerCase();
  const functionName =
    provider === ESIM_ACCESS_PROVIDER ? 'esimAccessCreateOrderProfile' : 'mayaEsimIssuance';

  await invokeLambdaAsyncByName(functionName, String(order.orderId));

  return {
    success: true,
    order,
    invokedFunctionName: functionName,
  };
};
