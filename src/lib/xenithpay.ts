import { createHmac, timingSafeEqual } from 'crypto';

/**
 * XenithPay Open API client for payouts (https://docs.xenithpay.com).
 *
 * Config (Lambda environment):
 *   XENITHPAY_BASE_URL        https://openapi.sandbox.xenithpay.com (sandbox)
 *                             https://openapi.xenithpay.com (production)
 *   XENITHPAY_API_KEY         Access Key  -> header Xenith-Api-Key
 *   XENITHPAY_SECRET_KEY      Secret Key  -> signs every request
 *   XENITHPAY_WEBHOOK_SECRET  Webhook Signature Secret -> verifies callbacks
 *
 * Keys and the webhook secret are per environment; never commit them.
 */

export class XenithPayError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'XenithPayError';
  }

  /** The request may or may not have been carried out (timeout, 5xx, network). */
  get uncertain(): boolean {
    return this.status === 0 || this.status === 408 || this.status >= 500;
  }
}

const env = (name: string): string => (process.env[name] || '').trim();

export const xenithPayConfigured = (): boolean =>
  Boolean(env('XENITHPAY_BASE_URL') && env('XENITHPAY_API_KEY') && env('XENITHPAY_SECRET_KEY'));

const hmacBase64 = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('base64');

/**
 * Request signature: METHOD \n URI(path + query) \n TIMESTAMP \n BODY, joined
 * with real newline characters, HMAC-SHA256 with the Secret Key, Base64.
 */
export const signRequest = (params: {
  method: string;
  uri: string;
  timestamp: string;
  body: string;
  secretKey: string;
}): string =>
  hmacBase64(params.secretKey, [params.method.toUpperCase(), params.uri, params.timestamp, params.body].join('\n'));

/**
 * Webhook signature: METHOD \n PATH \n RAW_BODY \n TIMESTAMP where each "\n" is
 * the two literal characters backslash + n (not a newline byte), PATH has no
 * query string, RAW_BODY is exactly the bytes received. HMAC-SHA256 with the
 * Webhook Signature Secret, Base64.
 */
export const webhookSignature = (params: {
  method: string;
  path: string;
  rawBody: string;
  timestamp: string;
  secret: string;
}): string =>
  hmacBase64(
    params.secret,
    [params.method.toUpperCase(), params.path.split('?')[0], params.rawBody, params.timestamp].join('\\n'),
  );

export const verifyWebhookSignature = (params: {
  method: string;
  path: string;
  rawBody: string;
  timestamp: string;
  signature: string;
  secret?: string;
}): boolean => {
  const secret = params.secret ?? env('XENITHPAY_WEBHOOK_SECRET');

  if (!secret || !params.signature || !params.timestamp) {
    return false;
  }

  const expected = Buffer.from(webhookSignature({ ...params, secret }));
  const given = Buffer.from(params.signature.trim());

  return expected.length === given.length && timingSafeEqual(expected, given);
};

const request = async <T>(
  method: 'GET' | 'POST',
  uri: string,
  options: { body?: Record<string, unknown>; idempotencyKey?: string } = {},
): Promise<T> => {
  if (!xenithPayConfigured()) {
    throw new XenithPayError('XenithPay is not configured', 0, 'NOT_CONFIGURED', {});
  }

  const body = options.body ? JSON.stringify(options.body) : '';
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Xenith-Api-Key': env('XENITHPAY_API_KEY'),
    'Xenith-Request-Timestamp': timestamp,
    'Xenith-Request-Signature': signRequest({ method, uri, timestamp, body, secretKey: env('XENITHPAY_SECRET_KEY') }),
    ...(options.idempotencyKey ? { 'X-Idempotency-Key': options.idempotencyKey } : {}),
  };

  let response: Response;

  try {
    response = await fetch(`${env('XENITHPAY_BASE_URL').replace(/\/+$/, '')}${uri}`, {
      method,
      headers,
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    throw new XenithPayError(error instanceof Error ? error.message : 'network error', 0, 'NETWORK_ERROR', {});
  }

  const text = await response.text();
  let parsed: Record<string, unknown> = {};

  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }

  if (!response.ok) {
    const code =
      typeof parsed.code === 'string'
        ? parsed.code
        : typeof parsed.failedReason === 'string'
          ? parsed.failedReason
          : `HTTP_${response.status}`;

    throw new XenithPayError(
      typeof parsed.message === 'string' ? parsed.message : code,
      response.status,
      code,
      parsed,
    );
  }

  return parsed as T;
};

