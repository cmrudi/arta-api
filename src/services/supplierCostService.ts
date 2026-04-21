import {
  putSupplierCost,
  scanAllProductMappingsPaginated,
  scanAllSupplierCostsPaginated,
  updateSupplierCostByProductCode,
} from '../lib/dynamoDb';

const MAYA_PROVIDER = 'maya';
const ESIMACCESS_PROVIDER = 'esimaccess';
const MAYA_COST_MULTIPLIER = 1.035;
const ESIMACCESS_PRICE_DIVISOR = 10000;
const MAYA_PRODUCTS_URL = 'https://api.maya.net/connectivity/v1/account/products';
const MAYA_AUTHORIZATION =
  'Basic eTBaS2dSQ1h5VjdpOjF1RXlobDRHZlBCb2JZVVhzNk1VRENkUHRRNHlsSFhjb2d3N2hFcnduWlpWYjhPNWFMazlDY2kyUmp4enRKRnYg';

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;

type MayaProduct = {
  uid: string;
  wholesale_price_usd: string;
};

type EsimAccessPackage = {
  packageCode: string;
  price: number;
};

type UpdateSupplierCostsResult = {
  scannedMappings: number;
  updated: number;
  inserted: number;
  skippedUnknownProvider: number;
  skippedMissingSupplierId: number;
  skippedSupplierNotFound: number;
  skippedInvalidCost: number;
};

const normalizeString = (value: unknown): string => String(value || '').trim();

const normalizeProvider = (value: unknown): string => normalizeString(value).toLowerCase();

const parseWholesalePrice = (raw: unknown): number | null => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }

  if (typeof raw === 'string') {
    const parsed = Number(raw);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const fetchMayaProducts = async (): Promise<Map<string, MayaProduct>> => {
  const response = await fetch(MAYA_PRODUCTS_URL, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: MAYA_AUTHORIZATION,
    },
  });

  if (!response.ok) {
    throw new Error(`maya products request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { products?: MayaProduct[] };
  const products = Array.isArray(payload.products) ? payload.products : [];

  const map = new Map<string, MayaProduct>();

  for (const product of products) {
    const uid = normalizeString(product.uid);

    if (uid) {
      map.set(uid, product);
    }
  }

  return map;
};

const fetchEsimAccessPackages = async (): Promise<Map<string, EsimAccessPackage>> => {
  const esimAccessBaseUrl = process.env.ESIM_ACCESS_BASE_URL || 'https://api.esimaccess.com';
  const esimAccessCode = process.env.ESIM_ACCESS_CODE || '';

  if (!esimAccessCode) {
    throw new Error('ESIM_ACCESS_CODE is not configured');
  }

  const response = await fetch(`${esimAccessBaseUrl}/api/v1/open/package/list`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'RT-AccessCode': esimAccessCode,
    },
    body: JSON.stringify({
      locationCode: '',
      type: '',
      slug: '',
      packageCode: '',
      iccid: '',
    }),
  });

  if (!response.ok) {
    throw new Error(`esimAccess package list failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    success?: boolean;
    obj?: { packageList?: EsimAccessPackage[] };
  };

  if (payload.success !== true) {
    throw new Error('esimAccess package list returned success=false');
  }

  const packageList = Array.isArray(payload.obj?.packageList) ? payload.obj!.packageList : [];
  const map = new Map<string, EsimAccessPackage>();

  for (const pkg of packageList) {
    const packageCode = normalizeString(pkg.packageCode);

    if (packageCode) {
      map.set(packageCode, pkg);
    }
  }

  return map;
};

const scanAllPaginated = async (
  scanner: (lastEvaluatedKey?: Record<string, unknown>) => Promise<{
    Items?: Record<string, unknown>[];
    LastEvaluatedKey?: Record<string, unknown>;
  }>,
): Promise<Record<string, unknown>[]> => {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await scanner(lastEvaluatedKey);
    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
};

