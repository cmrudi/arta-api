import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { dynamoDocClient } from './dynamo';

export const sendDynamoCommand = async <T>(command: unknown): Promise<T> =>
  (await dynamoDocClient.send(command as never)) as T;

const ORDERS_TABLE_NAME = 'Order';
const PRODUCT_MAPPING_TABLE_NAME = 'ProductMapping';
const REGION_TABLE_NAME = 'Region';
const PROMO_CODE_TABLE_NAME = 'PromoCode';
const DISTRIBUTOR_WALLET_TABLE_NAME = 'DistributorWallet';
const SUPPLIER_COST_TABLE_NAME = 'SupplierCost';
const SIM_CARDS_TABLE_NAME = 'SIMCards';
const SIM_CARDS_ICCID_INDEX = 'iccid-index';
const SIM_CARD_INVENTORY_TABLE_NAME = 'SIMCardInventory';
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

// simType is stored as a DynamoDB Number, so filter with a numeric value when
// the query param is numeric. Only enabled products are returned.
export const scanEnabledProductMappingsBySimType = async (
  simType: string,
): Promise<{ Count?: number; Items?: Record<string, unknown>[] }> => {
  const numeric = Number(simType);
  const simTypeValue: number | string = Number.isFinite(numeric) ? numeric : simType;

  return sendDynamoCommand(
    new ScanCommand({
      TableName: PRODUCT_MAPPING_TABLE_NAME,
      FilterExpression: '#simType = :simType AND #enabled = :enabled',
      ExpressionAttributeNames: {
        '#simType': 'simType',
        '#enabled': 'enabled',
      },
      ExpressionAttributeValues: {
        ':simType': simTypeValue,
        ':enabled': true,
      },
    }),
  );
};

export const scanAllProductMappingsPaginated = async (
  lastEvaluatedKey?: Record<string, unknown>,
): Promise<{
  Items?: Record<string, unknown>[];
  LastEvaluatedKey?: Record<string, unknown>;
}> =>
  sendDynamoCommand(
    new ScanCommand({
      TableName: PRODUCT_MAPPING_TABLE_NAME,
      ExclusiveStartKey: lastEvaluatedKey,
    }),
  );

export const scanAllSupplierCostsPaginated = async (
  lastEvaluatedKey?: Record<string, unknown>,
): Promise<{
  Items?: Record<string, unknown>[];
  LastEvaluatedKey?: Record<string, unknown>;
}> =>
  sendDynamoCommand(
    new ScanCommand({
      TableName: SUPPLIER_COST_TABLE_NAME,
      ExclusiveStartKey: lastEvaluatedKey,
    }),
  );

export const putSupplierCost = async (
  item: Record<string, unknown>,
): Promise<Record<string, unknown>> =>
  sendDynamoCommand(
    new PutCommand({
      TableName: SUPPLIER_COST_TABLE_NAME,
      Item: item,
    }),
  );

export const updateSupplierCostByProductCode = async (
  productCode: string,
  cost: number,
  updatedAt: string,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: SUPPLIER_COST_TABLE_NAME,
      Key: { productCode },
      UpdateExpression: 'SET #cost = :cost, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#cost': 'cost',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':cost': cost,
        ':updatedAt': updatedAt,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

export const scanAllRegions = async (): Promise<{ Count?: number; Items?: Record<string, unknown>[] }> =>
  sendDynamoCommand(
    new ScanCommand({
      TableName: REGION_TABLE_NAME,
    }),
  );

export const getRegionByCode = async (
  regionCode: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: REGION_TABLE_NAME,
      Key: {
        regionCode,
      },
    }),
  );

export const storeSim = async (
  sim: Record<string, unknown>,
): Promise<Record<string, unknown>> =>
  sendDynamoCommand(
    new PutCommand({
      TableName: SIM_CARDS_TABLE_NAME,
      Item: sim,
    }),
  );

export const querySimCardsByIccid = async (
  iccid: string,
): Promise<{ Items?: Record<string, unknown>[] }> =>
  sendDynamoCommand(
    new QueryCommand({
      TableName: SIM_CARDS_TABLE_NAME,
      IndexName: SIM_CARDS_ICCID_INDEX,
      KeyConditionExpression: '#iccid = :iccid',
      ExpressionAttributeNames: {
        '#iccid': 'iccid',
      },
      ExpressionAttributeValues: {
        ':iccid': iccid,
      },
    }),
  );

// SIMCardInventory partition key is "Iccid" (capital I), stored as a String.
export const getSimInventoryByIccid = async (
  iccid: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: SIM_CARD_INVENTORY_TABLE_NAME,
      Key: {
        Iccid: iccid,
      },
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

export const getDistributorWalletByClientId = async (
  distributorId: string,
): Promise<{ Items?: Record<string, unknown>[] }> =>
  sendDynamoCommand(
    new QueryCommand({
      TableName: DISTRIBUTOR_WALLET_TABLE_NAME,
      KeyConditionExpression: '#distributorId = :distributorId',
      ExpressionAttributeNames: {
        '#distributorId': 'distributorId',
      },
      ExpressionAttributeValues: {
        ':distributorId': distributorId,
      },
      Limit: 1,
    }),
  );

export const createOrder = async (
  order: Record<string, unknown>,
): Promise<Record<string, unknown>> =>
  sendDynamoCommand(
    new PutCommand({
      TableName: ORDERS_TABLE_NAME,
      Item: order,
    }),
  );

export const reduceDistributorWalletBalance = async (
  distributorId: string,
  amount: number,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: DISTRIBUTOR_WALLET_TABLE_NAME,
      Key: { distributorId },
      UpdateExpression: 'SET balance = balance - :amt',
      ConditionExpression: 'balance >= :amt',
      ExpressionAttributeValues: { ':amt': amount },
      ReturnValues: 'UPDATED_NEW',
    }),
  );

export const increaseDistributorWalletBalance = async (
  distributorId: string,
  amount: number,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: DISTRIBUTOR_WALLET_TABLE_NAME,
      Key: { distributorId },
      UpdateExpression: 'SET balance = balance + :amt',
      ExpressionAttributeValues: { ':amt': amount },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
