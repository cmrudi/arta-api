import {
  createPartnerAccount,
  deletePartnerAccount,
  getPartnerAccount,
  queryPartnerAccountsByEmail,
  queryPartnerAccountsByKey,
  queryPublishedEsimOrdersByPartnerId,
  scanPartnerAccounts,
  setPartnerAccountEmail,
  setPartnerAccountKey,
  updatePartnerAccountName,
} from '../lib/dynamoDb';
import {
  MAX_PARTNER_NAME_LENGTH,
  PARTNER_EMAIL_PATTERN,
  PARTNER_ID_PREFIX,
  PARTNER_KEY_PATTERN,
  PartnerAccount,
  isPartnerId,
  newPartnerId,
  normalizePartnerEmail,
  normalizePartnerKey,
} from '../models/partner';

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isConditionFailure = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'TransactionCanceledException' || error.name === 'ConditionalCheckFailedException');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait before the re-check. The indexes trail the table by up to
 * about a second, so re-checking at once could miss a duplicate that a
 * parallel request has just written.
 */
const recheckDelayMs = (): number => {
  const value = Number(process.env.PARTNER_RECHECK_DELAY_MS);

  return Number.isFinite(value) && value >= 0 ? value : 1000;
};

export type PartnerFailureReason =
  | 'INVALID_KEY'
  | 'KEY_TAKEN'
  | 'INVALID_EMAIL'
  | 'EMAIL_TAKEN'
  | 'ALREADY_REGISTERED'
  | 'INVALID_NAME'
  | 'INVALID_PARTNER_ID'
  | 'PARTNER_NOT_FOUND'
  | 'CONFLICT';

export type PartnerFailure = { success: false; reason: PartnerFailureReason; message: string } & Record<
  string,
  unknown
>;

const fail = (reason: PartnerFailureReason, message: string, extra: Record<string, unknown> = {}): PartnerFailure => ({
  success: false,
  reason,
  message,
  ...extra,
});

const toAccount = (item: Record<string, unknown>): PartnerAccount => ({
  partnerId: str(item.partnerId),
  email: str(item.email),
  key: str(item.key),
  ...(Array.isArray(item.previousKeys) && item.previousKeys.length
    ? { previousKeys: item.previousKeys.map((value) => str(value)).filter(Boolean) }
    : {}),
  ...(str(item.name) ? { name: str(item.name) } : {}),
  createdAt: str(item.createdAt),
  updatedAt: str(item.updatedAt),
});

/** The account that keeps an email or key when there are several: the oldest. */
const byAge = (a: PartnerAccount, b: PartnerAccount): number =>
  a.createdAt.localeCompare(b.createdAt) || a.partnerId.localeCompare(b.partnerId);

// Only real PTN-... accounts count; any other row that happens to carry an
// email or key (e.g. left over from an earlier layout) is ignored.
const realAccounts = (items: Record<string, unknown>[]): PartnerAccount[] =>
  items
    .map(toAccount)
    .filter((account) => isPartnerId(account.partnerId))
    .sort(byAge);

/** Every account with this email / key, oldest first. Normally zero or one. */
const accountsWithEmail = async (email: string): Promise<PartnerAccount[]> =>
  realAccounts(await queryPartnerAccountsByEmail(email));

const accountsWithKey = async (key: string): Promise<PartnerAccount[]> =>
  realAccounts(await queryPartnerAccountsByKey(key));

// ---------------------------------------------------------------------------
// Lookups

export const findPartnerByEmail = async (rawEmail: string): Promise<PartnerAccount | undefined> => {
  const email = normalizePartnerEmail(rawEmail);

  return email ? (await accountsWithEmail(email))[0] : undefined;
};

export const findPartnerByKey = async (rawKey: string): Promise<PartnerAccount | undefined> => {
  const key = normalizePartnerKey(rawKey);

  return key ? (await accountsWithKey(key))[0] : undefined;
};

export const findPartnerById = async (partnerId: string): Promise<PartnerAccount | undefined> => {
  if (!isPartnerId(partnerId)) {
    return undefined;
  }

  const account = (await getPartnerAccount(partnerId)).Item;

  return account ? toAccount(account) : undefined;
};

export const partnerKeyExists = async (rawKey: string): Promise<boolean> => Boolean(await findPartnerByKey(rawKey));

// ---------------------------------------------------------------------------
// Partner portal

export type RegisterResult =
  | { success: true; partnerId: string; key: string; createdAccount: true }
  | PartnerFailure;

/**
 * The logged-in user becomes a partner with the key they chose. One account
 * per email and one key per account; the email is the one on their token,
 * never one from the request body.
 *
 * Uniqueness of email and key: check before creating, re-check after. If a
 * parallel request created a clashing account meanwhile, the newer account
 * (by createdAt, then partnerId - both requests agree) deletes itself.
 */
