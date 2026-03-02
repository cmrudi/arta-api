import { ProductMappingItem } from '../models/productMapping';
import { findProductMappings } from './productMappingService';
import { findRegions } from './regionService';

type FindDistributorPackageListResult = {
  count: number;
  items: ProductMappingItem[];
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
      const regionCode = typeof sanitized.regionCode === 'string' ? sanitized.regionCode : undefined;
      const matchedRegion = regionCode ? regionsByCode.get(regionCode) : undefined;

      void wholesale;
      void esimAccessTopupId;

      return {
        ...sanitized,
        regionName: matchedRegion?.regionName,
        networkProvider: matchedRegion?.networkProvider,
      };
    });

  return {
    count: items.length,
    items,
  };
};
