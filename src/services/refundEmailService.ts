import { getRegionByCode } from '../lib/dynamoDb';
import { REVIEW_SLA_HOURS } from '../models/refund';
import { sendBrevoTemplateEmail } from './brevoService';

/**
 * Customer emails for the refund flow, all from one Brevo template:
 *
 *   RECEIVED  - the request was stored and is waiting for CS
 *   REJECTED  - CS turned it down; carries the reason
 *   COMPLETED - the money was returned (through Midtrans or by hand)
 *
 * The template switches its copy on the isReceived / isRejected / isCompleted
 * flags (plain booleans, so it needs no string comparison in Brevo's template
 * language) and takes its subject from `params.subject`. The HTML to paste in
 * is templates/brevo/refund-update.html. The template ID comes from the
 * environment; while it is unset the email is skipped with a warning rather
 * than failing the refund.
 */
export type RefundEmailKind = 'RECEIVED' | 'REJECTED' | 'COMPLETED';

const TEMPLATE_ENV = 'BREVO_REFUND_TEMPLATE_ID';

const SUBJECTS: Record<RefundEmailKind, (refundId: string) => string> = {
  RECEIVED: (refundId) => `Pengajuan refund ${refundId} diterima`,
  REJECTED: (refundId) => `Pengajuan refund ${refundId} ditolak`,
  COMPLETED: (refundId) => `Refund ${refundId} selesai`,
};

const SHOP_BASE_URL = process.env.SHOP_BASE_URL || 'https://shop.artamobile.id';
const WA_CS_LINK = process.env.WA_CS_LINK || 'https://wa.me/6282357509078';

const PAYMENT_LABELS: Record<string, string> = {
  qris: 'QRIS',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  credit_card: 'Kartu kredit',
  bank_transfer: 'Transfer bank',
  echannel: 'Mandiri Bill',
  cstore: 'Gerai retail',
};

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const formatRupiah = (amount: unknown): string =>
  `Rp ${(Number(amount) || 0).toLocaleString('id-ID')}`;

const formatDate = (iso: unknown): string => {
  const date = new Date(str(iso));

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      });
};

const regionName = async (regionCode: string): Promise<string> => {
  if (!regionCode) {
    return '';
  }

  try {
    return str((await getRegionByCode(regionCode)).Item?.name);
  } catch {
    return '';
  }
};

/**
 * Send one refund email. Never throws: the refund has already moved on by the
 * time this runs, and a mail outage must not turn a successful approve or
 * submit into an error for CS or the customer. It is awaited (not fired and
 * forgotten) because Lambda freezes the process once the response is sent.
 */
export const sendRefundEmail = async (
  kind: RefundEmailKind,
  refund: Record<string, unknown>,
): Promise<void> => {
  const refundId = str(refund.refundId);
  const templateId = Number(process.env[TEMPLATE_ENV]);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    console.warn('[refundEmail] template not configured, skipping', { kind, refundId, env: TEMPLATE_ENV });
    return;
  }

  const to = str(refund.email);

  if (!to) {
    console.warn('[refundEmail] refund has no email, skipping', { kind, refundId });
    return;
  }

  const simId = str(refund.SimId);
  const paymentType = str(refund.paymentType);

  try {
    await sendBrevoTemplateEmail({
      to,
      templateId,
      params: {
        kind,
        subject: SUBJECTS[kind](refundId),
        isReceived: kind === 'RECEIVED',
        isRejected: kind === 'REJECTED',
        isCompleted: kind === 'COMPLETED',
        refundId,
        region: (await regionName(str(refund.regionCode))) || 'eSIM',
        iccid: str(refund.iccid),
        amount: formatRupiah(refund.amount),
        paymentMethod: PAYMENT_LABELS[paymentType] || 'metode pembayaran asal',
        requestedAt: formatDate(refund.createdAt),
        reviewSla: `${REVIEW_SLA_HOURS / 24}×24 jam`,
        rejectReason: str(refund.rejectReason),
        refundedAt: formatDate(refund.refundedAt),
        manualRefund: refund.manualRefund === true,
        statusUrl: `${SHOP_BASE_URL}/sim/${encodeURIComponent(simId)}/refund/status`,
        csUrl: WA_CS_LINK,
      },
    });
  } catch (error) {
    console.error('[refundEmail] send failed', {
      kind,
      refundId,
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};
