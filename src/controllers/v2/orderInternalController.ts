import { Request, Response } from 'express';

import { createInternalOrder as createInternalOrderService } from '../../services/orderInternalService';

export const createInternalOrder = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const email = req.body?.email;
  const productCode = req.body?.productCode;
  const iccid = req.body?.iccid;
  const customerName = req.body?.customerName;
  const customerPhone = req.body?.customerPhone;

  if (typeof productCode !== 'string' || !productCode.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request body productCode is required',
    });
  }

  if (typeof iccid !== 'string' || !iccid.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request body iccid is required',
    });
  }

  try {
    const result = await createInternalOrderService({
      email: typeof email === 'string' && email.trim() ? email.trim() : undefined,
      productCode: productCode.trim(),
      iccid: iccid.trim(),
      customerName: typeof customerName === 'string' ? customerName.trim() : undefined,
      customerPhone: typeof customerPhone === 'string' ? customerPhone.trim() : undefined,
    });

    if (!result.success) {
      if (result.reason === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: result.message,
        });
      }

      if (result.reason === 'PRODUCT_NOT_XPLORI' || result.reason === 'PRODUCT_NOT_PHYSICAL') {
        return res.status(400).json({
          success: false,
          message: result.message,
        });
      }

      return res.status(502).json({
        success: false,
        message: 'failed to provision sim with xplori',
        error: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      order: result.order,
      sim: result.sim,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to create internal order',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};
