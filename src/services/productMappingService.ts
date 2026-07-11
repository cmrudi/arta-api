import {
  scanAllProductMappings,
  scanEnabledProductMappingsBySimType,
} from '../lib/dynamoDb';
import { ProductMappingItem } from '../models/productMapping';

const PRODUCT_MAPPING_TABLE_NAME = 'ProductMapping';

type FindProductMappingsResult = {
  tableName: string;
  count: number;
  items: ProductMappingItem[];
};

const sanitizeProductMappingItem = (item: ProductMappingItem): ProductMappingItem => {
  const { provider, mayaProductId, esimAccessProductId, ...sanitized } = item;

  void provider;
  void mayaProductId;
  void esimAccessProductId;

  return sanitized;
};

export const findProductMappings = async (
  simType?: string,
): Promise<FindProductMappingsResult> => {
  const hasSimTypeFilter = simType !== undefined && simType !== '';
  const result = hasSimTypeFilter
    ? await scanEnabledProductMappingsBySimType(simType)
    : await scanAllProductMappings();
  const items = ((result.Items || []) as ProductMappingItem[]).map(sanitizeProductMappingItem);

  return {
    tableName: PRODUCT_MAPPING_TABLE_NAME,
    count: result.Count || 0,
    items,
  };
};
