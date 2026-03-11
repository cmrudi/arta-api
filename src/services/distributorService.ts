import { ProductMappingItem } from '../models/productMapping';
import { findProductMappings } from './productMappingService';
import { findRegions } from './regionService';

type FindDistributorPackageListResult = {
  count: number;
  items: ProductMappingItem[];
};

const parseNetworkProviderNames = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const names = value
    .map((provider) => {
      if (typeof provider === 'string') {
        return provider.trim();
      }

      if (provider && typeof provider === 'object' && 'name' in provider) {
        const providerName = (provider as { name?: unknown }).name;

        if (typeof providerName === 'string') {
          return providerName.trim();
        }
      }

      return '';
    })
    .filter((name) => name.length > 0);

  return names.length > 0 ? names : undefined;
};

export const findDistributorPackageList = async (): Promise<FindDistributorPackageListResult> => {
  const [productMappingResult, regionResult] = await Promise.all([
    findProductMappings(),
    findRegions(),
  ]);

  const regionsByCode = new Map<string, { regionName?: unknown; networkProvider?: unknown }>();

  regionResult.items.forEach((region) => {
    const regionCode =
      typeof region.regionCode === 'string'
        ? region.regionCode
        : typeof region.code === 'string'
          ? region.code
          : undefined;

    if (!regionCode) {
      return;
    }

    const regionName = region.regionName ?? region.name;
    const networkProvider = region.networkProvider;

    regionsByCode.set(regionCode, {
      regionName,
      networkProvider,
    });
  });

  const items = productMappingResult.items
    .filter((item) => item.wholesale === true)
    .map((item) => {
      const { wholesale, esimAccessTopupId, ...sanitized } = item;
      const { code, productCode: existingProductCode, ...normalized } = sanitized;
      const productCode =
        typeof code === 'string' && code.trim()
          ? code.trim()
          : typeof existingProductCode === 'string' && existingProductCode.trim()
            ? existingProductCode.trim()
            : undefined;
      const regionCode = typeof sanitized.regionCode === 'string' ? sanitized.regionCode : undefined;
      const matchedRegion = regionCode ? regionsByCode.get(regionCode) : undefined;

      void wholesale;
      void esimAccessTopupId;

      return {
        ...(productCode ? { productCode } : {}),
        ...normalized,
        regionName: matchedRegion?.regionName,
        networkProvider: parseNetworkProviderNames(matchedRegion?.networkProvider),
      };
    });

  return {
    count: items.length,
    items,
  };
};
