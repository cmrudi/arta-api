import { Request, Response } from 'express';

import { validatePromoByProductCode } from '../../services/promotionService';

export const validatePromotion = async (req: Request, res: Response): Promise<Response> => {
  const productCode = String(req.params.productCode || '').trim();
  const promoCode = String(req.params.promoCode || '').trim();

  if (!productCode || !promoCode) {
    return res.status(400).json({
      success: false,
      message: 'path params productCode and promoCode are required',
    });
  }

  try {
    const result = await validatePromoByProductCode(productCode, promoCode);

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
