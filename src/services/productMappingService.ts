import { ScanCommand } from '@aws-sdk/lib-dynamodb';

import { dynamoDocClient } from '../lib/dynamo';
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

export const findProductMappings = async (): Promise<FindProductMappingsResult> => {
  const command = new ScanCommand({
    TableName: PRODUCT_MAPPING_TABLE_NAME,
  });

  const result = await dynamoDocClient.send(command);
  const items = ((result.Items || []) as ProductMappingItem[]).map(sanitizeProductMappingItem);

  return {
    tableName: PRODUCT_MAPPING_TABLE_NAME,
    count: result.Count || 0,
    items,
  };
};
