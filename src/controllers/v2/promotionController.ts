import { Request, Response } from 'express';

import { AuthenticatedLocals, getAuth0Email } from '../../middlewares/auth0BearerAuth';
import { MAX_ORDER_QUANTITY, validatePromoByProductCode } from '../../services/promotionService';

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
