import { sendBrevoTemplateEmail } from './brevoService';

/**
 * Partner emails for withdrawals, all from one Brevo template:
 *
 *   REQUESTED - the request was stored and is waiting for finance
 *   PAID      - finance transferred the money; carries the transfer reference
 *   REJECTED  - finance turned it down; carries the reason
 *
 * Same shape as the refund emails: the template switches its copy on the
 * isRequested / isPaid / isRejected flags and takes its subject from
 * `params.subject`. The HTML is templates/brevo/partner-payout-update.html.
 *
 * REQUESTED also goes to PARTNER_PAYOUT_OPS_EMAIL when set, so finance hears
 * about a new request without watching the admin page.
 *
 * While BREVO_PARTNER_PAYOUT_TEMPLATE_ID is unset the email is skipped with a
 * warning rather than failing the withdrawal.
 */
export type PartnerPayoutEmailKind = 'REQUESTED' | 'PAID' | 'REJECTED';

const TEMPLATE_ENV = 'BREVO_PARTNER_PAYOUT_TEMPLATE_ID';

const SUBJECTS: Record<PartnerPayoutEmailKind, (withdrawalId: string) => string> = {
  REQUESTED: (id) => `Pengajuan pencairan ${id} diterima`,
  PAID: (id) => `Pencairan ${id} sudah ditransfer`,
  REJECTED: (id) => `Pengajuan pencairan ${id} ditolak`,
};

const PARTNER_PORTAL_URL = process.env.PARTNER_PORTAL_URL || 'https://partner.artamobile.id';
const WA_CS_LINK = process.env.WA_CS_LINK || 'https://wa.me/6281110112731';

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

// Show only the last four digits of the account in an email.
const maskAccountNumber = (value: unknown): string => {
  const digits = str(value);

  return digits.length > 4 ? `•••• ${digits.slice(-4)}` : digits;
};

/**
 * Send one withdrawal email. Never throws: the withdrawal has already moved on
 * by the time this runs, so a mail outage must not turn a successful request or
 * payment into an error. Awaited rather than fired and forgotten because Lambda
 * freezes the process once the response is sent.
 */
export const sendPartnerPayoutEmail = async (
  kind: PartnerPayoutEmailKind,
  withdrawal: Record<string, unknown>,
): Promise<void> => {
  const withdrawalId = str(withdrawal.withdrawalId);
  const templateId = Number(process.env[TEMPLATE_ENV]);

  if (!Number.isInteger(templateId) || templateId <= 0) {
    console.warn('[partnerPayoutEmail] template not configured, skipping', {
      kind,
      withdrawalId,
      env: TEMPLATE_ENV,
    });
    return;
  }

  const bank = (withdrawal.bankAccount || {}) as Record<string, unknown>;
  const params = {
    kind,
    subject: SUBJECTS[kind](withdrawalId),
    isRequested: kind === 'REQUESTED',
    isPaid: kind === 'PAID',
    isRejected: kind === 'REJECTED',
    withdrawalId,
    partnerKey: str(withdrawal.partnerKey),
    partnerEmail: str(withdrawal.email),
    amount: formatRupiah(withdrawal.amount),
    bankName: str(bank.bankName),
    accountNumber: maskAccountNumber(bank.accountNumber),
    accountName: str(bank.accountName),
    requestedAt: formatDate(withdrawal.createdAt),
    paidAt: formatDate(withdrawal.paidAt),
    transferReference: str(withdrawal.transferReference),
    rejectReason: str(withdrawal.rejectReason),
    portalUrl: `${PARTNER_PORTAL_URL}/dashboard`,
    csUrl: WA_CS_LINK,
  };

  const recipients = [str(withdrawal.email)];
  const opsEmail = str(process.env.PARTNER_PAYOUT_OPS_EMAIL);

  if (kind === 'REQUESTED' && opsEmail) {
    recipients.push(opsEmail);
  }

  await Promise.all(
    recipients.filter(Boolean).map(async (to) => {
      try {
        await sendBrevoTemplateEmail({ to, templateId, params });
      } catch (error) {
        console.error('[partnerPayoutEmail] send failed', {
          kind,
          withdrawalId,
          to,
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }),
  );
};
