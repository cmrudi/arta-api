import { Request, Response } from 'express';

import { findDistributorPackageList } from '../../services/distributorService';

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
