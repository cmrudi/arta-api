/**
 * Partner (affiliate) payouts: a balance the finance team credits by hand, and
 * withdrawals the partner requests from the partner portal and finance pays out
 * by bank transfer.
 *
 * Three tables:
 *
 *   PartnerWallet      PK partnerId. One row per partner (see models/partner.ts);
 *                      the partner portal finds it through the login email.
 *   PartnerLedger      PK entryId, GSI partnerId-createdAt-index. Every change
 *                      to a wallet's available balance, newest first per partner.
 *   PartnerWithdrawal  PK withdrawalId, GSIs status-createdAt-index (finance
 *                      queue) and partnerId-createdAt-index (partner history).
 *
 * Each row also keeps the partner's email at the time it was written, for
 * notifications and for finance to read; the partnerId is what links them.
 *
 * Money only ever moves through a TransactWrite that updates the wallet, writes
 * the ledger entry and (for withdrawals) the withdrawal row together, so the
 * three can never disagree.
 */

export type PayoutMethod = 'BANK_TRANSFER' | 'EWALLET';

export type PartnerBankAccount = {
  /** Display name of the bank / e-wallet, e.g. "BANK BCA". */
  bankName: string;
  accountNumber: string;
  /** Holder name as the bank returned it (XenithPay account inquiry). */
  accountName: string;
  /** XenithPay payout method and channel code, e.g. BANK_TRANSFER / CENAIDJA. */
  method?: PayoutMethod;
  channel?: string;
};

export type PartnerWallet = {
  partnerId: string;
  /** The partner's login email when the wallet last changed. */
  email: string;
  /** The affiliate key (go.artamobile.id/<key>), for finance's reference only. */
  partnerKey?: string;
  partnerName?: string;
  /** What the partner can withdraw now. */
  balance: number;
  /** Reserved by the open withdrawal, no longer in `balance`. */
  onHold: number;
  totalCredited: number;
  totalPaidOut: number;
  /** Set while a withdrawal is open; a partner has at most one at a time. */
  openWithdrawalId?: string;
  /** Last account the partner withdrew to, to prefill the next request. */
  bankAccount?: PartnerBankAccount;
  createdAt: string;
  updatedAt: string;
};

/**
 * CREDIT / DEBIT     finance adds earnings, or corrects a mistake.
 * WITHDRAWAL         the partner asked for a payout; the amount leaves `balance`.
 * WITHDRAWAL_RETURNED the payout was rejected or cancelled; the amount comes back.
 * A paid withdrawal writes no entry: the money already left `balance` when it
 * was requested.
 */
export const PARTNER_LEDGER_TYPES = ['CREDIT', 'DEBIT', 'WITHDRAWAL', 'WITHDRAWAL_RETURNED'] as const;
export type PartnerLedgerType = (typeof PARTNER_LEDGER_TYPES)[number];

export type PartnerLedgerEntry = {
  entryId: string;
  partnerId: string;
  email: string;
  type: PartnerLedgerType;
  /** Signed: positive adds to the available balance, negative takes from it. */
  amount: number;
  note?: string;
  withdrawalId?: string;
  by: string;
  createdAt: string;
};

/**
 * PENDING_REVIEW -> APPROVED -> PROCESSING -> PAID is the happy path: finance
 * approves, the payout is sent through XenithPay (PROCESSING), and XenithPay's
 * webhook confirms it (PAID). If XenithPay reports it failed or cancelled the
 * withdrawal becomes FAILED and the money returns to the balance.
 *
 * APPROVED without PROCESSING means the payout could not be sent yet (e.g.
 * XenithPay unreachable or not configured); finance can retry or reject.
 * Finance may still mark a PENDING_REVIEW / APPROVED request PAID by hand
 * (bank transfer outside XenithPay). PENDING_REVIEW or APPROVED -> REJECTED
 * returns the money, and so does the partner cancelling while it is still
 * PENDING_REVIEW.
 */
export const WITHDRAWAL_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'PROCESSING',
  'PAID',
  'REJECTED',
  'CANCELLED',
  'FAILED',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const isWithdrawalStatus = (value: unknown): value is WithdrawalStatus =>
  typeof value === 'string' && (WITHDRAWAL_STATUSES as readonly string[]).includes(value);

/** Still holding the partner's money (the wallet's openWithdrawalId points here). */
export const OPEN_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ['PENDING_REVIEW', 'APPROVED', 'PROCESSING'];

/** Finance may still decide these by hand (reject / mark paid); PROCESSING is up to XenithPay. */
export const REVIEWABLE_WITHDRAWAL_STATUSES: readonly WithdrawalStatus[] = ['PENDING_REVIEW', 'APPROVED'];

export type WithdrawalEvent = {
  at: string;
  status: WithdrawalStatus;
  by?: string;
  note?: string;
};

export type PartnerWithdrawal = {
  withdrawalId: string;
  partnerId: string;
  email: string;
  partnerKey?: string;
  partnerName?: string;
  /** What leaves the partner's balance. */
  amount: number;
  /** Withdrawal fee kept by Arta (PARTNER_WITHDRAWAL_FEE). */
  fee?: number;
  /** What is sent to the partner's account: amount - fee. */
  payoutAmount?: number;
  bankAccount: PartnerBankAccount;
  note?: string;
  status: WithdrawalStatus;
  /** XenithPay payout, once sent. */
  payoutProvider?: 'XENITHPAY';
  payoutId?: string;
  payoutStatus?: string;
  payoutSentAt?: string;
  /** Last problem sending or completing the payout, for finance. */
  payoutError?: string;
  failedReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectReason?: string;
  /** Bank transfer reference finance enters when marking it paid. */
  transferReference?: string;
  paidBy?: string;
  paidAt?: string;
  events: WithdrawalEvent[];
  createdAt: string;
  updatedAt: string;
};

const envAmount = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);

  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/** Smallest payout a partner may request, in IDR. */
export const minWithdrawalAmount = (): number => envAmount('PARTNER_MIN_WITHDRAWAL', 500_000);

/** Fee taken from each withdrawal, in IDR; the partner receives amount - fee. */
export const withdrawalFee = (): number => {
  const value = Number(process.env.PARTNER_WITHDRAWAL_FEE);

  return Number.isInteger(value) && value >= 0 ? value : 6_500;
};

/** Largest single credit or debit finance may post, in IDR - a typo guard. */
export const MAX_ADJUSTMENT_AMOUNT = 100_000_000;

export const MAX_PAYOUT_NOTE_LENGTH = 500;

/**
 * Auth0 role that may credit balances and pay withdrawals - the role the admin
 * app already gates Finance on.
 */
export const PARTNER_PAYOUT_ROLE = 'finance';