export const registerPartner = async (params: { email: string; key: unknown }): Promise<RegisterResult> => {
  const email = normalizePartnerEmail(params.email);
  const key = normalizePartnerKey(params.key);

  if (!PARTNER_KEY_PATTERN.test(key)) {
    return fail('INVALID_KEY', 'key must be 3-40 lowercase letters, digits or hyphens');
  }

  if (!PARTNER_EMAIL_PATTERN.test(email)) {
    return fail('INVALID_EMAIL', 'the login email is not a valid address');
  }

  const existing = (await accountsWithEmail(email))[0];

  if (existing) {
    return fail('ALREADY_REGISTERED', 'this email already has a partner account', {
      partnerId: existing.partnerId,
      key: existing.key,
    });
  }

  if ((await accountsWithKey(key)).length > 0) {
    return fail('KEY_TAKEN', 'this key is already used');
  }

  const now = new Date().toISOString();
  let partnerId = '';

  // Two attempts only to survive a (practically impossible) partnerId collision.
  for (let attempt = 0; attempt < 2 && !partnerId; attempt += 1) {
    const candidate = newPartnerId();

    try {
      await createPartnerAccount({ partnerId: candidate, email, key, createdAt: now, updatedAt: now });
      partnerId = candidate;
    } catch (error) {
      if (!isConditionFailure(error)) {
        throw error;
      }
    }
  }

  if (!partnerId) {
    return fail('CONFLICT', 'could not register; please try again');
  }

  await sleep(recheckDelayMs());

  const [sameEmail, sameKey] = await Promise.all([accountsWithEmail(email), accountsWithKey(key)]);
  const keyKeeper = sameKey[0];
  const emailKeeper = sameEmail[0];
  const lostKey = keyKeeper && keyKeeper.partnerId !== partnerId;
  const lostEmail = emailKeeper && emailKeeper.partnerId !== partnerId;

  if (lostKey || lostEmail) {
    await deletePartnerAccount(partnerId).catch((error) => {
      if (!isConditionFailure(error)) {
        throw error;
      }
    });
    console.warn('[partner] removed an account that clashed with a parallel sign-up', {
      email,
      key,
      removed: partnerId,
    });

    return lostEmail
      ? fail('ALREADY_REGISTERED', 'this email already has a partner account', {
          partnerId: emailKeeper.partnerId,
          key: emailKeeper.key,
        })
      : fail('KEY_TAKEN', 'this key is already used');
  }

  return { success: true, partnerId, key, createdAccount: true };
};

const maskEmail = (value = ''): string => value.replace(/(^.).*(@.).*$/, (_m, a, b) => `${a}***${b}***`);

const maskName = (name = ''): string =>
  name
    .split(' ')
    .map((word) => (word ? `${word[0]}***` : ''))
    .join(' ');

/**
 * What a partner may see of an order: no customer details beyond a masked
 * email and name, and their commission in place of the price. Same fields as
 * the old AffiliateGetOrders Lambda returned.
 */
const toPartnerOrder = (order: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};

  for (const field of ['orderId', 'customerName', 'productCode', 'status', 'createdAt', 'orderType', 'partner', 'email']) {
    if (order[field] === undefined) {
      continue;
    }

    if (field === 'email') {
      out.email = maskEmail(str(order.email));
    } else if (field === 'customerName') {
      out.customerName = maskName(str(order.customerName));
    } else {
      out[field] = order[field];
    }
  }

  out.price = order.partnerSharing ?? 0;
  return out;
};

const ORDERS_CAP = 2000;

export type PartnerOrdersResult =
  | {
      success: true;
      partnerId: string;
      key: string;
      /** Kept for the portal, which lists "other links" from it; one entry now. */
      keys: Array<{ key: string }>;
      items: Record<string, unknown>[];
      count: number;
      lastEvaluatedKey: null;
    }
  | PartnerFailure;

/** The partner's paid eSIM sales, newest first, whatever key they came through. */
export const getPartnerOrders = async (rawEmail: string): Promise<PartnerOrdersResult> => {
  const account = await findPartnerByEmail(rawEmail);

  if (!account) {
    // The portal shows its "create your link" screen on this exact message.
    return fail('PARTNER_NOT_FOUND', 'Partner not found');
  }

  const items = (await queryPublishedEsimOrdersByPartnerId(account.partnerId, ORDERS_CAP)).map(toPartnerOrder);

  return {
    success: true,
    partnerId: account.partnerId,
    key: account.key,
    keys: account.key ? [{ key: account.key }] : [],
    items,
    count: items.length,
    lastEvaluatedKey: null,
  };
};

// ---------------------------------------------------------------------------
// Finance / admin

export type PartnerView = PartnerAccount & {
  /** Another account has the same login email or key (should not happen). */
  duplicateEmail?: boolean;
  duplicateKey?: boolean;
};

