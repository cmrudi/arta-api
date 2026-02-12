import { Request, Response } from 'express';

import { findRegions } from '../../services/regionService';

export const getRegions = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const result = await findRegions();

    return res.status(200).json({
      success: true,
      tableName: result.tableName,
      count: result.count,
      items: result.items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to read regions from DynamoDB',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};
