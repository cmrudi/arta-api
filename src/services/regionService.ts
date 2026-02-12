import { ScanCommand } from '@aws-sdk/lib-dynamodb';

import { dynamoDocClient } from '../lib/dynamo';
import { RegionItem } from '../models/region';

const REGION_TABLE_NAME = 'Region';

type FindRegionsResult = {
  tableName: string;
  count: number;
  items: RegionItem[];
};

export const findRegions = async (): Promise<FindRegionsResult> => {
  const command = new ScanCommand({
    TableName: REGION_TABLE_NAME,
  });

  const result = await dynamoDocClient.send(command);

  return {
    tableName: REGION_TABLE_NAME,
    count: result.Count || 0,
    items: (result.Items || []) as RegionItem[],
  };
};
