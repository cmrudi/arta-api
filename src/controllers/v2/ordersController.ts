import { Request, Response } from 'express';

import {
  forceRefundOrderById,
  findInProgressOrdersByDateRange,
  findPartnerOrdersByDateRange,
  recoverOrderById,
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

export const forceRefundOrder = async (req: Request, res: Response): Promise<Response> => {
  const orderId = req.body?.orderId;
  const amount = req.body?.amount;

  if (typeof orderId !== 'string' || !orderId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request body orderId is required',
    });
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: 'request body amount must be a number greater than 0',
    });
  }

  try {
    const result = await forceRefundOrderById(orderId, amount);

    if (!result.success) {
      if (result.reason === 'ORDER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'orderId not found in Order table',
        });
      }

      if (result.reason === 'AMOUNT_EXCEEDS_PRICE') {
        return res.status(400).json({
          success: false,
          message: 'amount should be less than or equal to order.price',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'order price is invalid',
      });
    }

    return res.status(200).json({
      success: true,
      tableName: 'Order',
      item: result.item,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to force refund order in DynamoDB',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};

export const recoverOrder = async (req: Request, res: Response): Promise<Response> => {
  const orderId = req.body?.orderId;

  if (typeof orderId !== 'string' || !orderId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request body orderId is required',
    });
  }

  try {
    const result = await recoverOrderById(orderId);

    if (!result.success) {
      if (result.reason === 'ORDER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'orderId not found in Order table',
        });
      }

      if (result.reason === 'STATUS_NOT_CREATED') {
        return res.status(400).json({
          success: false,
          message: 'order recovery only supports order with status CREATED',
        });
      }

      if (result.reason === 'PRODUCT_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'product mapping not found for this order',
        });
      }

      return res.status(502).json({
        success: false,
        message: 'failed to read transaction status from Midtrans',
        error: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      tableName: 'Order',
      action: result.action,
      invokedFunctionName: result.invokedFunctionName,
      midtrans: result.midtrans,
      item: result.order,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to recover order',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};