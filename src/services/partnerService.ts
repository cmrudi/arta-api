import {
  createPartnerAccountWithKey,
  deletePartnerAccount,
  getPartnerAccount,
  getPartnerKey,
  putPartnerKey,
  queryPartnerAccountsByEmail,
  queryPartnerKeysByPartnerId,
  queryPublishedEsimOrdersByPartnerKey,
  reassignPartnerKey,
  scanPartnerAccounts,
  scanPartnerKeys,
  setPartnerAccountEmail,
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

const cancellationCodes = (error: unknown): Array<string | undefined> =>
  ((error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons || []).map(
    (reason) => reason?.Code,
  );

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait before the re-check. The email index trails the table by
 * up to about a second, so re-checking at once could miss a duplicate that a
 * parallel request has just written.
 */
const recheckDelayMs = (): number => {
  const value = Number(process.env.PARTNER_RECHECK_DELAY_MS);

  return Number.isFinite(value) && value >= 0 ? value : 1000;
};

/** The account that keeps an email when there are several: the oldest. */
const byAge = (a: PartnerAccount, b: PartnerAccount): number =>
  a.createdAt.localeCompare(b.createdAt) || a.partnerId.localeCompare(b.partnerId);

export type PartnerFailureReason =
  | 'INVALID_KEY'
  | 'KEY_TAKEN'
  | 'INVALID_EMAIL'
  | 'EMAIL_TAKEN'
  | 'INVALID_NAME'
  | 'INVALID_PARTNER_ID'
  | 'PARTNER_NOT_FOUND'
  | 'CONFLICT';

export type PartnerFailure = { success: false; reason: PartnerFailureReason; message: string };

const fail = (reason: PartnerFailureReason, message: string): PartnerFailure => ({
  success: false,
  reason,
  message,
});

const toAccount = (item: Record<string, unknown>): PartnerAccount => ({
  partnerId: str(item.partnerId),
  email: str(item.email),
  ...(str(item.name) ? { name: str(item.name) } : {}),
  createdAt: str(item.createdAt),
  updatedAt: str(item.updatedAt),
});

export type PartnerKeyView = { key: string; createdAt?: string };

// Oldest first. Rows created before keys had dates sort first.
const toKeyViews = (items: Record<string, unknown>[]): PartnerKeyView[] =>
  items
    .map((item) => ({ key: str(item.key), ...(str(item.createdAt) ? { createdAt: str(item.createdAt) } : {}) }))
    .filter((item) => item.key)
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || a.key.localeCompare(b.key));

/** The key the portal shows as "your link": the most recently created one. */
const primaryKeyOf = (keys: PartnerKeyView[]): string | undefined => keys[keys.length - 1]?.key;

// ---------------------------------------------------------------------------
// Lookups

/** Every account with this email, oldest first. Normally zero or one. */
const accountsWithEmail = async (email: string): Promise<PartnerAccount[]> =>
  (await queryPartnerAccountsByEmail(email)).map(toAccount).sort(byAge);

export const findPartnerByEmail = async (rawEmail: string): Promise<PartnerAccount | undefined> => {
  const email = normalizePartnerEmail(rawEmail);

  return email ? (await accountsWithEmail(email))[0] : undefined;
};

export const findPartnerById = async (partnerId: string): Promise<PartnerAccount | undefined> => {
  if (!isPartnerId(partnerId)) {
    return undefined;
  }

  const account = (await getPartnerAccount(partnerId)).Item;

  return account ? toAccount(account) : undefined;
};

export const listKeysOfPartner = async (partnerId: string): Promise<PartnerKeyView[]> =>
  toKeyViews(await queryPartnerKeysByPartnerId(partnerId));

export const partnerKeyExists = async (rawKey: string): Promise<boolean> => {
  const key = normalizePartnerKey(rawKey);

  return key ? Boolean((await getPartnerKey(key)).Item) : false;
};

// ---------------------------------------------------------------------------
// Partner portal

/**
 * Re-check after creating an account: if a parallel request created another
 * account for the same email, the newer one gives its keys to the oldest and
 * is deleted. Both requests run this, and both agree on which is oldest.
 * Returns the partnerId that keeps the email.
 */
const settleDuplicateAccounts = async (email: string, mine: string, myKey: string): Promise<string> => {
  await sleep(recheckDelayMs());

  const accounts = await accountsWithEmail(email);
  const keeper = accounts[0];

  if (!keeper || keeper.partnerId === mine || !accounts.some((item) => item.partnerId === mine)) {
    return mine;
  }

  // The key we just wrote may not be in the partnerId index yet, so move it by
  // name as well as anything the index already shows.
  const keys = new Set([myKey, ...(await queryPartnerKeysByPartnerId(mine)).map((item) => str(item.key))]);

  for (const key of keys) {
    try {
      await reassignPartnerKey({ key, from: mine, to: keeper.partnerId });
    } catch (error) {
      if (!isConditionFailure(error)) {
        throw error;
      }
    }
  }

  await deletePartnerAccount(mine).catch((error) => {
    if (!isConditionFailure(error)) {
      throw error;
    }
  });
  console.warn('[partner] merged a duplicate account created in parallel', { email, removed: mine, kept: keeper.partnerId });

  return keeper.partnerId;
};

export type RegisterResult =
  | { success: true; partnerId: string; key: string; createdAccount: boolean }
  | PartnerFailure;

/**
 * The logged-in user claims an affiliate key. Their first key creates their
 * partner account; any later key joins the same account. The email is the one
 * on their token, never one from the request body.
 *
 * One account per email: check before creating, re-check after (see
 * settleDuplicateAccounts).
 */
export const registerPartnerKey = async (params: { email: string; key: unknown }): Promise<RegisterResult> => {
  const email = normalizePartnerEmail(params.email);
  const key = normalizePartnerKey(params.key);

  if (!PARTNER_KEY_PATTERN.test(key)) {
    return fail('INVALID_KEY', 'key must be 3-40 lowercase letters, digits or hyphens');
  }

  if (!PARTNER_EMAIL_PATTERN.test(email)) {
    return fail('INVALID_EMAIL', 'the login email is not a valid address');
  }

  const now = new Date().toISOString();
  const existing = (await accountsWithEmail(email))[0];

  if (existing) {
    try {
      await putPartnerKey({ key, partnerId: existing.partnerId, email, createdAt: now });
    } catch (error) {
      if (isConditionFailure(error)) {
        return fail('KEY_TAKEN', 'this key is already used');
      }

      throw error;
    }

    return { success: true, partnerId: existing.partnerId, key, createdAccount: false };
  }

  // Two attempts only to survive a (practically impossible) partnerId collision.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const partnerId = newPartnerId();

    try {
      await createPartnerAccountWithKey({
        account: { partnerId, email, createdAt: now, updatedAt: now },
        key: { key, partnerId, email, createdAt: now },
      });
    } catch (error) {
      if (!isConditionFailure(error)) {
        throw error;
      }

      // Transaction order: [account, key].
      if (cancellationCodes(error)[1] === 'ConditionalCheckFailed') {
        return fail('KEY_TAKEN', 'this key is already used');
      }

      continue;
    }

    const kept = await settleDuplicateAccounts(email, partnerId, key);

    return { success: true, partnerId: kept, key, createdAccount: kept === partnerId };
  }

  return fail('CONFLICT', 'could not register the key; please try again');
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

const ORDERS_PER_KEY_CAP = 1000;

export type PartnerOrdersResult =
  | {
      success: true;
      partnerId: string;
      key?: string;
      keys: PartnerKeyView[];
      items: Record<string, unknown>[];
      count: number;
      lastEvaluatedKey: null;
    }
  | PartnerFailure;

/** Every paid eSIM sale through any of the partner's keys, newest first. */
export const getPartnerOrders = async (rawEmail: string): Promise<PartnerOrdersResult> => {
  const account = await findPartnerByEmail(rawEmail);

  if (!account) {
    // The portal shows its "create your link" screen on this exact message.
    return fail('PARTNER_NOT_FOUND', 'Partner not found');
  }

  const keys = await listKeysOfPartner(account.partnerId);
  const pages = await Promise.all(keys.map((item) => queryPublishedEsimOrdersByPartnerKey(item.key, ORDERS_PER_KEY_CAP)));
  const items = pages
    .flat()
    .sort((a, b) => str(b.createdAt).localeCompare(str(a.createdAt)))
    .map(toPartnerOrder);

  return {
    success: true,
    partnerId: account.partnerId,
    key: primaryKeyOf(keys),
    keys,
    items,
    count: items.length,
    lastEvaluatedKey: null,
  };
};

// ---------------------------------------------------------------------------
// Finance / admin

export type PartnerView = PartnerAccount & {
  keys: PartnerKeyView[];
  /** Another account has the same login email (should not happen; see models/partner.ts). */
  duplicateEmail?: boolean;
};

export const listPartners = async (): Promise<PartnerView[]> => {
  const [accounts, keyRows] = await Promise.all([scanPartnerAccounts(PARTNER_ID_PREFIX), scanPartnerKeys()]);
  const keysByPartner = new Map<string, Record<string, unknown>[]>();

  for (const row of keyRows) {
    const partnerId = str(row.partnerId);

    if (partnerId) {
      keysByPartner.set(partnerId, [...(keysByPartner.get(partnerId) || []), row]);
    }
  }

  const emailCounts = new Map<string, number>();

  for (const item of accounts) {
    const email = str(item.email);
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }

  return accounts
    .map((item) => {
      const account = toAccount(item);

      return {
        ...account,
        keys: toKeyViews(keysByPartner.get(account.partnerId) || []),
        ...((emailCounts.get(account.email) || 0) > 1 ? { duplicateEmail: true } : {}),
      };
    })
    .sort((a, b) => a.email.localeCompare(b.email) || byAge(a, b));
};

export type PartnerDetailResult = { success: true; partner: PartnerView } | PartnerFailure;

export const getPartnerDetail = async (partnerId: string): Promise<PartnerDetailResult> => {
  if (!isPartnerId(partnerId)) {
    return fail('INVALID_PARTNER_ID', 'partnerId looks like PTN-XXXXXXXX');
  }

  const account = await findPartnerById(partnerId);

  if (!account) {
    return fail('PARTNER_NOT_FOUND', 'partner not found');
  }

  return { success: true, partner: { ...account, keys: await listKeysOfPartner(partnerId) } };
};

/**
 * Finance changes a partner's login email and/or display name. The partnerId,
 * keys, orders, wallet and history stay as they are.
 */
export const updatePartner = async (params: {
  partnerId: string;
  email?: unknown;
  name?: unknown;
}): Promise<PartnerDetailResult> => {
  const loaded = await getPartnerDetail(params.partnerId);

  if (!loaded.success) {
    return loaded;
  }

  const current = loaded.partner;
  const now = new Date().toISOString();

  if (params.name !== undefined) {
    const name = str(params.name);

    if (!name || name.length > MAX_PARTNER_NAME_LENGTH) {
      return fail('INVALID_NAME', `name must be 1-${MAX_PARTNER_NAME_LENGTH} characters`);
    }

    await updatePartnerAccountName({ partnerId: current.partnerId, name, now });
  }

  if (params.email !== undefined) {
    const email = normalizePartnerEmail(params.email);

    if (!PARTNER_EMAIL_PATTERN.test(email)) {
      return fail('INVALID_EMAIL', 'email must be a valid address');
    }

    if (email !== current.email) {
      const takenBy = async (): Promise<boolean> =>
        (await accountsWithEmail(email)).some((item) => item.partnerId !== current.partnerId);

      // Check before changing...
      if (await takenBy()) {
        return fail('EMAIL_TAKEN', 'another partner already logs in with this email');
      }

      try {
        await setPartnerAccountEmail({ partnerId: current.partnerId, oldEmail: current.email, newEmail: email, now });
      } catch (error) {
        if (isConditionFailure(error)) {
          return fail('CONFLICT', 'the partner was changed meanwhile; reload and try again');
        }

        throw error;
      }

      // ...and re-check after: if another account took the email meanwhile,
      // put this partner's old email back.
      await sleep(recheckDelayMs());

      if (await takenBy()) {
        await setPartnerAccountEmail({
          partnerId: current.partnerId,
          oldEmail: email,
          newEmail: current.email,
          now: new Date().toISOString(),
        }).catch((error) => console.error('[partner] could not revert email change', current.partnerId, error));

        return fail('EMAIL_TAKEN', 'another partner already logs in with this email');
      }
    }
  }

  return getPartnerDetail(current.partnerId);
};

/** Finance gives an existing partner another key (e.g. a new campaign link). */
export const addKeyToPartner = async (params: { partnerId: string; key: unknown }): Promise<PartnerDetailResult> => {
  const key = normalizePartnerKey(params.key);

  if (!PARTNER_KEY_PATTERN.test(key)) {
    return fail('INVALID_KEY', 'key must be 3-40 lowercase letters, digits or hyphens');
  }

  const loaded = await getPartnerDetail(params.partnerId);

  if (!loaded.success) {
    return loaded;
  }

  try {
    await putPartnerKey({
      key,
      partnerId: loaded.partner.partnerId,
      email: loaded.partner.email,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    if (isConditionFailure(error)) {
      return fail('KEY_TAKEN', 'this key is already used');
    }

    throw error;
  }

  return getPartnerDetail(loaded.partner.partnerId);
};
