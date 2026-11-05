import { randomUUID } from 'crypto';

import {
  adjustPartnerWallet,
  createPartnerWithdrawal,
  getPartnerWallet,
  getPartnerWithdrawalById,
  queryPartnerLedgerByEmail,
  queryPartnerWithdrawalsByEmail,
  queryPartnerWithdrawalsByStatus,
  scanPartnerWallets,
  transitionPartnerWithdrawal,
} from '../lib/dynamoDb';
import {
  MAX_ADJUSTMENT_AMOUNT,
  MAX_PAYOUT_NOTE_LENGTH,
  OPEN_WITHDRAWAL_STATUSES,
  PartnerBankAccount,
  PartnerLedgerEntry,
  PartnerWithdrawal,
  WithdrawalStatus,
  minWithdrawalAmount,
} from '../models/partnerPayout';
import { sendPartnerPayoutEmail } from './partnerPayoutEmailService';

const HISTORY_LIMIT = 50;

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const normalizeEmail = (value: unknown): string => str(value).toLowerCase();
const num = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENTRY_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

const isConditionFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException');

export type PayoutFailureReason =
  | 'INVALID_EMAIL'
  | 'INVALID_AMOUNT'
  | 'AMOUNT_BELOW_MINIMUM'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_BANK_ACCOUNT'
  | 'NOTE_TOO_LONG'
  | 'NOTE_REQUIRED'
  | 'REJECT_REASON_REQUIRED'
  | 'TRANSFER_REFERENCE_REQUIRED'
  | 'INVALID_ENTRY_ID'
  | 'DUPLICATE_ENTRY'
  | 'WALLET_NOT_FOUND'
  | 'WITHDRAWAL_OPEN'
  | 'WITHDRAWAL_NOT_FOUND'
  | 'NOT_OWNER'
  | 'INVALID_STATE';

export type PayoutFailure = { success: false; reason: PayoutFailureReason; message: string } & Record<
  string,
  unknown
>;

const fail = (reason: PayoutFailureReason, message: string, extra: Record<string, unknown> = {}): PayoutFailure => ({
  success: false,
  reason,
  message,
  ...extra,
});

// ---------------------------------------------------------------------------
// Shapes returned to the clients

export type WalletView = {
  email: string;
  partnerKey?: string;
  partnerName?: string;
  balance: number;
  onHold: number;
  totalCredited: number;
  totalPaidOut: number;
  openWithdrawalId?: string;
  bankAccount?: PartnerBankAccount;
  createdAt?: string;
  updatedAt?: string;
};

const toWalletView = (email: string, item?: Record<string, unknown>): WalletView => ({
  email,
  partnerKey: str(item?.partnerKey) || undefined,
  partnerName: str(item?.partnerName) || undefined,
  balance: num(item?.balance),
  onHold: num(item?.onHold),
  totalCredited: num(item?.totalCredited),
  totalPaidOut: num(item?.totalPaidOut),
  openWithdrawalId: str(item?.openWithdrawalId) || undefined,
  bankAccount: (item?.bankAccount as PartnerBankAccount | undefined) || undefined,
  createdAt: str(item?.createdAt) || undefined,
  updatedAt: str(item?.updatedAt) || undefined,
});

// ---------------------------------------------------------------------------
// Validation

const parseAmount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

const parseNote = (value: unknown): { note?: string; tooLong: boolean } => {
  const note = str(value);

  return { note: note || undefined, tooLong: note.length > MAX_PAYOUT_NOTE_LENGTH };
};

/**
 * Bank name and holder are free text; the account number keeps digits only so
 * "123-456 789" and "123456789" are the same account.
 */
const parseBankAccount = (value: unknown): PartnerBankAccount | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const bankName = str(raw.bankName);
  const accountName = str(raw.accountName);
  const accountNumber = str(raw.accountNumber).replace(/[\s-]/g, '');

  if (bankName.length < 2 || bankName.length > 60) {
    return null;
  }

  if (accountName.length < 2 || accountName.length > 100) {
    return null;
  }

  if (!/^\d{5,20}$/.test(accountNumber)) {
    return null;
  }

  return { bankName, accountNumber, accountName };
};

// ---------------------------------------------------------------------------
// Partner side (identity is the email on the partner's own token)

