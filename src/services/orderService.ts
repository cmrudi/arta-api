import { GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { dynamoDocClient } from '../lib/dynamo';
import { OrderItem } from '../models/order';

const ORDERS_TABLE_NAME = 'Order';
const ORDER_DATE_ATTRIBUTE = 'createdAt';
const PARTNER_ATTRIBUTE = 'partner';
const ORDER_STATUS_ATTRIBUTE = 'status';
const ORDER_STATUS_CREATED_AT_INDEX = 'status-createdAt-index';
const IN_PROGRESS_STATUSES = ['CREATED', 'PAID', 'ESIM_ORDERED', 'ESIM_FULFILLED'];

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

const ORDER_ID_ATTRIBUTE = 'orderId';
const ORDER_PRICE_ATTRIBUTE = 'price';
const ORDER_REFUND_ATTRIBUTE = 'refund';
const ORDER_FORCE_REFUND_ATTRIBUTE = 'forceRefund';

export const findPartnerOrdersByDateRange = async (
  startDate: string,
  endDate: string,
): Promise<FindOrdersResult> => {
  const command = new ScanCommand({
    TableName: ORDERS_TABLE_NAME,
    FilterExpression:
      '#orderDate BETWEEN :startDate AND :endDate AND attribute_exists(#partner)',
    ExpressionAttributeNames: {
      '#orderDate': ORDER_DATE_ATTRIBUTE,
      '#partner': PARTNER_ATTRIBUTE,
    },
    ExpressionAttributeValues: {
      ':startDate': startDate,
      ':endDate': endDate,
    },
  });

  const result = await dynamoDocClient.send(command);

  return {
    tableName: ORDERS_TABLE_NAME,
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
      const result = await dynamoDocClient.send(
        new QueryCommand({
          TableName: ORDERS_TABLE_NAME,
          IndexName: ORDER_STATUS_CREATED_AT_INDEX,
          KeyConditionExpression:
            '#status = :status AND #createdAt BETWEEN :startDate AND :endDate',
          ExpressionAttributeNames: {
            '#status': ORDER_STATUS_ATTRIBUTE,
            '#createdAt': ORDER_DATE_ATTRIBUTE,
          },
          ExpressionAttributeValues: {
            ':status': status,
            ':startDate': startDate,
            ':endDate': endDate,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        }),
      );

      items.push(...((result.Items || []) as OrderItem[]));
      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);
  }

  return {
    tableName: ORDERS_TABLE_NAME,
    count: items.length,
    items,
  };
};

export const forceRefundOrderById = async (
  orderId: string,
  amount: number,
): Promise<ForceRefundResult> => {
  const getResult = await dynamoDocClient.send(
    new GetCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: {
        [ORDER_ID_ATTRIBUTE]: orderId,
      },
    }),
  );

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

  const updateResult = await dynamoDocClient.send(
    new UpdateCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: {
        [ORDER_ID_ATTRIBUTE]: orderId,
      },
      UpdateExpression: 'SET #refund = :refund, #forceRefund = :forceRefund',
      ExpressionAttributeNames: {
        '#refund': ORDER_REFUND_ATTRIBUTE,
        '#forceRefund': ORDER_FORCE_REFUND_ATTRIBUTE,
      },
      ExpressionAttributeValues: {
        ':refund': amount,
        ':forceRefund': true,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  return {
    success: true,
    item: (updateResult.Attributes || {}) as OrderItem,
  };
};
