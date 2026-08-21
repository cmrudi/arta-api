// Validation only opens a redemption; nothing is spent yet. Later lifecycle
// states (redeemed on payment, expired, cancelled) get added here as they land.
export type PromoCodeRedemptionStatus = 'INITIATED';

export type PromoCodeRedemptionItem = {
  redemptionId: string;
  productCode: string;
  promoCode: string;
  email: string;
  price: number;
  priceCut: number;
  finalPrice: number;
  status: PromoCodeRedemptionStatus;
  createdAt: string;
};