export type PartnerPayoutSummary = {
  wallet: WalletView;
  minWithdrawal: number;
  openWithdrawal?: Record<string, unknown>;
  withdrawals: Record<string, unknown>[];
  ledger: Record<string, unknown>[];
};

// The partner sees what happened, not which finance staff did it.
const forPartnerLedger = (entry: Record<string, unknown>): Record<string, unknown> => {
  const { by: _by, ...rest } = entry;

  void _by;
  return rest;
};

export const toPartnerWithdrawalView = (withdrawal: Record<string, unknown>): Record<string, unknown> => {
  const { reviewedBy: _reviewedBy, paidBy: _paidBy, events, ...rest } = withdrawal;

  void _reviewedBy;
  void _paidBy;
  return {
    ...rest,
    events: Array.isArray(events)
      ? events.map((event) => {
          const { by: _by, ...visible } = (event || {}) as Record<string, unknown>;

          void _by;
          return visible;
        })
      : [],
  };
};

export const getPartnerPayoutSummary = async (rawEmail: string): Promise<PartnerPayoutSummary> => {
  const email = normalizeEmail(rawEmail);
  const [walletResult, withdrawals, ledger] = await Promise.all([
    getPartnerWallet(email),
    queryPartnerWithdrawalsByEmail(email, HISTORY_LIMIT),
    queryPartnerLedgerByEmail(email, HISTORY_LIMIT),
  ]);
  const wallet = toWalletView(email, walletResult.Item);
  const openWithdrawal = wallet.openWithdrawalId
    ? withdrawals.find((item) => item.withdrawalId === wallet.openWithdrawalId) ||
      (await getPartnerWithdrawalById(wallet.openWithdrawalId)).Item
    : undefined;

  return {
    wallet,
    minWithdrawal: minWithdrawalAmount(),
    openWithdrawal: openWithdrawal ? toPartnerWithdrawalView(openWithdrawal) : undefined,
    withdrawals: withdrawals.map(toPartnerWithdrawalView),
    ledger: ledger.map(forPartnerLedger),
  };
};

export type WithdrawalResult =
  | { success: true; withdrawal: Record<string, unknown> }
  | PayoutFailure;

