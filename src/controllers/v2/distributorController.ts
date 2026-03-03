import { Request, Response } from 'express';

import {
  AuthenticatedLocals,
  getAuth0ClientId,
} from '../../middlewares/auth0BearerAuth';
import {
  createDistributorOrder,
} from '../../services/distributorOrderService';
import { findDistributorPackageList } from '../../services/distributorService';
import { findDistributorWalletBalance } from '../../services/distributorWalletService';

export const getDistributorPackageList = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const result = await findDistributorPackageList();

    return res.status(200).json({
      success: true,
      count: result.count,
      items: result.items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to read distributor package list from DynamoDB',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};

export const getDistributorWalletBalance = async (
  _req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  try {
    const clientId = getAuth0ClientId(res.locals.auth);

    if (!clientId) {
      return res.status(401).json({
        success: false,
        message: 'clientId not found in access token',
      });
    }

    const result = await findDistributorWalletBalance(clientId);

    return res.status(200).json({
      success: true,
      balance: result.balance,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to read distributor wallet balance',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};

export const createDistOrder = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const transactionId = req.body?.transactionId;
  const productCode = req.body?.productCode || req.body?.productId;

  if (typeof transactionId !== 'string' || !transactionId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request body transactionId is required',
    });
  }

  if (typeof productCode !== 'string' || !productCode.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request body productId or productCode is required',
    });
  }

  const clientId = getAuth0ClientId(res.locals.auth);

  if (!clientId) {
    return res.status(401).json({
      success: false,
      message: 'clientId not found in access token',
    });
  }

  try {
    const result = await createDistributorOrder({
      transactionId: transactionId.trim(),
      productCode: productCode.trim(),
      clientId,
    });

    if (!result.success) {
      if (result.reason === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'product mapping not found',
        });
      }

      if (result.reason === 'PRODUCT_PRICE_INVALID') {
        return res.status(400).json({
          success: false,
          message: 'product wholesalePrice is invalid',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'insufficient distributor wallet balance',
        currentBalance: result.currentBalance,
        requiredBalance: result.requiredBalance,
      });
    }

    return res.status(200).json({
      success: true,
      item: result.order,
      invokedFunctionName: result.invokedFunctionName,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to create distributor order',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};
