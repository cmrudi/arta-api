import { randomUUID } from 'crypto';

import {
  countCompletedRedemptionsByPromoCode,
  createPromoCode,
  findProductByProductCode,
  getPromoCodeByCode,
  putPromoCodeRedemption,
  scanAllPromoCodes,
  setPromoCodeActive,
} from '../lib/dynamoDb';
import { ProductMappingItem } from '../models/productMapping';
import {
  ADMIN_MAX_DISCOUNT_AMOUNT,
  ADMIN_MAX_DISCOUNT_PERCENTAGE,
  PromoCodeItem,
  isPromoCodeActive,
} from '../models/promoCode';
import { PromoCodeRedemptionItem } from '../models/promoCodeRedemption';

type ValidatePromoSuccessResult = {
  success: true;
  product: ProductMappingItem;
  promo: PromoCodeItem;
  redemptionId: string;
  // The authenticated caller the promo was validated for. Comes from the Auth0
  // token via the controller — never from client-supplied input, so it is safe
  // to key per-user promo rules (maxUsage, allowlists) on it.
  email: string;
  quantity: number;
  price: number;
  priceCut: number;
  finalPrice: number;
};

type ValidatePromoErrorResult = {
  success: false;
  reason:
    | 'PRODUCT_NOT_FOUND'
    | 'PRODUCT_PRICE_INVALID'
    | 'PROMO_NOT_FOUND'
    | 'PROMO_INVALID'
    | 'PROMO_INACTIVE'
    | 'PROMO_USAGE_EXCEEDED';
};

export type ValidatePromoResult = ValidatePromoSuccessResult | ValidatePromoErrorResult;

// Rupiah. Nothing may be sold for less than this, however generous the promo:
// a zero-rupiah charge is not something the payment gateway can process.
const MINIMUM_FINAL_PRICE = 1000;

// Most eSIMs one order may buy; createOrder enforces the same limit.
export const MAX_ORDER_QUANTITY = 20;

const normalizeNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number(String(value));

/**
 * For fields that are legitimately absent, like maxUsage. Returns null rather
 * than a number so "no limit" stays distinguishable from a real limit —
 * normalizeNumber would turn undefined into NaN and, worse, '' into 0, which
 * would read as a promo nobody may ever use.
 */
const readOptionalNumber = (value: unknown): number | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string' && !value.trim()) {
    return null;
  }

  const parsed = Number(typeof value === 'string' ? value.trim() : value);

  return Number.isFinite(parsed) ? parsed : null;
};

const readFirstProductByCode = async (productCode: string): Promise<ProductMappingItem | null> => {
  const result = await findProductByProductCode(productCode);
  const first = (result.Items || [])[0] as ProductMappingItem | undefined;

  return first || null;
};

const readPromoByCode = async (promoCode: string): Promise<PromoCodeItem | null> => {
  const result = await getPromoCodeByCode(promoCode);
  const item = (result.Item || null) as PromoCodeItem | null;

  return item;
};

