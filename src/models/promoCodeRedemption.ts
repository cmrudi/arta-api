// Validation only opens a redemption; nothing is spent yet. COMPLETED is what
// counts against a promo's maxUsage, so only the payment-success path may set
// it. Further states (expired, cancelled) get added here as they land.
export type PromoCodeRedemptionStatus = 'INITIATED' | 'COMPLETED';

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
