import { Request, Response } from 'express';

import {
  findInProgressOrdersByDateRange,
  findPartnerOrdersByDateRange,
} from '../../services/orderService';

const isValidDateString = (value: string): boolean => {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
};

export const getOrders = async (req: Request, res: Response): Promise<Response> => {
  const startDate = String(req.query.startDate || '');
  const endDate = String(req.query.endDate || '');

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: 'query params startDate and endDate are required',
    });
  }

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return res.status(400).json({
      success: false,
      message: 'startDate and endDate must be valid date strings',
    });
  }

  const start = new Date(startDate).toISOString();
  const end = new Date(endDate).toISOString();

  if (start > end) {
    return res.status(400).json({
      success: false,
      message: 'startDate must be less than or equal to endDate',
    });
  }

  try {
    const result = await findPartnerOrdersByDateRange(start, end);

    return res.status(200).json({
      success: true,
      tableName: result.tableName,
      count: result.count,
      items: result.items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to read orders from DynamoDB',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};

export const getInProgressOrders = async (req: Request, res: Response): Promise<Response> => {
  const startDate = String(req.query.startDate || '');
  const endDate = String(req.query.endDate || '');

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: 'query params startDate and endDate are required',
    });
  }

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return res.status(400).json({
      success: false,
      message: 'startDate and endDate must be valid date strings',
    });
  }

  const start = new Date(startDate).toISOString();
  const end = new Date(endDate).toISOString();

  if (start > end) {
    return res.status(400).json({
      success: false,
      message: 'startDate must be less than or equal to endDate',
    });
  }

  try {
    const result = await findInProgressOrdersByDateRange(start, end);

    return res.status(200).json({
      success: true,
      tableName: result.tableName,
      count: result.count,
      items: result.items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to read orders from DynamoDB',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};