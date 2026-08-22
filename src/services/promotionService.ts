import { randomUUID } from 'crypto';

import {
  countCompletedRedemptionsByPromoCode,
  findProductByProductCode,
  getPromoCodeByCode,
  putPromoCodeRedemption,
} from '../lib/dynamoDb';
import { ProductMappingItem } from '../models/productMapping';
import { PromoCodeItem } from '../models/promoCode';
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
    | 'PROMO_USAGE_EXCEEDED';
};

export type ValidatePromoResult = ValidatePromoSuccessResult | ValidatePromoErrorResult;

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

  let priceCut = (price * discountPercentage) / 100;

  if (priceCut > maxPriceCut) {
    priceCut = maxPriceCut;
  }

  const finalPrice = price - priceCut;

  const redemption: PromoCodeRedemptionItem = {
    redemptionId: randomUUID(),
    productCode,
    promoCode,
    email,
    price: price * 1000,
    priceCut: priceCut * 1000,
    finalPrice: finalPrice * 1000,
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
    price: redemption.price,
    priceCut: redemption.priceCut,
    finalPrice: redemption.finalPrice,
  };
};
