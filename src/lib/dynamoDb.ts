import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import {
  PartnerBankAccount,
  PartnerLedgerEntry,
  PartnerWithdrawal,
  WithdrawalEvent,
  WithdrawalStatus,
} from '../models/partnerPayout';
import { PromoCodeItem } from '../models/promoCode';
import { PromoCodeRedemptionItem } from '../models/promoCodeRedemption';
import { RefundEvent, RefundItem, RefundStatus } from '../models/refund';
import { dynamoDocClient } from './dynamo';

export const sendDynamoCommand = async <T>(command: unknown): Promise<T> =>
  (await dynamoDocClient.send(command as never)) as T;

const ORDERS_TABLE_NAME = 'Order';
const PRODUCT_MAPPING_TABLE_NAME = 'ProductMapping';
const REGION_TABLE_NAME = 'Region';
const PROMO_CODE_TABLE_NAME = 'PromoCode';
const PROMO_CODE_REDEMPTION_TABLE_NAME = 'PromoCodeRedemption';
const PROMO_CODE_REDEMPTION_PROMO_STATUS_INDEX = 'promoCode-status-index';
const DISTRIBUTOR_WALLET_TABLE_NAME = 'DistributorWallet';
const SUPPLIER_COST_TABLE_NAME = 'SupplierCost';
const SIM_CARDS_TABLE_NAME = 'SIMCards';
const SIM_CARDS_ICCID_INDEX = 'iccid-index';
const SIM_CARD_INVENTORY_TABLE_NAME = 'SIMCardInventory';
const SIM_REVIEW_TABLE_NAME = 'SimReview';
const ORDER_STATUS_CREATED_AT_INDEX = 'status-createdAt-index';
const REFUND_TABLE_NAME = 'Refund';
const REFUND_STATUS_CREATED_AT_INDEX = 'status-createdAt-index';
const PARTNER_WALLET_TABLE_NAME = 'PartnerWallet';
const PARTNER_LEDGER_TABLE_NAME = 'PartnerLedger';
const PARTNER_LEDGER_PARTNER_CREATED_AT_INDEX = 'partnerId-createdAt-index';
const PARTNER_WITHDRAWAL_TABLE_NAME = 'PartnerWithdrawal';
const PARTNER_WITHDRAWAL_STATUS_CREATED_AT_INDEX = 'status-createdAt-index';
const PARTNER_WITHDRAWAL_PARTNER_CREATED_AT_INDEX = 'partnerId-createdAt-index';
const PARTNER_ACCOUNT_TABLE_NAME = 'PartnerAccount';
const PARTNER_ACCOUNT_EMAIL_INDEX = 'email-index';
const PARTNER_ACCOUNT_KEY_INDEX = 'key-index';
const ORDER_PARTNER_ID_CREATED_AT_INDEX = 'partnerId-createdAt-index';

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

// SIMCards partition key is "SimId" (capital S).
export const getSimBySimId = async (
  simId: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: SIM_CARDS_TABLE_NAME,
      Key: { SimId: simId },
    }),
  );

export const getSimReview = async (
  simId: string,
  kind: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: SIM_REVIEW_TABLE_NAME,
      Key: { SimId: simId, kind },
    }),
  );

export const querySimReviews = async (
  simId: string,
): Promise<{ Items?: Record<string, unknown>[] }> =>
  sendDynamoCommand(
    new QueryCommand({
      TableName: SIM_REVIEW_TABLE_NAME,
      KeyConditionExpression: '#SimId = :simId',
      ExpressionAttributeNames: { '#SimId': 'SimId' },
      ExpressionAttributeValues: { ':simId': simId },
    }),
  );