export const validatePromoByProductCode = async (
  productCode: string,
  promoCode: string,
  email: string,
  quantity = 1,
): Promise<ValidatePromoResult> => {
  const product = await readFirstProductByCode(productCode);

  if (!product) {
    return {
      success: false,
      reason: 'PRODUCT_NOT_FOUND',
    };
  }

  const price = normalizeNumber(product.price);

  if (!Number.isFinite(price) || price <= 0) {
    return {
      success: false,
      reason: 'PRODUCT_PRICE_INVALID',
    };
  }

  const promo = await readPromoByCode(promoCode);

  if (!promo) {
    return {
      success: false,
      reason: 'PROMO_NOT_FOUND',
    };
  }

  if (!isPromoCodeActive(promo)) {
    return {
      success: false,
      reason: 'PROMO_INACTIVE',
    };
  }

  const discountPercentage = normalizeNumber(promo.discountPercentage);
  const maxPriceCut = normalizeNumber(promo.maxPriceCut);

  if (
    !Number.isFinite(discountPercentage) ||
    !Number.isFinite(maxPriceCut) ||
    discountPercentage < 0 ||
    maxPriceCut < 0
  ) {
    return {
      success: false,
      reason: 'PROMO_INVALID',
    };
  }

  // A promo without maxUsage has no ceiling, so the count is skipped entirely
  // rather than treated as a limit of zero.
  const maxUsage = readOptionalNumber(promo.maxUsage);

  if (maxUsage !== null) {
    const completedCount = await countCompletedRedemptionsByPromoCode(promoCode);

    if (completedCount >= maxUsage) {
      return {
        success: false,
        reason: 'PROMO_USAGE_EXCEEDED',
      };
    }
  }

  // The promo applies to the whole order: the percentage is taken of every
  // eSIM together, and maxPriceCut caps the order's total discount.
  const orderPrice = price * quantity;
  let priceCut = (orderPrice * discountPercentage) / 100;

  if (priceCut > maxPriceCut) {
    priceCut = maxPriceCut;
  }

  const priceAmount = orderPrice * 1000;
  // Whole rupiah: the payment gateway only charges integer IDR amounts.
  let priceCutAmount = Math.floor(priceCut * 1000);

  // A 100%-discount code on a cheap package would otherwise price the order at
  // zero, which the payment gateway cannot charge. Trim the discount rather
  // than the total, so price - priceCut === finalPrice still holds; on a
  // package already under the floor there is simply nothing to give away.
  const maximumPriceCut = Math.max(priceAmount - MINIMUM_FINAL_PRICE, 0);

  if (priceCutAmount > maximumPriceCut) {
    priceCutAmount = maximumPriceCut;
  }

  const finalPriceAmount = priceAmount - priceCutAmount;

  const redemption: PromoCodeRedemptionItem = {
    redemptionId: randomUUID(),
    productCode,
    promoCode,
    email,
    price: priceAmount,
    priceCut: priceCutAmount,
    finalPrice: finalPriceAmount,
    quantity,
    status: 'INITIATED',
    createdAt: new Date().toISOString(),
  };

  // The redemption row is an audit trail, not part of the price answer. Denying
  // a customer a valid discount because a log write failed would be the worse
  // outcome, so a failure here is logged and swallowed.
  try {
    await putPromoCodeRedemption(redemption);
  } catch (error) {
    console.error('[promotion] failed to record promo redemption', {
      redemptionId: redemption.redemptionId,
      productCode,
      promoCode,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }

  return {
    success: true,
    product,
    promo,
    redemptionId: redemption.redemptionId,
    email,
    quantity,
    price: redemption.price,
    priceCut: redemption.priceCut,
    finalPrice: redemption.finalPrice,
  };
};

// ---------------------------------------------------------------------------
// Admin management (arta-admin)

/** What arta-admin sees of a promo code. Amounts are in rupiah. */
export type AdminPromoCode = {
  code: string;
  discountPercentage: number;
  maxDiscountAmount: number;
  maxUsage: number | null;
  usedCount: number;
  isActive: boolean;
  source: string | null;
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type AdminPromoErrorReason =
  | 'INVALID_CODE'
  | 'INVALID_DISCOUNT_PERCENTAGE'
  | 'INVALID_MAX_DISCOUNT_AMOUNT'
  | 'INVALID_MAX_USAGE'
  | 'ALREADY_EXISTS'
  | 'PROMO_NOT_FOUND';

export type AdminPromoResult =
  | { success: true; promo: AdminPromoCode }
  | { success: false; reason: AdminPromoErrorReason; message: string };

// Letters, digits, dash and underscore; what a customer can reasonably type.
const PROMO_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

const toAdminPromo = (item: Record<string, unknown>, usedCount: number): AdminPromoCode => {
  const maxPriceCut = normalizeNumber(item.maxPriceCut);

  return {
    code: String(item.code),
    discountPercentage: normalizeNumber(item.discountPercentage),
    // Stored in thousands of rupiah, like product prices.
    maxDiscountAmount: Number.isFinite(maxPriceCut) ? Math.round(maxPriceCut * 1000) : NaN,
    maxUsage: readOptionalNumber(item.maxUsage),
    usedCount,
    isActive: isPromoCodeActive(item),
    source: optionalString(item.source),
    createdAt: optionalString(item.createdAt),
    createdBy: optionalString(item.createdBy),
    updatedAt: optionalString(item.updatedAt),
    updatedBy: optionalString(item.updatedBy),
  };
};

const isConditionalCheckFailure = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConditionalCheckFailedException';

export const listAdminPromoCodes = async (): Promise<AdminPromoCode[]> => {
  const items = await scanAllPromoCodes();
  const promos = await Promise.all(
    items.map(async (item) =>
      toAdminPromo(item, await countCompletedRedemptionsByPromoCode(String(item.code))),
    ),
  );

  // Newest first; hand-made codes without createdAt sink to the bottom by code.
  return promos.sort(
    (a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '') || a.code.localeCompare(b.code),
  );
};

export type CreateAdminPromoInput = {
  code: unknown;
  discountPercentage: unknown;
  maxDiscountAmount: unknown;
  maxUsage?: unknown;
};

/**
 * Creates a promo from arta-admin. The 30% / Rp10.000 ceilings are enforced
 * here, not only in the admin form, so a hand-crafted request cannot exceed them.
 */
export const createAdminPromoCode = async (
  input: CreateAdminPromoInput,
  actor: string,
): Promise<AdminPromoResult> => {
  const code = typeof input.code === 'string' ? input.code.trim().toUpperCase() : '';

  if (!PROMO_CODE_PATTERN.test(code)) {
    return {
      success: false,
      reason: 'INVALID_CODE',
      message: 'code must be 3-32 characters of letters, digits, "-" or "_"',
    };
  }

  const discountPercentage = Number(input.discountPercentage);

  if (
    !Number.isFinite(discountPercentage) ||
    discountPercentage <= 0 ||
    discountPercentage > ADMIN_MAX_DISCOUNT_PERCENTAGE
  ) {
    return {
      success: false,
      reason: 'INVALID_DISCOUNT_PERCENTAGE',
      message: `discountPercentage must be more than 0 and at most ${ADMIN_MAX_DISCOUNT_PERCENTAGE}`,
    };
  }

  const maxDiscountAmount = Number(input.maxDiscountAmount);

  if (
    !Number.isInteger(maxDiscountAmount) ||
    maxDiscountAmount <= 0 ||
    maxDiscountAmount > ADMIN_MAX_DISCOUNT_AMOUNT
  ) {
    return {
      success: false,
      reason: 'INVALID_MAX_DISCOUNT_AMOUNT',
      message: `maxDiscountAmount must be a whole rupiah amount from 1 to ${ADMIN_MAX_DISCOUNT_AMOUNT}`,
    };
  }

  let maxUsage: number | undefined;

  if (input.maxUsage !== undefined && input.maxUsage !== null && input.maxUsage !== '') {
    maxUsage = Number(input.maxUsage);

    if (!Number.isInteger(maxUsage) || maxUsage < 1) {
      return {
        success: false,
        reason: 'INVALID_MAX_USAGE',
        message: 'maxUsage must be a whole number of at least 1, or left empty for no limit',
      };
    }
  }

  const now = new Date().toISOString();
  const promo: PromoCodeItem = {
    code,
    discountPercentage,
    maxPriceCut: maxDiscountAmount / 1000,
    ...(maxUsage !== undefined ? { maxUsage } : {}),
    isActive: true,
    source: 'ADMIN',
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
  };

  try {
    await createPromoCode(promo);
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      return {
        success: false,
        reason: 'ALREADY_EXISTS',
        message: `promo code ${code} already exists`,
      };
    }

    throw error;
  }

  return { success: true, promo: toAdminPromo(promo, 0) };
};

export const setAdminPromoCodeActive = async (
  code: string,
  isActive: boolean,
  actor: string,
): Promise<AdminPromoResult> => {
  try {
    const result = await setPromoCodeActive(code, isActive, actor);
    const item = result.Attributes || { code, isActive };

    return {
      success: true,
      promo: toAdminPromo(item, await countCompletedRedemptionsByPromoCode(code)),
    };
  } catch (error) {
    if (isConditionalCheckFailure(error)) {
      return {
        success: false,
        reason: 'PROMO_NOT_FOUND',
        message: `promo code ${code} not found`,
      };
    }

    throw error;
  }
};
