const midtransBaseUrl = (): string =>
  process.env.MIDTRANS_STATUS_BASE_URL || 'https://api.midtrans.com/v2';

const midtransHeaders = (): Record<string, string> => ({
  accept: 'application/json',
  'content-type': 'application/json',
  authorization: process.env.MIDTRANS_AUTHORIZATION || '',
});

// Midtrans has no refund API for these: a VA or over-the-counter payment can
// only be returned by sending the customer money directly.
const NON_REFUNDABLE_PAYMENT_TYPES = ['bank_transfer', 'echannel', 'cstore'];

export type MidtransRefundResult =
  | { success: true; paymentType?: string; response: Record<string, unknown> }
  | {
      success: false;
      reason: 'PAYMENT_TYPE_NOT_REFUNDABLE' | 'MIDTRANS_REJECTED';
      paymentType?: string;
      message: string;
      response: Record<string, unknown>;
    };

const readJson = async (response: globalThis.Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export const getMidtransTransactionStatus = async (
  orderId: string,
): Promise<Record<string, unknown>> => {
  const response = await fetch(`${midtransBaseUrl()}/${encodeURIComponent(orderId)}/status`, {
    method: 'GET',
    headers: midtransHeaders(),
  });

  return readJson(response);
};

/**
 * Ask Midtrans to return `amount` to the method the order was paid with.
 *
 * `refundKey` is Midtrans's idempotency key: retrying with the same key never
 * refunds twice, so the refundId is passed and a retry after a timeout is safe.
 * Midtrans answers HTTP 200 even for refusals and puts the real outcome in the
 * body's `status_code`, so only that field decides success.
 */
export const requestMidtransRefund = async (params: {
  orderId: string;
  refundKey: string;
  amount: number;
  reason: string;
}): Promise<MidtransRefundResult> => {
  const status = await getMidtransTransactionStatus(params.orderId);
  const paymentType = typeof status.payment_type === 'string' ? status.payment_type : undefined;

  if (paymentType && NON_REFUNDABLE_PAYMENT_TYPES.includes(paymentType)) {
    return {
      success: false,
      reason: 'PAYMENT_TYPE_NOT_REFUNDABLE',
      paymentType,
      message: `payment type ${paymentType} cannot be refunded through Midtrans`,
      response: status,
    };
  }

  const response = await fetch(
    `${midtransBaseUrl()}/${encodeURIComponent(params.orderId)}/refund`,
    {
      method: 'POST',
      headers: midtransHeaders(),
      body: JSON.stringify({
        refund_key: params.refundKey,
        amount: params.amount,
        reason: params.reason,
      }),
    },
  );
  const body = await readJson(response);

  if (response.ok && String(body.status_code) === '200') {
    return { success: true, paymentType, response: body };
  }

  return {
    success: false,
    reason: 'MIDTRANS_REJECTED',
    paymentType,
    message: String(body.status_message || `midtrans refund failed with status ${response.status}`),
    response: body,
  };
};
