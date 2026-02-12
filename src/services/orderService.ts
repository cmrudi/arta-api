import { ScanCommand } from '@aws-sdk/lib-dynamodb';

import { dynamoDocClient } from '../lib/dynamo';
import { OrderItem } from '../models/order';

const ORDERS_TABLE_NAME = 'Order';
const ORDER_DATE_ATTRIBUTE = 'createdAt';
const PARTNER_ATTRIBUTE = 'partner';

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
