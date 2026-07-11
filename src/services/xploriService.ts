const XPLORI_API_URL =
  process.env.XPLORI_API_URL || 'https://services.xplori.world/api/order/package/';
const XPLORI_TIMEOUT_MS = 15_000;

/**
 * Builds the Authorization header value, tolerating a key that is either raw or
 * already prefixed with "Api-Key " (the deployed env var includes the scheme).
 */
const getAuthorizationHeader = (): string => {
  const apiKey = process.env.XPLORI_API_KEY;

  if (!apiKey) {
    throw new Error('XPLORI_API_KEY is not configured');
  }

  const trimmed = apiKey.trim();

  return /^api-key\s/i.test(trimmed) ? trimmed : `Api-Key ${trimmed}`;
};

/** Origin of the Xplori API (e.g. https://stage.xplori.world), derived from XPLORI_API_URL. */
const getXploriOrigin = (): string => {
  try {
    return new URL(XPLORI_API_URL).origin;
  } catch {
    return 'https://services.xplori.world';
  }
};

/** GET a Xplori endpoint and return the parsed JSON body. Throws on non-2xx / invalid JSON. */
const xploriGet = async (url: string): Promise<Record<string, unknown>> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XPLORI_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: getAuthorizationHeader(),
      },
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let data: Record<string, unknown> | null;

    try {
      data = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      throw new Error(
        `Xplori API returned invalid JSON (status ${response.status}): ${rawBody.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      const message = data ? JSON.stringify(data) : rawBody;
      throw new Error(`Xplori API failed (status ${response.status}): ${message}`);
    }

    return data || {};
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Xplori API timeout');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

/** GET /api/sims/info/?sim_id=<iccid> */
export const getXploriSimInfo = async (iccid: string): Promise<Record<string, unknown>> =>
  xploriGet(`${getXploriOrigin()}/api/sims/info/?sim_id=${encodeURIComponent(iccid)}`);

/** GET /api/usage/<orderId> */
export const getXploriUsage = async (orderId: string): Promise<Record<string, unknown>> =>
  xploriGet(`${getXploriOrigin()}/api/usage/${encodeURIComponent(orderId)}`);

export type CreateXploriOrderPayload = {
  bookingId: string;
  sku: string;
  productId: string;
  simId: string;
};

export type XploriOrderResult = {
  simId: string;
  simSerial: string;
  startUsingDate?: string;
  raw: Record<string, unknown>;
};

/**
 * Extracts the fields we care about from a successful Xplori order response.
 * Sample success payload (physical SIM — no activation/QR data):
 *   { success: true, message: "Success", booking_id, sim_id, sim_serial,
 *     product_id: null, start_using_date }
 */
export const parseXploriOrderResponse = (
  data: Record<string, unknown>,
): XploriOrderResult => {
  const simId = String(data.sim_id ?? '');
  const simSerial = String(data.sim_serial ?? data.sim_id ?? '');
  const startUsingDate =
    typeof data.start_using_date === 'string' ? data.start_using_date : undefined;

  return {
    simId,
    simSerial,
    startUsingDate,
    raw: data,
  };
};

/**
 * Calls the Xplori order API to provision a physical SIM.
 * Throws on network failure, non-2xx, invalid JSON, or `success !== true`.
 */
export const createXploriOrder = async (
  payload: CreateXploriOrderPayload,
): Promise<XploriOrderResult> => {
  const authorization = getAuthorizationHeader();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), XPLORI_TIMEOUT_MS);

  try {
    const response = await fetch(XPLORI_API_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
      body: JSON.stringify({
        booking_id: payload.bookingId,
        sku: payload.sku,
        sim_id: payload.simId,
        product_id: payload.productId,
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    let data: Record<string, unknown> | null;

    try {
      data = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    } catch {
      throw new Error(
        `Xplori order API returned invalid JSON (status ${response.status}): ${rawBody.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      const message =
        data && (data.message || data.error) ? JSON.stringify(data) : rawBody;
      throw new Error(`Xplori order API failed (status ${response.status}): ${message}`);
    }

    if (!data || data.success !== true) {
      const message =
        data && (data.message || data.error)
          ? String(data.message || data.error)
          : 'Xplori order was not successful';
      throw new Error(message);
    }

    return parseXploriOrderResponse(data);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Xplori order API timeout');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};
