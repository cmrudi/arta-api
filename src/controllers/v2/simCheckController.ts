import { Request, Response } from 'express';

import { checkSim } from '../../services/simCheckService';

export const getSimCheck = async (req: Request, res: Response): Promise<Response> => {
  const iccid = req.params?.iccid;

  if (typeof iccid !== 'string' || !iccid.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request param iccid is required',
    });
  }

  try {
    const result = await checkSim(iccid.trim());

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      iccid: result.iccid,
      inventory: result.inventory,
      eligibleToAddPackage: result.eligibleToAddPackage,
      order: result.order,
      simCard: result.simCard,
      simInfo: result.simInfo,
      usage: result.usage,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to check sim',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};
