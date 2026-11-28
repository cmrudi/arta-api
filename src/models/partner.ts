import { randomBytes } from 'crypto';

/**
 * Affiliate partners.
 *
 * A partner is one person or business, identified by a `partnerId` that never
 * changes. Everything about them is one row in PartnerAccount:
 *
 *   PartnerAccount  PK partnerId ("PTN-XXXXXXXX")
 *                   email         login email          GSI email-index
 *                   key           affiliate key        GSI key-index
 *                                 (go.artamobile.id/<key>), one per partner
 *                   previousKeys  keys they used before (history only)
 *                   name, createdAt, updatedAt
 *
 * DynamoDB cannot make an indexed value unique, so one account per email and
 * per key is kept by checking the index before writing and re-checking about a
 * second later (see partnerService); if two accounts ever share an email or a
 * key, the oldest one wins.
 *
 * Orders store the key they came through (`partner`) and the owner's
 * `partnerId` (GSI partnerId-createdAt-index). A partner's sales are listed by
 * partnerId, so they stay credited after the key or email changes. A key the
 * partner no longer uses stops crediting new sales.
 */

export type PartnerAccount = {
  partnerId: string;
  email: string;
  key: string;
  previousKeys?: string[];
  name?: string;
  /** Commission tier: picks the PartnerCommission rows (partnerType) for this partner. */
  partnerType: number;
  createdAt: string;
  updatedAt: string;
};

/** Every partner starts on type 0 (the standard commission table). */
export const DEFAULT_PARTNER_TYPE = 0;

/** Partner types that exist (labels live in arta-admin: 0 Umum, 1 Travel Umrah). */
export const PARTNER_TYPES: readonly number[] = [0, 1];

export const PARTNER_ID_PREFIX = 'PTN-';

// Crockford base32: no I, L, O or U, so an ID read aloud or typed by finance
// cannot be confused.
const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const newPartnerId = (): string => {
  const bytes = randomBytes(8);

  return PARTNER_ID_PREFIX + Array.from(bytes, (byte) => ID_ALPHABET[byte % 32]).join('');
};

export const PARTNER_ID_PATTERN = /^PTN-[0-9A-Z]{8}$/;

export const isPartnerId = (value: unknown): value is string =>
  typeof value === 'string' && PARTNER_ID_PATTERN.test(value);

/** What the portal allows: lowercase letters, digits and hyphens. */
export const PARTNER_KEY_PATTERN = /^[a-z0-9-]{3,40}$/;

export const normalizePartnerKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const normalizePartnerEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const PARTNER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_PARTNER_NAME_LENGTH = 100;

/**
 * Auth0 roles that may list partner accounts from arta-admin: finance, and
 * customer service ("customer") read-only. Changing a partner stays finance-only.
 */
export const PARTNER_LIST_ROLES = ['finance', 'customer'] as const;
