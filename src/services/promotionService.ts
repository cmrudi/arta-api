import { findProductByProductCode, getPromoCodeByCode } from '../lib/dynamoDb';
import { ProductMappingItem } from '../models/productMapping';
import { PromoCodeItem } from '../models/promoCode';

type ValidatePromoSuccessResult = {
  success: true;
  product: ProductMappingItem;
  promo: PromoCodeItem;
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
    | 'PROMO_INVALID';
};

export type ValidatePromoResult = ValidatePromoSuccessResult | ValidatePromoErrorResult;

const normalizeNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number(String(value));

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

  let priceCut = (price * discountPercentage) / 100;

  if (priceCut > maxPriceCut) {
    priceCut = maxPriceCut;
  }

  const finalPrice = price - priceCut;

  return {
    success: true,
    product,
    promo,
    price: price * 1000,
    priceCut: priceCut * 1000,
    finalPrice: finalPrice * 1000,
  };
};
