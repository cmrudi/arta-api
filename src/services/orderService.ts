import { ScanCommand } from '@aws-sdk/lib-dynamodb';

import { dynamoDocClient } from '../lib/dynamo';
import { OrderItem } from '../models/order';

const ORDERS_TABLE_NAME = 'Order';
const ORDER_DATE_ATTRIBUTE = 'createdAt';
const PARTNER_ATTRIBUTE = 'partner';
const ORDER_STATUS_ATTRIBUTE = 'status';
const ORDER_STATUS_PAYMENT_EXPIRED = 'PAYMENT_EXPIRED';
const ORDER_STATUS_TOP_UP_COMPLETED = 'TOP_UP_COMPLETED';
const ORDER_STATUS_ESIM_PUBLISHED = 'ESIM_PUBLISHED';

type FindOrdersResult = {
  tableName: string;
  count: number;
  items: OrderItem[];
};

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
  const command = new ScanCommand({
    TableName: ORDERS_TABLE_NAME,
    FilterExpression:
      '#orderDate BETWEEN :startDate AND :endDate AND (attribute_not_exists(#status) OR (#status <> :paymentExpired AND #status <> :topUpCompleted AND #status <> :esimPublished))',
    ExpressionAttributeNames: {
      '#orderDate': ORDER_DATE_ATTRIBUTE,
      '#status': ORDER_STATUS_ATTRIBUTE,
    },
    ExpressionAttributeValues: {
      ':startDate': startDate,
      ':endDate': endDate,
      ':paymentExpired': ORDER_STATUS_PAYMENT_EXPIRED,
      ':topUpCompleted': ORDER_STATUS_TOP_UP_COMPLETED,
      ':esimPublished': ORDER_STATUS_ESIM_PUBLISHED,
    },
  });

  const result = await dynamoDocClient.send(command);

  return {
    tableName: ORDERS_TABLE_NAME,
    count: result.Count || 0,
    items: (result.Items || []) as OrderItem[],
  };
};