export const putSimReview = async (
  review: Record<string, unknown>,
): Promise<Record<string, unknown>> =>
  sendDynamoCommand(
    new PutCommand({
      TableName: SIM_REVIEW_TABLE_NAME,
      Item: review,
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

// SIMCards partition key is "SimId" (capital S).
export const updateSimCardEmail = async (
  simId: string,
  email: string,
  updatedAt: string,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: SIM_CARDS_TABLE_NAME,
      Key: { SimId: simId },
      UpdateExpression: 'SET #email = :email, #updatedAt = :updatedAt',
      ConditionExpression: 'attribute_exists(SimId)',
      ExpressionAttributeNames: {
        '#email': 'email',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':email': email,
        ':updatedAt': updatedAt,
      },
      ReturnValues: 'ALL_NEW',
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

// Marks an inventory iccid as used. ConditionExpression guards against creating
// a phantom row if the iccid isn't actually in inventory.
export const markSimInventoryUsed = async (
  iccid: string,
  orderId: string,
  usedAt: string,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: SIM_CARD_INVENTORY_TABLE_NAME,
      Key: { Iccid: iccid },
      UpdateExpression: 'SET #status = :status, #usedAt = :usedAt, #orderId = :orderId',
      ConditionExpression: 'attribute_exists(Iccid)',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#usedAt': 'usedAt',
        '#orderId': 'orderId',
      },
      ExpressionAttributeValues: {
        ':status': 'USED',
        ':usedAt': usedAt,
        ':orderId': orderId,
      },
      ReturnValues: 'ALL_NEW',
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

export const scanAllPromoCodes = async (): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await sendDynamoCommand<{
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    }>(
      new ScanCommand({
        TableName: PROMO_CODE_TABLE_NAME,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(page.Items || []));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

/** Writes a new promo code; fails with ConditionalCheckFailedException if the code exists. */
export const createPromoCode = async (promo: PromoCodeItem): Promise<void> => {
  await sendDynamoCommand(
    new PutCommand({
      TableName: PROMO_CODE_TABLE_NAME,
      Item: promo,
      ConditionExpression: 'attribute_not_exists(#code)',
      ExpressionAttributeNames: { '#code': 'code' },
    }),
  );
};

/** Fails with ConditionalCheckFailedException if the code does not exist. */
export const setPromoCodeActive = async (
  code: string,
  isActive: boolean,
  updatedBy: string,
): Promise<{ Attributes?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new UpdateCommand({
      TableName: PROMO_CODE_TABLE_NAME,
      Key: { code },
      UpdateExpression: 'SET #isActive = :isActive, #updatedAt = :updatedAt, #updatedBy = :updatedBy',
      ConditionExpression: 'attribute_exists(#code)',
      ExpressionAttributeNames: {
        '#code': 'code',
        '#isActive': 'isActive',
        '#updatedAt': 'updatedAt',
        '#updatedBy': 'updatedBy',
      },
      ExpressionAttributeValues: {
        ':isActive': isActive,
        ':updatedAt': new Date().toISOString(),
        ':updatedBy': updatedBy,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

export const putPromoCodeRedemption = async (
  redemption: PromoCodeRedemptionItem,
): Promise<Record<string, unknown>> =>
  sendDynamoCommand(
    new PutCommand({
      TableName: PROMO_CODE_REDEMPTION_TABLE_NAME,
      Item: redemption,
    }),
  );

/**
 * Total COMPLETED redemptions for a promo code, across all customers — the
 * figure a promo's maxUsage is measured against.
 *
 * A COUNT query still pages at 1MB of scanned data, so this walks every page:
 * stopping at the first would silently under-count a popular code and let it
 * overshoot its limit.
 */
export const countCompletedRedemptionsByPromoCode = async (
  promoCode: string,
): Promise<number> => {
  let total = 0;
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await sendDynamoCommand<{
      Count?: number;
      LastEvaluatedKey?: Record<string, unknown>;
    }>(
      new QueryCommand({
        TableName: PROMO_CODE_REDEMPTION_TABLE_NAME,
        IndexName: PROMO_CODE_REDEMPTION_PROMO_STATUS_INDEX,
        KeyConditionExpression: '#promoCode = :promoCode AND #status = :status',
        ExpressionAttributeNames: {
          '#promoCode': 'promoCode',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':promoCode': promoCode,
          ':status': 'COMPLETED',
        },
        Select: 'COUNT',
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    total += page.Count || 0;
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return total;
};

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

/**
 * Store a new refund and claim the order for it in one transaction. The
 * condition on the Order row is what makes "one refund per order" hold even
 * when two requests race.
 */
export const createRefundForOrder = async (refund: RefundItem): Promise<void> => {
  await sendDynamoCommand(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: REFUND_TABLE_NAME,
            Item: refund,
            ConditionExpression: 'attribute_not_exists(refundId)',
          },
        },
        {
          Update: {
            TableName: ORDERS_TABLE_NAME,
            Key: { orderId: refund.orderId },
            UpdateExpression: 'SET #refundId = :refundId, #refundStatus = :refundStatus',
            ConditionExpression: 'attribute_exists(orderId) AND attribute_not_exists(#refundId)',
            ExpressionAttributeNames: {
              '#refundId': 'refundId',
              '#refundStatus': 'refundStatus',
            },
            ExpressionAttributeValues: {
              ':refundId': refund.refundId,
              ':refundStatus': refund.status,
            },
          },
        },
      ],
    }),
  );
};

export const getRefundById = async (
  refundId: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: REFUND_TABLE_NAME,
      Key: { refundId },
    }),
  );

// Oldest first, so the request closest to its deadline is at the top.
export const queryRefundsByStatus = async (
  status: RefundStatus,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await sendDynamoCommand<{
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    }>(
      new QueryCommand({
        TableName: REFUND_TABLE_NAME,
        IndexName: REFUND_STATUS_CREATED_AT_INDEX,
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(page.Items || []));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

/**
 * Move a refund from one of `from` to `to`, record the event, and mirror the
 * new status onto the Order row - all in one transaction. Throws
 * TransactionCanceledException when the refund is no longer in `from`, which
 * is how a double-click on "approve" becomes a no-op instead of a second
 * cancellation.
 */
export const transitionRefund = async (params: {
  refundId: string;
  orderId: string;
  from: readonly RefundStatus[];
  to: RefundStatus;
  event: RefundEvent;
  set?: Record<string, unknown>;
  incrementRetry?: boolean;
}): Promise<void> => {
  const names: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
    '#events': 'events',
  };
  const values: Record<string, unknown> = {
    ':to': params.to,
    ':updatedAt': params.event.at,
    ':event': [params.event],
    ':empty': [],
  };
  const assignments = [
    '#status = :to',
    '#updatedAt = :updatedAt',
    '#events = list_append(if_not_exists(#events, :empty), :event)',
  ];

  Object.entries(params.set || {}).forEach(([key, value], index) => {
    names[`#f${index}`] = key;
    values[`:v${index}`] = value;
    assignments.push(`#f${index} = :v${index}`);
  });

  if (params.incrementRetry) {
    names['#retryCount'] = 'retryCount';
    values[':zero'] = 0;
    values[':one'] = 1;
    assignments.push('#retryCount = if_not_exists(#retryCount, :zero) + :one');
  }

  const fromKeys = params.from.map((status, index) => {
    values[`:from${index}`] = status;
    return `:from${index}`;
  });

  await sendDynamoCommand(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: REFUND_TABLE_NAME,
            Key: { refundId: params.refundId },
            UpdateExpression: `SET ${assignments.join(', ')}`,
            ConditionExpression: `#status IN (${fromKeys.join(', ')})`,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          },
        },
        {
          Update: {
            TableName: ORDERS_TABLE_NAME,
            Key: { orderId: params.orderId },
            UpdateExpression: 'SET #refundStatus = :to',
            ConditionExpression: '#refundId = :refundId',
            ExpressionAttributeNames: {
              '#refundStatus': 'refundStatus',
              '#refundId': 'refundId',
            },
            ExpressionAttributeValues: {
              ':to': params.to,
              ':refundId': params.refundId,
            },
          },
        },
      ],
    }),
  );
};

// ---------------------------------------------------------------------------
// Partner payouts. See models/partnerPayout.ts for the table layout. Every
// write that moves money is one transaction over the wallet, the ledger entry
// and (for withdrawals) the withdrawal row.

export const getPartnerWallet = async (
  partnerId: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: PARTNER_WALLET_TABLE_NAME,
      Key: { partnerId },
    }),
  );

export const scanPartnerWallets = async (): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await sendDynamoCommand<{
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    }>(
      new ScanCommand({
        TableName: PARTNER_WALLET_TABLE_NAME,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(page.Items || []));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

// Newest first, capped: the portal and the admin sheet show recent history.
export const queryPartnerLedgerByPartnerId = async (
  partnerId: string,
  limit: number,
): Promise<Record<string, unknown>[]> => {
  const page = await sendDynamoCommand<{ Items?: Record<string, unknown>[] }>(
    new QueryCommand({
      TableName: PARTNER_LEDGER_TABLE_NAME,
      IndexName: PARTNER_LEDGER_PARTNER_CREATED_AT_INDEX,
      KeyConditionExpression: '#partnerId = :partnerId',
      ExpressionAttributeNames: { '#partnerId': 'partnerId' },
      ExpressionAttributeValues: { ':partnerId': partnerId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  return page.Items || [];
};

/**
 * Finance posts a CREDIT (amount > 0) or DEBIT (amount < 0). The first credit
 * creates the wallet. A debit may not take the available balance below zero.
 * The ledger entry's entryId comes from the admin client, so a resubmitted
 * request fails the attribute_not_exists condition instead of paying twice.
 */
export const adjustPartnerWallet = async (params: {
  entry: PartnerLedgerEntry;
  partnerKey?: string;
  partnerName?: string;
}): Promise<void> => {
  const { entry } = params;
  const names: Record<string, string> = {
    '#email': 'email',
    '#balance': 'balance',
    '#onHold': 'onHold',
    '#totalCredited': 'totalCredited',
    '#totalPaidOut': 'totalPaidOut',
    '#createdAt': 'createdAt',
    '#updatedAt': 'updatedAt',
  };
  const values: Record<string, unknown> = {
    ':email': entry.email,
    ':amt': entry.amount,
    ':zero': 0,
    ':now': entry.createdAt,
  };
  const assignments = [
    // The wallet keeps a copy of the partner's current email for finance.
    '#email = :email',
    '#balance = if_not_exists(#balance, :zero) + :amt',
    '#totalCredited = if_not_exists(#totalCredited, :zero) + :amt',
    '#onHold = if_not_exists(#onHold, :zero)',
    '#totalPaidOut = if_not_exists(#totalPaidOut, :zero)',
    '#createdAt = if_not_exists(#createdAt, :now)',
    '#updatedAt = :now',
  ];

  if (params.partnerKey) {
    names['#partnerKey'] = 'partnerKey';
    values[':partnerKey'] = params.partnerKey;
    assignments.push('#partnerKey = :partnerKey');
  }

  if (params.partnerName) {
    names['#partnerName'] = 'partnerName';
    values[':partnerName'] = params.partnerName;
    assignments.push('#partnerName = :partnerName');
  }

  let condition: string | undefined;

  if (entry.amount < 0) {
    values[':debit'] = -entry.amount;
    condition = 'attribute_exists(#balance) AND #balance >= :debit';
  }

  await sendDynamoCommand(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: PARTNER_LEDGER_TABLE_NAME,
            Item: entry,
            ConditionExpression: 'attribute_not_exists(entryId)',
          },
        },
        {
          Update: {
            TableName: PARTNER_WALLET_TABLE_NAME,
            Key: { partnerId: entry.partnerId },
            UpdateExpression: `SET ${assignments.join(', ')}`,
            ...(condition ? { ConditionExpression: condition } : {}),
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
          },
        },
      ],
    }),
  );
};

/**
 * Move the amount from `balance` to `onHold`, mark the wallet as having an open
 * withdrawal, and store the request. Fails the condition when the balance is
 * short or another withdrawal is still open.
 */
export const createPartnerWithdrawal = async (params: {
  withdrawal: PartnerWithdrawal;
  entry: PartnerLedgerEntry;
}): Promise<void> => {
  const { withdrawal, entry } = params;

  await sendDynamoCommand(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: PARTNER_WALLET_TABLE_NAME,
            Key: { partnerId: withdrawal.partnerId },
            UpdateExpression:
              'SET #balance = #balance - :amt, #onHold = if_not_exists(#onHold, :zero) + :amt, ' +
              '#openWithdrawalId = :id, #bankAccount = :bank, #updatedAt = :now',
            ConditionExpression:
              'attribute_exists(#balance) AND #balance >= :amt AND attribute_not_exists(#openWithdrawalId)',
            ExpressionAttributeNames: {
              '#balance': 'balance',
              '#onHold': 'onHold',
              '#openWithdrawalId': 'openWithdrawalId',
              '#bankAccount': 'bankAccount',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':amt': withdrawal.amount,
              ':zero': 0,
              ':id': withdrawal.withdrawalId,
              ':bank': withdrawal.bankAccount as PartnerBankAccount,
              ':now': withdrawal.createdAt,
            },
          },
        },
        {
          Put: {
            TableName: PARTNER_WITHDRAWAL_TABLE_NAME,
            Item: withdrawal,
            ConditionExpression: 'attribute_not_exists(withdrawalId)',
          },
        },
        {
          Put: {
            TableName: PARTNER_LEDGER_TABLE_NAME,
            Item: entry,
            ConditionExpression: 'attribute_not_exists(entryId)',
          },
        },
      ],
    }),
  );
};

