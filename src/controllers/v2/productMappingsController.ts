import { Request, Response } from 'express';

import { findProductMappings, listAdminProducts } from '../../services/productMappingService';
import { updateSupplierCostsFromProviders } from '../../services/supplierCostService';

export const getProductMappings = async (req: Request, res: Response): Promise<Response> => {
  try {
    const simTypeParam = req.query?.simType;
    const simType = typeof simTypeParam === 'string' ? simTypeParam : undefined;
    const result = await findProductMappings(simType);

    return res.status(200).json({
      success: true,
      tableName: result.tableName,
      count: result.count,
      items: result.items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to read product mappings from DynamoDB',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};

export const updateSupplierCosts = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const result = await updateSupplierCostsFromProviders();

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to update supplier costs',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};
/** Finance: every product with provider, supplier IDs and supplier cost. */
export const getAdminProducts = async (_req: Request, res: Response): Promise<Response> => {
  try {
    const items = await listAdminProducts();

    return res.status(200).json({ success: true, count: items.length, items });
  } catch (error) {
    console.error('Failed to list admin products', error);

    return res.status(500).json({
      success: false,
      message: 'failed to list products',
    });
  }
};