// ---------------------------------------------------------------------------
// Payouts

export type PayoutMethod = 'BANK_TRANSFER' | 'EWALLET';

export type XenithPayout = {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED' | string;
  referenceCode?: string;
  initiatedAmount?: number | string;
  sentAmount?: number | string;
  feeAmount?: number | string;
  errorCode?: string;
  errorMessage?: string;
  [key: string]: unknown;
};

export const createPayout = (params: {
  idempotencyKey: string;
  amount: number;
  method: PayoutMethod;
  channel: string;
  accountNumber: string;
  accountName: string;
  referenceCode: string;
  customerReference: string;
  description: string;
  callbackUrl: string;
}): Promise<XenithPayout> =>
  request<XenithPayout>('POST', '/v1/payouts', {
    idempotencyKey: params.idempotencyKey,
    body: {
      initiatedAmount: params.amount,
      currency: 'IDR',
      destinationPayoutMethod: params.method,
      destinationPayoutChannel: params.channel,
      destinationPayoutAccount: params.accountNumber,
      destinationPayoutAccountName: params.accountName,
      referenceCode: params.referenceCode,
      customerReference: params.customerReference,
      description: params.description,
      callbackUrl: params.callbackUrl,
    },
  });

export const getPayout = (payoutId: string): Promise<XenithPayout> =>
  request<XenithPayout>('GET', `/v1/payouts/${encodeURIComponent(payoutId)}`);

// ---------------------------------------------------------------------------
// Account inquiry (who owns this account?) and payout channels

export type AccountInquiryResult =
  | { valid: true; accountName: string; inquiryId: string }
  | { valid: false; reason: string; inquiryId?: string };

export const inquireAccount = async (params: {
  method: PayoutMethod;
  channel: string;
  accountNumber: string;
}): Promise<AccountInquiryResult> => {
  try {
    const result = await request<{ id?: string; status?: string; destinationPayoutAccountName?: string }>(
      'POST',
      '/v1/account-inquiry/sync',
      {
        body: {
          currency: 'IDR',
          destinationPayoutMethod: params.method,
          destinationPayoutChannel: params.channel,
          destinationPayoutAccount: params.accountNumber,
        },
      },
    );
    const name = (result.destinationPayoutAccountName || '').trim();

    return result.status === 'COMPLETED' && name
      ? { valid: true, accountName: name, inquiryId: result.id || '' }
      : { valid: false, reason: result.status || 'UNKNOWN', inquiryId: result.id };
  } catch (error) {
    // A definite "this account does not exist" is an answer, not an outage.
    if (error instanceof XenithPayError && !error.uncertain && error.code !== 'NOT_CONFIGURED') {
      return {
        valid: false,
        reason: error.code,
        inquiryId: typeof error.body.id === 'string' ? error.body.id : undefined,
      };
    }

    throw error;
  }
};

export type PayoutChannel = {
  method: PayoutMethod;
  channel: string;
  name: string;
};

export const listPayoutChannels = async (): Promise<PayoutChannel[]> => {
  const result = await request<{ data?: Array<Record<string, unknown>> }>(
    'GET',
    '/v1/payouts/channels?currency=IDR&status=ACTIVE',
  );

  return (result.data || [])
    .filter((item) => item.currency === 'IDR' && item.status !== 'INACTIVE')
    .map((item) => ({
      method: String(item.paymentMethod) as PayoutMethod,
      channel: String(item.paymentChannel),
      name: String(item.paymentChannelName || item.paymentChannel),
    }))
    .filter((item) => item.method === 'BANK_TRANSFER' || item.method === 'EWALLET');
};
