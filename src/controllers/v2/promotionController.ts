import { Request, Response } from 'express';

import { AuthenticatedLocals, getAuth0Email } from '../../middlewares/auth0BearerAuth';
import {
  AdminPromoResult,
  MAX_ORDER_QUANTITY,
  createAdminPromoCode,
  listAdminPromoCodes,
  setAdminPromoCodeActive,
  validatePromoByProductCode,
} from '../../services/promotionService';
import { ADMIN_MAX_DISCOUNT_AMOUNT, ADMIN_MAX_DISCOUNT_PERCENTAGE } from '../../models/promoCode';

export const validatePromotion = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const productCode = String(req.params.productCode || '').trim();
  const promoCode = String(req.params.promoCode || '').trim();

  if (!productCode || !promoCode) {
    return res.status(400).json({
      success: false,
      message: 'path params productCode and promoCode are required',
    });
  }

  // ?quantity=N prices the promo for N eSIMs of the product; absent means 1.
  const rawQuantity = req.query.quantity;
  const quantity = rawQuantity === undefined ? 1 : Number(rawQuantity);

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) {
    return res.status(400).json({
      success: false,
      message: `quantity must be a whole number from 1 to ${MAX_ORDER_QUANTITY}`,
    });
  }

  // requireAuth0EndUser has already verified the token and rejected an unverified
  // address, so this is the trusted identity of the caller.
  const email = getAuth0Email(res.locals.auth);

  if (!email) {
    return res.status(403).json({
      success: false,
      message: 'access token does not carry an email claim',
    });
  }

  try {
    const result = await validatePromoByProductCode(productCode, promoCode, email, quantity);

    if (!result.success) {
      if (result.reason === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'productCode not found in ProductMapping table',
        });
      }

      if (result.reason === 'PROMO_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'promoCode not found in PromoCode table',
        });
      }

      // Indistinguishable from an unknown code to the customer on purpose.
      if (result.reason === 'PROMO_INACTIVE') {
        return res.status(404).json({
          success: false,
          message: 'promoCode is not active',
        });
      }

      if (result.reason === 'PROMO_USAGE_EXCEEDED') {
        return res.status(409).json({
          success: false,
          message: 'promoCode has reached its maximum usage',
        });
      }

      if (result.reason === 'PRODUCT_PRICE_INVALID') {
        return res.status(400).json({
          success: false,
          message: 'product price is invalid',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'promo code data is invalid',
      });
    }

    return res.status(200).json({
      success: true,
      productCode,
      promoCode,
      redemptionId: result.redemptionId,
      quantity: result.quantity,
      price: result.price,
      priceCut: result.priceCut,
      finalPrice: result.finalPrice,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to validate promo code',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};

// ---------------------------------------------------------------------------
// Admin routes (arta-admin access token with the promo admin role)

const ADMIN_STATUS_BY_REASON: Record<string, number> = {
  ALREADY_EXISTS: 409,
  PROMO_NOT_FOUND: 404,
};

const actorOf = (res: Response<unknown, AuthenticatedLocals>): string => {
  const auth = res.locals.auth;

  return getAuth0Email(auth) || (typeof auth?.sub === 'string' ? auth.sub : 'unknown');
};

const sendAdminPromoResult = (res: Response, result: AdminPromoResult, okStatus = 200): Response =>
  result.success
    ? res.status(okStatus).json({ success: true, promo: result.promo })
    : res.status(ADMIN_STATUS_BY_REASON[result.reason] || 400).json(result);

const adminServerError = (res: Response, message: string, error: unknown): Response =>
  res.status(500).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : 'unknown error',
  });

export const getAdminPromoCodes = async (
  _req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const promos = await listAdminPromoCodes();

    return res.status(200).json({
      success: true,
      promos,
      limits: {
        maxDiscountPercentage: ADMIN_MAX_DISCOUNT_PERCENTAGE,
        maxDiscountAmount: ADMIN_MAX_DISCOUNT_AMOUNT,
      },
    });
  } catch (error) {
    return adminServerError(res, 'failed to list promo codes', error);
  }
};

export const postAdminPromoCode = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const body = (req.body || {}) as Record<string, unknown>;

  try {
    const result = await createAdminPromoCode(
      {
        code: body.code,
        discountPercentage: body.discountPercentage,
        maxDiscountAmount: body.maxDiscountAmount,
        maxUsage: body.maxUsage,
      },
      actorOf(res),
    );

    return sendAdminPromoResult(res, result, 201);
  } catch (error) {
    return adminServerError(res, 'failed to create promo code', error);
  }
};

const setActive =
  (isActive: boolean) =>
  async (req: Request, res: Response<unknown, AuthenticatedLocals>): Promise<Response> => {
    const code = String(req.params.code || '').trim();

    if (!code) {
      return res.status(400).json({ success: false, message: 'path param code is required' });
    }

    try {
      return sendAdminPromoResult(res, await setAdminPromoCodeActive(code, isActive, actorOf(res)));
    } catch (error) {
      return adminServerError(res, `failed to ${isActive ? 'enable' : 'disable'} promo code`, error);
    }
  };

export const postEnableAdminPromoCode = setActive(true);
export const postDisableAdminPromoCode = setActive(false);
