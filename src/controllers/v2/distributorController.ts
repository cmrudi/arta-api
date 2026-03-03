import { Request, Response } from 'express';

import {
  AuthenticatedLocals,
  getAuth0ClientId,
} from '../../middlewares/auth0BearerAuth';
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
