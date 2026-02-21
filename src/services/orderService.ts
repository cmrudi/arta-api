import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

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