export const getPartnerWithdrawalById = async (
  withdrawalId: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: PARTNER_WITHDRAWAL_TABLE_NAME,
      Key: { withdrawalId },
    }),
  );

// Oldest first, so the request waiting longest is at the top of the queue.
export const queryPartnerWithdrawalsByStatus = async (
  status: WithdrawalStatus,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await sendDynamoCommand<{
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    }>(
      new QueryCommand({
        TableName: PARTNER_WITHDRAWAL_TABLE_NAME,
        IndexName: PARTNER_WITHDRAWAL_STATUS_CREATED_AT_INDEX,
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':status': status },
        ScanIndexForward: true,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(page.Items || []));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

// Newest first, capped, for the partner's own history.
export const queryPartnerWithdrawalsByPartnerId = async (
  partnerId: string,
  limit: number,
): Promise<Record<string, unknown>[]> => {
  const page = await sendDynamoCommand<{ Items?: Record<string, unknown>[] }>(
    new QueryCommand({
      TableName: PARTNER_WITHDRAWAL_TABLE_NAME,
      IndexName: PARTNER_WITHDRAWAL_PARTNER_CREATED_AT_INDEX,
      KeyConditionExpression: '#partnerId = :partnerId',
      ExpressionAttributeNames: { '#partnerId': 'partnerId' },
      ExpressionAttributeValues: { ':partnerId': partnerId },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );

  return page.Items || [];
};

/**
 * Move a withdrawal from one of `from` to `to` and record the event. What
 * happens to the wallet depends on where it lands:
 *
 *   APPROVED            wallet untouched
 *   PAID                onHold -= amount, totalPaidOut += amount, close it
 *   REJECTED/CANCELLED  onHold -= amount, balance += amount, close it, and
 *                       write the WITHDRAWAL_RETURNED ledger entry
 *
 * The status condition makes a double-click a TransactionCanceledException
 * instead of paying or refunding twice; the openWithdrawalId condition keeps
 * the wallet tied to this exact withdrawal.
 */
export const transitionPartnerWithdrawal = async (params: {
  withdrawal: { withdrawalId: string; partnerId: string; amount: number };
  from: readonly WithdrawalStatus[];
  to: WithdrawalStatus;
  event: WithdrawalEvent;
  set?: Record<string, unknown>;
  returnEntry?: PartnerLedgerEntry;
}): Promise<void> => {
  const { withdrawal } = params;
  const names: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
    '#events': 'events',
  };
  const values: Record<string, unknown> = {
    ':to': params.to,
    ':updatedAt': params.event.at,
    ':event': [params.event],
    ':empty': [],
  };
  const assignments = [
    '#status = :to',
    '#updatedAt = :updatedAt',
    '#events = list_append(if_not_exists(#events, :empty), :event)',
  ];

  Object.entries(params.set || {}).forEach(([key, value], index) => {
    names[`#f${index}`] = key;
    values[`:v${index}`] = value;
    assignments.push(`#f${index} = :v${index}`);
  });

  const fromKeys = params.from.map((status, index) => {
    values[`:from${index}`] = status;
    return `:from${index}`;
  });

  const transactItems: Record<string, unknown>[] = [
    {
      Update: {
        TableName: PARTNER_WITHDRAWAL_TABLE_NAME,
        Key: { withdrawalId: withdrawal.withdrawalId },
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ConditionExpression: `#status IN (${fromKeys.join(', ')})`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    },
  ];

  const releases = params.to === 'REJECTED' || params.to === 'CANCELLED';

  if (params.to === 'PAID' || releases) {
    transactItems.push({
      Update: {
        TableName: PARTNER_WALLET_TABLE_NAME,
        Key: { partnerId: withdrawal.partnerId },
        UpdateExpression: releases
          ? 'SET #onHold = #onHold - :amt, #balance = #balance + :amt, #updatedAt = :now REMOVE #openWithdrawalId'
          : 'SET #onHold = #onHold - :amt, #totalPaidOut = if_not_exists(#totalPaidOut, :zero) + :amt, #updatedAt = :now REMOVE #openWithdrawalId',
        ConditionExpression: '#openWithdrawalId = :id',
        ExpressionAttributeNames: {
          '#onHold': 'onHold',
          '#openWithdrawalId': 'openWithdrawalId',
          '#updatedAt': 'updatedAt',
          ...(releases ? { '#balance': 'balance' } : { '#totalPaidOut': 'totalPaidOut' }),
        },
        ExpressionAttributeValues: {
          ':amt': withdrawal.amount,
          ':id': withdrawal.withdrawalId,
          ':now': params.event.at,
          ...(releases ? {} : { ':zero': 0 }),
        },
      },
    });
  }

  if (releases && params.returnEntry) {
    transactItems.push({
      Put: {
        TableName: PARTNER_LEDGER_TABLE_NAME,
        Item: params.returnEntry,
        ConditionExpression: 'attribute_not_exists(entryId)',
      },
    });
  }

  await sendDynamoCommand(new TransactWriteCommand({ TransactItems: transactItems as never }));
};

// ---------------------------------------------------------------------------
// Partner accounts. See models/partner.ts for the layout.

export const getPartnerAccount = async (
  partnerId: string,
): Promise<{ Item?: Record<string, unknown> }> =>
  sendDynamoCommand(
    new GetCommand({
      TableName: PARTNER_ACCOUNT_TABLE_NAME,
      Key: { partnerId },
    }),
  );

const queryPartnerAccountsBy = async (indexName: string, attribute: string, value: string): Promise<Record<string, unknown>[]> => {
  const page = await sendDynamoCommand<{ Items?: Record<string, unknown>[] }>(
    new QueryCommand({
      TableName: PARTNER_ACCOUNT_TABLE_NAME,
      IndexName: indexName,
      KeyConditionExpression: '#attr = :value',
      ExpressionAttributeNames: { '#attr': attribute },
      ExpressionAttributeValues: { ':value': value },
    }),
  );

  return page.Items || [];
};

/** Every account with this login email; normally one (see models/partner.ts). */
export const queryPartnerAccountsByEmail = (email: string): Promise<Record<string, unknown>[]> =>
  queryPartnerAccountsBy(PARTNER_ACCOUNT_EMAIL_INDEX, 'email', email);

/** Every account with this affiliate key; normally one (see models/partner.ts). */
export const queryPartnerAccountsByKey = (key: string): Promise<Record<string, unknown>[]> =>
  queryPartnerAccountsBy(PARTNER_ACCOUNT_KEY_INDEX, 'key', key);

export const scanPartnerAccounts = async (prefix: string): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await sendDynamoCommand<{
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    }>(
      new ScanCommand({
        TableName: PARTNER_ACCOUNT_TABLE_NAME,
        FilterExpression: 'begins_with(#partnerId, :prefix)',
        ExpressionAttributeNames: { '#partnerId': 'partnerId' },
        ExpressionAttributeValues: { ':prefix': prefix },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(page.Items || []));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items;
};

/** A new partner. Fails the condition only if the random partnerId exists. */
export const createPartnerAccount = async (account: {
  partnerId: string;
  email: string;
  key: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
}): Promise<void> => {
  await sendDynamoCommand(
    new PutCommand({
      TableName: PARTNER_ACCOUNT_TABLE_NAME,
      Item: account,
      ConditionExpression: 'attribute_not_exists(partnerId)',
    }),
  );
};

/** Re-check cleanup: remove a duplicate account that was just created. */
export const deletePartnerAccount = async (partnerId: string): Promise<void> => {
  await sendDynamoCommand(
    new DeleteCommand({
      TableName: PARTNER_ACCOUNT_TABLE_NAME,
      Key: { partnerId },
      ConditionExpression: 'attribute_exists(partnerId)',
    }),
  );
};

/** Set a partner's login email, only if it is still the one we read. */
export const setPartnerAccountEmail = async (params: {
  partnerId: string;
  oldEmail: string;
  newEmail: string;
  now: string;
}): Promise<void> => {
  await sendDynamoCommand(
    new UpdateCommand({
      TableName: PARTNER_ACCOUNT_TABLE_NAME,
      Key: { partnerId: params.partnerId },
      UpdateExpression: 'SET #email = :new, #updatedAt = :now',
      ConditionExpression: '#email = :old',
      ExpressionAttributeNames: { '#email': 'email', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':new': params.newEmail, ':old': params.oldEmail, ':now': params.now },
    }),
  );
};

/**
 * Give a partner a new affiliate key, only if their key is still the one we
 * read. The old key goes to `previousKeys` (history for finance; it no longer
 * credits new sales).
 */
export const setPartnerAccountKey = async (params: {
  partnerId: string;
  oldKey: string;
  newKey: string;
  now: string;
  keepHistory: boolean;
}): Promise<void> => {
  // An account without a key yet: the condition is that it still has none.
  const hadKey = Boolean(params.oldKey);
  const keepHistory = params.keepHistory && hadKey;

  await sendDynamoCommand(
    new UpdateCommand({
      TableName: PARTNER_ACCOUNT_TABLE_NAME,
      Key: { partnerId: params.partnerId },
      UpdateExpression: keepHistory
        ? 'SET #key = :new, #updatedAt = :now, #previousKeys = list_append(if_not_exists(#previousKeys, :empty), :old_list)'
        : 'SET #key = :new, #updatedAt = :now',
      ConditionExpression: hadKey ? '#key = :old' : 'attribute_exists(partnerId) AND attribute_not_exists(#key)',
      ExpressionAttributeNames: {
        '#key': 'key',
        '#updatedAt': 'updatedAt',
        ...(keepHistory ? { '#previousKeys': 'previousKeys' } : {}),
      },
      ExpressionAttributeValues: {
        ':new': params.newKey,
        ':now': params.now,
        ...(hadKey ? { ':old': params.oldKey } : {}),
        ...(keepHistory ? { ':empty': [], ':old_list': [params.oldKey] } : {}),
      },
    }),
  );
};

export const updatePartnerAccountName = async (params: {
  partnerId: string;
  name: string;
  now: string;
}): Promise<void> => {
  await sendDynamoCommand(
    new UpdateCommand({
      TableName: PARTNER_ACCOUNT_TABLE_NAME,
      Key: { partnerId: params.partnerId },
      UpdateExpression: 'SET #name = :name, #updatedAt = :now',
      ConditionExpression: 'attribute_exists(partnerId)',
      ExpressionAttributeNames: { '#name': 'name', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':name': params.name, ':now': params.now },
    }),
  );
};

/**
 * A partner's paid eSIM orders, newest first, by the partnerId stored on the
 * order - so sales stay credited after the partner changes their key.
 */
export const queryPublishedEsimOrdersByPartnerId = async (
  partnerId: string,
  cap: number,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const page = await sendDynamoCommand<{
      Items?: Record<string, unknown>[];
      LastEvaluatedKey?: Record<string, unknown>;
    }>(
      new QueryCommand({
        TableName: ORDERS_TABLE_NAME,
        IndexName: ORDER_PARTNER_ID_CREATED_AT_INDEX,
        KeyConditionExpression: '#partnerId = :partnerId',
        FilterExpression: '#status = :published AND #orderType = :esim',
        ExpressionAttributeNames: { '#partnerId': 'partnerId', '#status': 'status', '#orderType': 'orderType' },
        ExpressionAttributeValues: { ':partnerId': partnerId, ':published': 'ESIM_PUBLISHED', ':esim': 'esim' },
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    items.push(...(page.Items || []));
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey && items.length < cap);

  return items.slice(0, cap);
};
