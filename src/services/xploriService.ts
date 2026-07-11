const XPLORI_API_URL =
  process.env.XPLORI_API_URL || 'https://services.xplori.world/api/order/package/';
const XPLORI_TIMEOUT_MS = 15_000;

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
  const apiKey = process.env.XPLORI_API_KEY;

  if (!apiKey) {
    throw new Error('XPLORI_API_KEY is not configured');
  }

  // Accept the key either raw or already prefixed ("Api-Key <key>") so the
  // Authorization header isn't doubled up when the env var includes the scheme.
  const authorization = /^api-key\s/i.test(apiKey.trim())
    ? apiKey.trim()
    : `Api-Key ${apiKey.trim()}`;

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
