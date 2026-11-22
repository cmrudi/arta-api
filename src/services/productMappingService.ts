import {
  scanAllProductMappingsPaginated,
  scanAllSupplierCostsPaginated,
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

const scanAll = async (
  scanner: (lastEvaluatedKey?: Record<string, unknown>) => Promise<{
    Items?: Record<string, unknown>[];
    LastEvaluatedKey?: Record<string, unknown>;
  }>,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const page = await scanner(lastEvaluatedKey);
    items.push(...(page.Items || []));
    lastEvaluatedKey = page.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
};

export type AdminProductSupplierCost = {
  /** USD per package, as stored by the supplier cost refresh. */
  cost: number;
  supplierId?: string;
  provider?: string;
  updatedAt?: string;
};

export type AdminProductItem = ProductMappingItem & {
  supplierCost: AdminProductSupplierCost | null;
};

/**
 * Every product with nothing stripped (provider and supplier IDs included) and
 * its SupplierCost row attached, for the finance Products dashboard. Unlike
 * findProductMappings this is only served behind the finance role.
 */
export const listAdminProducts = async (): Promise<AdminProductItem[]> => {
  const [mappings, costs] = await Promise.all([
    scanAll(scanAllProductMappingsPaginated),
    scanAll(scanAllSupplierCostsPaginated),
  ]);

  const costByCode = new Map<string, Record<string, unknown>>();
  for (const row of costs) {
    costByCode.set(String(row.productCode || ''), row);
  }

  return mappings
    .map((item): AdminProductItem => {
      const row = costByCode.get(String(item.code || ''));
      const cost = row ? Number(row.cost) : NaN;

      return {
        ...item,
        supplierCost: row && Number.isFinite(cost)
          ? {
            cost,
            supplierId: row.supplierId ? String(row.supplierId) : undefined,
            provider: row.provider ? String(row.provider) : undefined,
            updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
          }
          : null,
      };
    })
    .sort((a, b) =>
      String(a.regionCode || '').localeCompare(String(b.regionCode || ''))
      || Number(a.gb || 0) - Number(b.gb || 0)
      || String(a.code || '').localeCompare(String(b.code || '')));
};
