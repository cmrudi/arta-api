export type PromoCodeItem = {
  code: string;
  discountPercentage: number;
  /**
   * Cap on the order's total discount, in thousands of rupiah — the same unit
   * as ProductMapping.price (10 means Rp10.000).
   */
  maxPriceCut: number;
  /** Completed redemptions allowed across all customers; absent means no limit. */
  maxUsage?: number;
  /**
   * false switches the code off. Absent means active, so rows created before
   * this flag existed keep working.
   */
  isActive?: boolean;
  /** 'ADMIN' for codes made from arta-admin; absent on codes made by hand. */
  source?: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
} & Record<string, unknown>;

/** Auth0 role that may manage promo codes from arta-admin. */
export const PROMO_ADMIN_ROLE = 'finance';

// Limits on codes created from arta-admin. Codes outside them can still be
// written to the table by hand; the admin page just cannot make them.
export const ADMIN_MAX_DISCOUNT_PERCENTAGE = 30;
/** Rupiah. */
export const ADMIN_MAX_DISCOUNT_AMOUNT = 10000;

export const isPromoCodeActive = (promo: Pick<PromoCodeItem, 'isActive'>): boolean =>
  promo.isActive !== false;
