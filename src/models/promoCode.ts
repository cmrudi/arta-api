export type PromoCodeItem = {
  code: string;
  discountPercentage: number;
  maxPriceCut: number;
} & Record<string, unknown>;
