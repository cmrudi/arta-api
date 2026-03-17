import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { ProductMappingItem } from '../models/productMapping';
import { findProductMappings } from './productMappingService';
import { findRegions } from './regionService';

type FindDistributorPackageListResult = {
  count: number;
  items: ProductMappingItem[];
};

type FindDistributorEsimBySimIdResult = {
  statusCode: number;
  payload: Record<string, unknown>;
};

const lambdaClient = new LambdaClient({});
const GET_ESIM_BY_SIM_ID_FUNCTION_NAME = 'getEsimBySimId';

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

const parseLambdaPayload = (payload?: Uint8Array): unknown => {
  if (!payload || payload.length === 0) {
    return {};
  }

  const text = Buffer.from(payload).toString('utf-8').trim();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      message: text,
    };
  }
};

const normalizeObjectPayload = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {
    data: value,
  };
};

const normalizeLambdaResponse = (payload: unknown): FindDistributorEsimBySimIdResult => {
  const parsed = normalizeObjectPayload(payload);
  const statusCode =
    typeof parsed.statusCode === 'number' && Number.isFinite(parsed.statusCode)
      ? parsed.statusCode
      : 200;

  const body = parsed.body;

  if (typeof body === 'string') {
    try {
      const parsedBody = JSON.parse(body) as unknown;

      return {
        statusCode,
        payload: normalizeObjectPayload(parsedBody),
      };
    } catch {
      return {
        statusCode,
        payload: {
          body,
        },
      };
    }
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return {
      statusCode,
      payload: body as Record<string, unknown>,
    };
  }

  if ('statusCode' in parsed || 'body' in parsed) {
    const { statusCode: _statusCode, body: _body, ...rest } = parsed;

    void _statusCode;
    void _body;

    if (Object.keys(rest).length > 0) {
      return {
        statusCode,
        payload: rest,
      };
    }
  }

  return {
    statusCode,
    payload: parsed,
  };
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

export const findDistributorEsimBySimId = async (
  simId: string,
): Promise<FindDistributorEsimBySimIdResult> => {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: GET_ESIM_BY_SIM_ID_FUNCTION_NAME,
      Payload: Buffer.from(JSON.stringify({ simId })),
    }),
  );

  if (response.FunctionError) {
    const errorPayload = normalizeObjectPayload(parseLambdaPayload(response.Payload));
    const errorMessage =
      typeof errorPayload.errorMessage === 'string'
        ? errorPayload.errorMessage
        : 'getEsimBySimId lambda returned an error';

    throw new Error(errorMessage);
  }

  const payload = parseLambdaPayload(response.Payload);

  return normalizeLambdaResponse(payload);
};
