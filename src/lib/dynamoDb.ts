import { GetCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { dynamoDocClient } from './dynamo';

export const sendDynamoCommand = async <T>(command: unknown): Promise<T> =>
  (await dynamoDocClient.send(command as never)) as T;

const ORDERS_TABLE_NAME = 'Order';
const PRODUCT_MAPPING_TABLE_NAME = 'ProductMapping';
const REGION_TABLE_NAME = 'Region';
const PROMO_CODE_TABLE_NAME = 'PromoCode';
const ORDER_STATUS_CREATED_AT_INDEX = 'status-createdAt-index';

export const scanPartnerOrdersByDateRange = async (
  startDate: string,
  endDate: string,
): Promise<{ Count?: number; Items?: Record<string, unknown>[] }> =>
  sendDynamoCommand(
    new ScanCommand({
      TableName: ORDERS_TABLE_NAME,
      FilterExpression:
        '#orderDate BETWEEN :startDate AND :endDate AND attribute_exists(#partner)',
      ExpressionAttributeNames: {
        '#orderDate': 'createdAt',
        '#partner': 'partner',
      },
      ExpressionAttributeValues: {
        ':startDate': startDate,
        ':endDate': endDate,
      },
    }),
  );

export const queryOrdersByStatusAndDateRange = async (
  status: string,
  startDate: string,
  endDate: string,
  lastEvaluatedKey?: Record<string, unknown>,
): Promise<{ Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new QueryCommand({
      TableName: ORDERS_TABLE_NAME,
      IndexName: ORDER_STATUS_CREATED_AT_INDEX,
      KeyConditionExpression: '#status = :status AND #createdAt BETWEEN :startDate AND :endDate',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#createdAt': 'createdAt',
      },
      ExpressionAttributeValues: {
        ':status': status,
        ':startDate': startDate,
        ':endDate': endDate,
      },
      ExclusiveStartKey: lastEvaluatedKey,
    }),
  );

export const getOrderById = async (
  orderId: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: {
        orderId,
      },
    }),
  );

export const updateOrderForceRefund = async (
  orderId: string,
  amount: number,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: {
        orderId,
      },
      UpdateExpression: 'SET #refund = :refund, #forceRefund = :forceRefund',
      ExpressionAttributeNames: {
        '#refund': 'refund',
        '#forceRefund': 'forceRefund',
      },
      ExpressionAttributeValues: {
        ':refund': amount,
        ':forceRefund': true,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

export const updateOrderStatus = async (
  orderId: string,
  status: string,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: ORDERS_TABLE_NAME,
      Key: {
        orderId,
      },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

export const findProductByProductCode = async (
  productCode: string,
): Promise<{ Items?: Record<string, unknown>[] }> =>
  sendDynamoCommand(
    new QueryCommand({
      TableName: PRODUCT_MAPPING_TABLE_NAME,
      KeyConditionExpression: '#code = :code',
      ExpressionAttributeNames: {
        '#code': 'code',
      },
      ExpressionAttributeValues: {
        ':code': productCode,
      },
      Limit: 1,
    }),
  );

export const scanAllProductMappings = async (): Promise<{
  Count?: number;
  Items?: Record<string, unknown>[];
}> =>
  sendDynamoCommand(
    new ScanCommand({
      TableName: PRODUCT_MAPPING_TABLE_NAME,
    }),
  );

export const scanAllRegions = async (): Promise<{ Count?: number; Items?: Record<string, unknown>[] }> =>
  sendDynamoCommand(
    new ScanCommand({
      TableName: REGION_TABLE_NAME,
    }),
  );

export const getPromoCodeByCode = async (
  code: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: PROMO_CODE_TABLE_NAME,
      Key: {
        code,
      },
    }),
  );
