import { randomBytes } from 'crypto';

/**
 * Affiliate partners.
 *
 * A partner is one person or business, identified by a `partnerId` that never
 * changes. Their login email and their affiliate keys (go.artamobile.id/<key>)
 * may change over time; the partnerId ties them together.
 *
 *   PartnerAccount  PK partnerId. Two kinds of rows:
 *                     "PTN-XXXXXXXX"   the account: email, name, timestamps
 *                     "EMAIL#<email>"  guard row pointing at the account that
 *                                      owns that login email. It makes an email
 *                                      unique (conditional put) and turns the
 *                                      login lookup into one GetItem.
 *   Partner         PK key (the affiliate key). One row per key, with the
 *                   owner's partnerId (GSI partnerId-index) and, for the old
 *                   Lambdas that still read it, the email at creation time.
 *                   A key is never deleted or given to someone else, so old
 *                   links and old orders keep pointing at the right partner.
 *
 * Orders store the key as `partner` (and, from now on, `partnerId`).
 */

export type PartnerAccount = {
  partnerId: string;
  email: string;
  name?: string;
  createdAt: string;
  updatedAt: string;
};

export type PartnerKey = {
  key: string;
  partnerId?: string;
  email?: string;
  createdAt?: string;
};

export const PARTNER_ID_PREFIX = 'PTN-';
export const EMAIL_GUARD_PREFIX = 'EMAIL#';

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

export const emailGuardId = (email: string): string => `${EMAIL_GUARD_PREFIX}${email}`;

/** What the portal allows: lowercase letters, digits and hyphens. */
export const PARTNER_KEY_PATTERN = /^[a-z0-9-]{3,40}$/;

export const normalizePartnerKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const normalizePartnerEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const PARTNER_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MAX_PARTNER_NAME_LENGTH = 100;
