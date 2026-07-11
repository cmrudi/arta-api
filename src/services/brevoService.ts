const BREVO_SEND_EMAIL_URL = 'https://api.brevo.com/v3/smtp/email';
const INTERNAL_ORDER_CONFIRM_TEMPLATE_ID = 7;
const INTERNAL_ORDER_CONFIRM_RECIPIENT = 'infinityroamservice@gmail.com';

export type InternalOrderConfirmParams = {
  email?: string;
  region: string;
  plan: string;
  validity: string;
  orderType: string;
  price: number;
  iccid: string;
  partner?: string;
};

/**
 * Sends the internal ops order-confirmation email via Brevo (templateId 7).
 * Ported from the esimAccessEsimIssuance Lambda's sendBrevoInternalOrderConfirm.
 */
export const sendInternalOrderConfirm = async (
  params: InternalOrderConfirmParams,
): Promise<void> => {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured');
  }

  const payload = {
    to: [{ email: INTERNAL_ORDER_CONFIRM_RECIPIENT }],
    templateId: INTERNAL_ORDER_CONFIRM_TEMPLATE_ID,
    params: {
      email: params.email,
      region: params.region,
      plan: params.plan,
      validity: params.validity,
      type: params.orderType,
      price: params.price,
      partner: params.partner,
      iccid: params.iccid,
    },
  };

  const response = await fetch(BREVO_SEND_EMAIL_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API failed (status ${response.status}): ${body.slice(0, 200)}`);
  }
};