export const requestPartnerWithdrawal = async (params: {
  email: string;
  amount: unknown;
  bankAccount: unknown;
  note?: unknown;
}): Promise<WithdrawalResult> => {
  const email = normalizeEmail(params.email);
  const amount = parseAmount(params.amount);
  const minimum = minWithdrawalAmount();

  if (amount === null) {
    return fail('INVALID_AMOUNT', 'amount must be a whole number of rupiah greater than 0');
  }

  if (amount < minimum) {
    return fail('AMOUNT_BELOW_MINIMUM', `the minimum withdrawal is ${minimum}`, { minWithdrawal: minimum });
  }

  const bankAccount = parseBankAccount(params.bankAccount);

  if (!bankAccount) {
    return fail(
      'INVALID_BANK_ACCOUNT',
      'bankAccount needs bankName, accountName and an accountNumber of 5-20 digits',
    );
  }

  const { note, tooLong } = parseNote(params.note);

  if (tooLong) {
    return fail('NOTE_TOO_LONG', `note must be at most ${MAX_PAYOUT_NOTE_LENGTH} characters`);
  }

  const walletItem = (await getPartnerWallet(email)).Item;

  if (!walletItem) {
    return fail('INSUFFICIENT_BALANCE', 'there is no balance to withdraw yet', { balance: 0 });
  }

  const wallet = toWalletView(email, walletItem);

  if (wallet.openWithdrawalId) {
    return fail('WITHDRAWAL_OPEN', 'a withdrawal is already being processed', {
      openWithdrawalId: wallet.openWithdrawalId,
    });
  }

  if (amount > wallet.balance) {
    return fail('INSUFFICIENT_BALANCE', 'amount is more than the available balance', {
      balance: wallet.balance,
    });
  }

  const now = new Date().toISOString();
  const withdrawalId = `WD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const withdrawal: PartnerWithdrawal = {
    withdrawalId,
    email,
    ...(wallet.partnerKey ? { partnerKey: wallet.partnerKey } : {}),
    ...(wallet.partnerName ? { partnerName: wallet.partnerName } : {}),
    amount,
    bankAccount,
    ...(note ? { note } : {}),
    status: 'PENDING_REVIEW',
    events: [{ at: now, status: 'PENDING_REVIEW', by: email }],
    createdAt: now,
    updatedAt: now,
  };
  const entry: PartnerLedgerEntry = {
    entryId: `${withdrawalId}-HOLD`,
    email,
    type: 'WITHDRAWAL',
    amount: -amount,
    withdrawalId,
    by: email,
    createdAt: now,
  };

  try {
    await createPartnerWithdrawal({ withdrawal, entry });
  } catch (error) {
    if (isConditionFailure(error)) {
      // Lost a race with another tab or a finance debit: re-read and explain.
      const fresh = toWalletView(email, (await getPartnerWallet(email)).Item);

      return fresh.openWithdrawalId
        ? fail('WITHDRAWAL_OPEN', 'a withdrawal is already being processed', {
            openWithdrawalId: fresh.openWithdrawalId,
          })
        : fail('INSUFFICIENT_BALANCE', 'amount is more than the available balance', {
            balance: fresh.balance,
          });
    }

    throw error;
  }

  await sendPartnerPayoutEmail('REQUESTED', withdrawal);

  return { success: true, withdrawal };
};

const returnEntryFor = (withdrawal: Record<string, unknown>, by: string, at: string, note?: string): PartnerLedgerEntry => ({
  entryId: `${str(withdrawal.withdrawalId)}-RETURN`,
  email: str(withdrawal.email),
  type: 'WITHDRAWAL_RETURNED',
  amount: num(withdrawal.amount),
  withdrawalId: str(withdrawal.withdrawalId),
  ...(note ? { note } : {}),
  by,
  createdAt: at,
});

const loadWithdrawal = async (withdrawalId: string): Promise<Record<string, unknown> | undefined> =>
  withdrawalId ? (await getPartnerWithdrawalById(withdrawalId)).Item : undefined;

/** The partner takes back a request finance has not picked up yet. */
export const cancelPartnerWithdrawal = async (
  rawEmail: string,
  withdrawalId: string,
): Promise<WithdrawalResult> => {
  const email = normalizeEmail(rawEmail);
  const withdrawal = await loadWithdrawal(withdrawalId);

  if (!withdrawal) {
    return fail('WITHDRAWAL_NOT_FOUND', 'withdrawal not found');
  }

  if (normalizeEmail(withdrawal.email) !== email) {
    return fail('NOT_OWNER', 'this withdrawal belongs to another partner');
  }

  if (withdrawal.status !== 'PENDING_REVIEW') {
    return fail('INVALID_STATE', 'only a withdrawal still waiting for review can be cancelled', {
      status: withdrawal.status,
    });
  }

  return runTransition(withdrawal, {
    from: ['PENDING_REVIEW'],
    to: 'CANCELLED',
    by: email,
  });
};

// ---------------------------------------------------------------------------
// Finance side

export const listPartnerWallets = async (): Promise<WalletView[]> => {
  const items = await scanPartnerWallets();

  return items
    .map((item) => toWalletView(str(item.email), item))
    .sort((a, b) => b.balance + b.onHold - (a.balance + a.onHold) || a.email.localeCompare(b.email));
};

export const getPartnerWalletDetail = async (
  rawEmail: string,
): Promise<{ success: true; wallet: WalletView; ledger: Record<string, unknown>[]; withdrawals: Record<string, unknown>[] } | PayoutFailure> => {
  const email = normalizeEmail(rawEmail);
  const [walletResult, ledger, withdrawals] = await Promise.all([
    getPartnerWallet(email),
    queryPartnerLedgerByEmail(email, HISTORY_LIMIT),
    queryPartnerWithdrawalsByEmail(email, HISTORY_LIMIT),
  ]);

  if (!walletResult.Item) {
    return fail('WALLET_NOT_FOUND', 'no wallet for this email');
  }

  return { success: true, wallet: toWalletView(email, walletResult.Item), ledger, withdrawals };
};

export type AdjustmentResult =
  | { success: true; wallet: WalletView; entry: PartnerLedgerEntry }
  | PayoutFailure;

/**
 * Finance adds earnings (CREDIT) or takes back a mistaken credit (DEBIT). The
 * note is required: it is what the partner sees in their balance history.
 */
export const adjustPartnerBalance = async (params: {
  email: unknown;
  type: unknown;
  amount: unknown;
  note: unknown;
  entryId?: unknown;
  partnerKey?: unknown;
  partnerName?: unknown;
  by: string;
}): Promise<AdjustmentResult> => {
  const email = normalizeEmail(params.email);

  if (!EMAIL_PATTERN.test(email)) {
    return fail('INVALID_EMAIL', 'email must be the address the partner logs in with');
  }

  const type = params.type === 'DEBIT' ? 'DEBIT' : params.type === 'CREDIT' ? 'CREDIT' : null;
  const amount = parseAmount(params.amount);

  if (!type || amount === null || amount > MAX_ADJUSTMENT_AMOUNT) {
    return fail(
      'INVALID_AMOUNT',
      `type must be CREDIT or DEBIT and amount a whole number from 1 to ${MAX_ADJUSTMENT_AMOUNT}`,
    );
  }

  const { note, tooLong } = parseNote(params.note);

  if (!note) {
    return fail('NOTE_REQUIRED', 'note is required; the partner sees it in their history');
  }

  if (tooLong) {
    return fail('NOTE_TOO_LONG', `note must be at most ${MAX_PAYOUT_NOTE_LENGTH} characters`);
  }

  const requestedEntryId = str(params.entryId);

  if (requestedEntryId && !ENTRY_ID_PATTERN.test(requestedEntryId)) {
    return fail('INVALID_ENTRY_ID', 'entryId must be 8-64 letters, digits or dashes');
  }

  const partnerKey = str(params.partnerKey).toLowerCase().slice(0, 60) || undefined;
  const partnerName = str(params.partnerName).slice(0, 100) || undefined;
  const entry: PartnerLedgerEntry = {
    entryId: requestedEntryId || randomUUID(),
    email,
    type,
    amount: type === 'CREDIT' ? amount : -amount,
    note,
    by: params.by,
    createdAt: new Date().toISOString(),
  };

  try {
    await adjustPartnerWallet({ entry, partnerKey, partnerName });
  } catch (error) {
    if (!isConditionFailure(error)) {
      throw error;
    }

    const cancellation = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
    const walletItem = (await getPartnerWallet(email)).Item;

    // The ledger Put is first in the transaction: a failure there means this
    // exact entry was already posted (a retried submit).
    if (cancellation?.[0]?.Code === 'ConditionalCheckFailed') {
      return fail('DUPLICATE_ENTRY', 'this adjustment was already posted', {
        wallet: toWalletView(email, walletItem),
      });
    }

    if (!walletItem) {
      return fail('WALLET_NOT_FOUND', 'cannot debit a partner that has no balance');
    }

    return fail('INSUFFICIENT_BALANCE', 'debit is more than the available balance', {
      balance: num(walletItem.balance),
    });
  }

  return {
    success: true,
    entry,
    wallet: toWalletView(email, (await getPartnerWallet(email)).Item),
  };
};

export const listPartnerWithdrawals = async (
  statuses: readonly WithdrawalStatus[],
): Promise<Record<string, unknown>[]> => {
  const pages = await Promise.all(statuses.map((status) => queryPartnerWithdrawalsByStatus(status)));

  return pages.flat().sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt)));
};

export const getPartnerWithdrawal = loadWithdrawal;

const runTransition = async (
  withdrawal: Record<string, unknown>,
  params: {
    from: readonly WithdrawalStatus[];
    to: WithdrawalStatus;
    by: string;
    note?: string;
    set?: Record<string, unknown>;
  },
): Promise<WithdrawalResult> => {
  const at = new Date().toISOString();
  const releases = params.to === 'REJECTED' || params.to === 'CANCELLED';

  try {
    await transitionPartnerWithdrawal({
      withdrawal: {
        withdrawalId: str(withdrawal.withdrawalId),
        email: str(withdrawal.email),
        amount: num(withdrawal.amount),
      },
      from: params.from,
      to: params.to,
      event: { at, status: params.to, by: params.by, ...(params.note ? { note: params.note } : {}) },
      set: params.set,
      ...(releases ? { returnEntry: returnEntryFor(withdrawal, params.by, at, params.note) } : {}),
    });
  } catch (error) {
    if (isConditionFailure(error)) {
      const fresh = await loadWithdrawal(str(withdrawal.withdrawalId));

      return fail('INVALID_STATE', 'the withdrawal was changed by someone else; reload and try again', {
        status: fresh?.status,
      });
    }

    throw error;
  }

  return { success: true, withdrawal: (await loadWithdrawal(str(withdrawal.withdrawalId))) || withdrawal };
};

const loadForFinance = async (
  withdrawalId: string,
  allowed: readonly WithdrawalStatus[],
): Promise<{ withdrawal: Record<string, unknown> } | PayoutFailure> => {
  const withdrawal = await loadWithdrawal(withdrawalId);

  if (!withdrawal) {
    return fail('WITHDRAWAL_NOT_FOUND', 'withdrawal not found');
  }

  if (!allowed.includes(withdrawal.status as WithdrawalStatus)) {
    return fail('INVALID_STATE', `withdrawal is ${String(withdrawal.status)}`, { status: withdrawal.status });
  }

  return { withdrawal };
};

/** Finance confirms the request and will transfer; the partner sees "Disetujui". */
export const approvePartnerWithdrawal = async (withdrawalId: string, by: string): Promise<WithdrawalResult> => {
  const loaded = await loadForFinance(withdrawalId, ['PENDING_REVIEW']);

  if ('success' in loaded) {
    return loaded;
  }

  return runTransition(loaded.withdrawal, {
    from: ['PENDING_REVIEW'],
    to: 'APPROVED',
    by,
    set: { reviewedBy: by, reviewedAt: new Date().toISOString() },
  });
};

export const rejectPartnerWithdrawal = async (
  withdrawalId: string,
  by: string,
  reason: unknown,
): Promise<WithdrawalResult> => {
  const { note: rejectReason, tooLong } = parseNote(reason);

  if (!rejectReason) {
    return fail('REJECT_REASON_REQUIRED', 'reason is required; it is sent to the partner');
  }

  if (tooLong) {
    return fail('NOTE_TOO_LONG', `reason must be at most ${MAX_PAYOUT_NOTE_LENGTH} characters`);
  }

  const loaded = await loadForFinance(withdrawalId, OPEN_WITHDRAWAL_STATUSES);

  if ('success' in loaded) {
    return loaded;
  }

  const result = await runTransition(loaded.withdrawal, {
    from: OPEN_WITHDRAWAL_STATUSES,
    to: 'REJECTED',
    by,
    note: rejectReason,
    set: { rejectReason, reviewedBy: by, reviewedAt: new Date().toISOString() },
  });

  if (result.success) {
    await sendPartnerPayoutEmail('REJECTED', result.withdrawal);
  }

  return result;
};

/**
 * Finance transferred the money by hand and records the bank reference. This
 * is the step that closes the withdrawal and counts it as paid out.
 */
export const markPartnerWithdrawalPaid = async (
  withdrawalId: string,
  by: string,
  transferReference: unknown,
  note?: unknown,
): Promise<WithdrawalResult> => {
  const reference = str(transferReference).slice(0, 120);

  if (!reference) {
    return fail('TRANSFER_REFERENCE_REQUIRED', 'transferReference is required');
  }

  const { note: paidNote, tooLong } = parseNote(note);

  if (tooLong) {
    return fail('NOTE_TOO_LONG', `note must be at most ${MAX_PAYOUT_NOTE_LENGTH} characters`);
  }

  const loaded = await loadForFinance(withdrawalId, OPEN_WITHDRAWAL_STATUSES);

  if ('success' in loaded) {
    return loaded;
  }

  const now = new Date().toISOString();
  const result = await runTransition(loaded.withdrawal, {
    from: OPEN_WITHDRAWAL_STATUSES,
    to: 'PAID',
    by,
    note: paidNote || `Ref: ${reference}`,
    set: {
      transferReference: reference,
      paidBy: by,
      paidAt: now,
      ...(loaded.withdrawal.reviewedBy ? {} : { reviewedBy: by, reviewedAt: now }),
    },
  });

  if (result.success) {
    await sendPartnerPayoutEmail('PAID', result.withdrawal);
  }

  return result;
};
