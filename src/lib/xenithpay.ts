import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * XenithPay payouts (https://docs.xenithpay.com).
 *
 * arta-api never calls XenithPay directly: XenithPay only accepts calls from
 * IPs in its IP Whitelist, and this Lambda has no fixed IP. Every API call goes
 * through the `xenithpayGateway` Lambda (XENITHPAY_GATEWAY_FUNCTION), which runs
 * in the VPC behind the NAT gateway's fixed IP and holds the XenithPay API key
 * and secret key.
 *
 * Only the webhook check happens here: XENITHPAY_WEBHOOK_SECRET verifies
 * XenithPay's callbacks to /v2/webhooks/xenithpay.
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
    return this.code !== 'NOT_CONFIGURED' && (this.status === 0 || this.status === 408 || this.status >= 500);
  }
}

const env = (name: string): string => (process.env[name] || '').trim();

/** Payouts are switched on unless XENITHPAY_DISABLED=true; the gateway reports missing keys. */
export const xenithPayConfigured = (): boolean => env('XENITHPAY_DISABLED') !== 'true';

const hmacBase64 = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload, 'utf8').digest('base64');

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

type GatewayAnswer =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string; body: Record<string, unknown> };

export type GatewayInvoker = (action: string, params: Record<string, unknown>) => Promise<GatewayAnswer>;

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ap-southeast-1' });

const invokeGateway: GatewayInvoker = async (action, params) => {
  const response = await lambdaClient.send(
    new InvokeCommand({
      FunctionName: env('XENITHPAY_GATEWAY_FUNCTION') || 'xenithpayGateway',
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ action, params })),
    }),
  );
  const raw = response.Payload ? Buffer.from(response.Payload).toString('utf-8') : '';

  if (response.FunctionError) {
    return { ok: false, status: 0, code: 'GATEWAY_ERROR', message: `xenithpayGateway failed: ${raw.slice(0, 300)}`, body: {} };
  }

  return (raw ? JSON.parse(raw) : { ok: false, status: 0, code: 'GATEWAY_ERROR', message: 'empty answer', body: {} }) as GatewayAnswer;
};

let gateway: GatewayInvoker = invokeGateway;

/** Tests swap the Lambda invoke for the gateway handler itself. */
export const setXenithPayGateway = (invoker: GatewayInvoker): void => {
  gateway = invoker;
};

const request = async <T>(action: string, params: Record<string, unknown> = {}): Promise<T> => {
  let answer: GatewayAnswer;

  try {
    answer = await gateway(action, params);
  } catch (error) {
    throw new XenithPayError(error instanceof Error ? error.message : 'gateway unreachable', 0, 'GATEWAY_ERROR', {});
  }

  if (!answer.ok) {
    throw new XenithPayError(answer.message || answer.code, answer.status, answer.code, answer.body || {});
  }

  return answer.data as T;
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
}): Promise<XenithPayout> => request<XenithPayout>('createPayout', { ...params });

export const getPayout = (payoutId: string): Promise<XenithPayout> => request<XenithPayout>('getPayout', { payoutId });

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
      'inquireAccount',
      { ...params },
    );
    const name = (result.destinationPayoutAccountName || '').trim();

    return result.status === 'COMPLETED' && name
      ? { valid: true, accountName: name, inquiryId: result.id || '' }
      : { valid: false, reason: result.status || 'UNKNOWN', inquiryId: result.id };
  } catch (error) {
    // A definite "this account does not exist" is an answer, not an outage.
    if (error instanceof XenithPayError && !error.uncertain && error.code !== 'NOT_CONFIGURED' && error.code !== 'GATEWAY_ERROR') {
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
  const result = await request<{ data?: Array<Record<string, unknown>> }>('listChannels');

  return (result.data || [])
    .filter((item) => item.currency === 'IDR' && item.status !== 'INACTIVE')
    .map((item) => ({
      method: String(item.paymentMethod) as PayoutMethod,
      channel: String(item.paymentChannel),
      name: String(item.paymentChannelName || item.paymentChannel),
    }))
    .filter((item) => item.method === 'BANK_TRANSFER' || item.method === 'EWALLET');
};

// ---------------------------------------------------------------------------
// Optional allowlist for incoming webhooks

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split('.');

  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return null;
  }

  return parts.reduce((acc, part) => acc * 256 + Number(part), 0);
};

const inRange = (ip: string, entry: string): boolean => {
  const [base, bitsText] = entry.split('/');

  if (bitsText === undefined) {
    return ip === base;
  }

  const ipNum = ipv4ToInt(ip);
  const baseNum = ipv4ToInt(base);
  const bits = Number(bitsText);

  if (ipNum === null || baseNum === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }

  const size = 2 ** (32 - bits);

  return Math.floor(ipNum / size) === Math.floor(baseNum / size);
};

/**
 * XENITHPAY_WEBHOOK_ALLOWED_IPS: comma-separated IPv4 addresses or CIDRs that
 * may call the webhook (ask XenithPay support for theirs; none are published).
 * Empty = no IP check; the signature still has to be valid.
 */
export const webhookSourceAllowed = (sourceIp: string): boolean => {
  const list = env('XENITHPAY_WEBHOOK_ALLOWED_IPS')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return list.length === 0 || (Boolean(sourceIp) && list.some((entry) => inRange(sourceIp.trim(), entry)));
};

// ---------------------------------------------------------------------------
// Merchant balance (the money payouts are paid from)

export type XenithBalance = {
  currency: string;
  available: number;
  pending: number;
  held: number;
  frozen: number;
  total: number;
};

const amount = (value: unknown): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

/** GET /v1/balances - one row per currency; XenithPay sends amounts as strings. */
export const getMerchantBalances = async (): Promise<XenithBalance[]> => {
  const result = await request<{ data?: Array<Record<string, unknown>> }>('getBalance');

  return (result.data || []).map((item) => ({
    currency: String(item.currency || ''),
    available: amount(item.availableBalance),
    pending: amount(item.pendingBalance),
    held: amount(item.heldBalance),
    frozen: amount(item.frozenBalance),
    total: amount(item.totalBalance),
  }));
};
