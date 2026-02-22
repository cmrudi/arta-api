import { scanAllRegions } from '../lib/dynamoDb';
import { RegionItem } from '../models/region';

const REGION_TABLE_NAME = 'Region';

type FindRegionsResult = {
  tableName: string;
  count: number;
  items: RegionItem[];
};

export const findRegions = async (): Promise<FindRegionsResult> => {
  const result = await scanAllRegions();

  return {
    tableName: REGION_TABLE_NAME,
    count: result.Count || 0,
    items: (result.Items || []) as RegionItem[],
  };
};