const computeMayaCost = (supplierId: string, mayaMap: Map<string, MayaProduct>): number | null => {
  const product = mayaMap.get(supplierId);

  if (!product) {
    return null;
  }

  const wholesalePrice = parseWholesalePrice(product.wholesale_price_usd);

  if (wholesalePrice === null) {
    return null;
  }

  return roundToOneDecimal(wholesalePrice * MAYA_COST_MULTIPLIER);
};

const computeEsimAccessCost = (
  supplierId: string,
  esimMap: Map<string, EsimAccessPackage>,
): number | null => {
  const pkg = esimMap.get(supplierId);

  if (!pkg || typeof pkg.price !== 'number' || !Number.isFinite(pkg.price)) {
    return null;
  }

  return roundToOneDecimal(pkg.price / ESIMACCESS_PRICE_DIVISOR);
};

export const updateSupplierCostsFromProviders = async (): Promise<UpdateSupplierCostsResult> => {
  const [mayaMap, esimMap] = await Promise.all([
    fetchMayaProducts(),
    fetchEsimAccessPackages(),
  ]);

  const [mappings, supplierCosts] = await Promise.all([
    scanAllPaginated(scanAllProductMappingsPaginated),
    scanAllPaginated(scanAllSupplierCostsPaginated),
  ]);

  const supplierCostByCode = new Map<string, Record<string, unknown>>();

  for (const row of supplierCosts) {
    const productCode = normalizeString(row.productCode);

    if (productCode) {
      supplierCostByCode.set(productCode, row);
    }
  }

  const result: UpdateSupplierCostsResult = {
    scannedMappings: mappings.length,
    updated: 0,
    inserted: 0,
    skippedUnknownProvider: 0,
    skippedMissingSupplierId: 0,
    skippedSupplierNotFound: 0,
    skippedInvalidCost: 0,
  };

  for (const mapping of mappings) {
    const productCode = normalizeString(mapping.code);

    if (!productCode) {
      continue;
    }

    const existing = supplierCostByCode.get(productCode);
    const updatedAt = new Date().toISOString();

    if (existing) {
      const existingProvider = normalizeProvider(existing.provider);
      const existingSupplierId = normalizeString(existing.supplierId);

      if (!existingSupplierId) {
        result.skippedMissingSupplierId++;
        continue;
      }

      let cost: number | null = null;

      if (existingProvider === MAYA_PROVIDER) {
        cost = computeMayaCost(existingSupplierId, mayaMap);
      } else if (existingProvider === ESIMACCESS_PROVIDER) {
        cost = computeEsimAccessCost(existingSupplierId, esimMap);
      } else {
        result.skippedUnknownProvider++;
        continue;
      }

      if (cost === null) {
        result.skippedSupplierNotFound++;
        continue;
      }

      await updateSupplierCostByProductCode(productCode, cost, updatedAt);
      result.updated++;
      continue;
    }

    const mappingProvider = normalizeProvider(mapping.provider);
    let supplierId = '';
    let cost: number | null = null;

    if (mappingProvider === MAYA_PROVIDER) {
      supplierId = normalizeString(mapping.mayaProductId);

      if (!supplierId) {
        result.skippedMissingSupplierId++;
        continue;
      }

      cost = computeMayaCost(supplierId, mayaMap);
    } else if (mappingProvider === ESIMACCESS_PROVIDER) {
      supplierId = normalizeString(mapping.esimAccessProductId);

      if (!supplierId) {
        result.skippedMissingSupplierId++;
        continue;
      }

      cost = computeEsimAccessCost(supplierId, esimMap);
    } else {
      result.skippedUnknownProvider++;
      continue;
    }

    if (cost === null) {
      result.skippedSupplierNotFound++;
      continue;
    }

    await putSupplierCost({
      productCode,
      provider: mappingProvider,
      supplierId,
      cost,
      updatedAt,
    });
    result.inserted++;
  }

  return result;
};