export const listPartners = async (): Promise<PartnerView[]> => {
  const accounts = realAccounts(await scanPartnerAccounts(PARTNER_ID_PREFIX));
  const count = (values: string[]) =>
    values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map<string, number>());
  const emails = count(accounts.map((account) => account.email));
  const keys = count(accounts.map((account) => account.key).filter(Boolean));

  return accounts
    .map((account) => ({
      ...account,
      ...((emails.get(account.email) || 0) > 1 ? { duplicateEmail: true } : {}),
      ...(account.key && (keys.get(account.key) || 0) > 1 ? { duplicateKey: true } : {}),
    }))
    .sort((a, b) => a.email.localeCompare(b.email) || byAge(a, b));
};

export type PartnerDetailResult = { success: true; partner: PartnerAccount } | PartnerFailure;

export const getPartnerDetail = async (partnerId: string): Promise<PartnerDetailResult> => {
  if (!isPartnerId(partnerId)) {
    return fail('INVALID_PARTNER_ID', 'partnerId looks like PTN-XXXXXXXX');
  }

  const account = await findPartnerById(partnerId);

  return account ? { success: true, partner: account } : fail('PARTNER_NOT_FOUND', 'partner not found');
};

/**
 * Change one unique field (email or key) of an account: check that no other
 * account has the new value, write it only if the old value is still there,
 * re-check after the index catches up, and put the old value back on a clash.
 */
const changeUniqueField = async (params: {
  current: PartnerAccount;
  newValue: string;
  holders: (value: string) => Promise<PartnerAccount[]>;
  write: (from: string, to: string, keepHistory: boolean) => Promise<void>;
  oldValue: string;
  taken: PartnerFailure;
}): Promise<PartnerFailure | undefined> => {
  const { current, newValue } = params;
  const takenByOther = async (): Promise<boolean> =>
    (await params.holders(newValue)).some((item) => item.partnerId !== current.partnerId);

  if (await takenByOther()) {
    return params.taken;
  }

  try {
    await params.write(params.oldValue, newValue, true);
  } catch (error) {
    if (isConditionFailure(error)) {
      return fail('CONFLICT', 'the partner was changed meanwhile; reload and try again');
    }

    throw error;
  }

  await sleep(recheckDelayMs());

  if (await takenByOther()) {
    await params
      .write(newValue, params.oldValue, false)
      .catch((error) => console.error('[partner] could not revert change', current.partnerId, error));

    return params.taken;
  }

  return undefined;
};

/**
 * Finance changes a partner's login email, key and/or display name. The
 * partnerId, past orders, wallet and history stay as they are. A new key
 * credits sales from now on; the old one goes to previousKeys and stops
 * crediting new sales.
 */
export const updatePartner = async (params: {
  partnerId: string;
  email?: unknown;
  key?: unknown;
  name?: unknown;
}): Promise<PartnerDetailResult> => {
  const loaded = await getPartnerDetail(params.partnerId);

  if (!loaded.success) {
    return loaded;
  }

  const current = loaded.partner;
  const now = (): string => new Date().toISOString();

  if (params.name !== undefined) {
    const name = str(params.name);

    if (!name || name.length > MAX_PARTNER_NAME_LENGTH) {
      return fail('INVALID_NAME', `name must be 1-${MAX_PARTNER_NAME_LENGTH} characters`);
    }

    await updatePartnerAccountName({ partnerId: current.partnerId, name, now: now() });
  }

  if (params.email !== undefined) {
    const email = normalizePartnerEmail(params.email);

    if (!PARTNER_EMAIL_PATTERN.test(email)) {
      return fail('INVALID_EMAIL', 'email must be a valid address');
    }

    if (email !== current.email) {
      const failed = await changeUniqueField({
        current,
        newValue: email,
        oldValue: current.email,
        holders: accountsWithEmail,
        write: (from, to) => setPartnerAccountEmail({ partnerId: current.partnerId, oldEmail: from, newEmail: to, now: now() }),
        taken: fail('EMAIL_TAKEN', 'another partner already logs in with this email'),
      });

      if (failed) {
        return failed;
      }
    }
  }

  if (params.key !== undefined) {
    const key = normalizePartnerKey(params.key);

    if (!PARTNER_KEY_PATTERN.test(key)) {
      return fail('INVALID_KEY', 'key must be 3-40 lowercase letters, digits or hyphens');
    }

    if (key !== current.key) {
      const failed = await changeUniqueField({
        current,
        newValue: key,
        oldValue: current.key,
        holders: accountsWithKey,
        write: (from, to, keepHistory) =>
          setPartnerAccountKey({ partnerId: current.partnerId, oldKey: from, newKey: to, now: now(), keepHistory }),
        taken: fail('KEY_TAKEN', 'this key is already used'),
      });

      if (failed) {
        return failed;
      }
    }
  }

  return getPartnerDetail(current.partnerId);
};
