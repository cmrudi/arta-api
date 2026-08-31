/**
 * One piece of customer feedback about one SIM.
 *
 * Partition key SimId, sort key kind - a customer can answer both the install
 * question and the service question for the same SIM without one overwriting
 * the other.
 */
export type SimReviewItem = {
  SimId: string;
  kind: ReviewKind;
  /** 1-5. INSTALL rates the setup process, SERVICE rates the connection. */
  rating: number;
  /** Optional structured diagnosis. Not collected by the app today. */
  reason?: string;
  comment?: string;
  /** Derived server-side from the SIMCards row, never trusted from the client. */
  email: string;
  iccid?: string;
  orderId?: string;
  regionCode?: string;
  provider?: string;
  /** SIM lifecycle and install stage at the moment the answer was given. */
  simStatus?: string;
  smdpStatus?: string;
  createdAt: string;
  updatedAt?: string;
};

/** SERVICE = how was the connection. INSTALL = how was the setup process. */
export const REVIEW_KINDS = ['SERVICE', 'INSTALL'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export const isReviewKind = (value: unknown): value is ReviewKind =>
  typeof value === 'string' && (REVIEW_KINDS as readonly string[]).includes(value);

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_COMMENT_LENGTH = 1000;

/**
 * Diagnoses offered for a poor answer. Closed sets so the results are
 * countable - free text alone cannot tell you whether a region has a supplier
 * problem or an install problem.
 */
export const SERVICE_REASONS = [
  'SINYAL_LEMAH',
  'INTERNET_LAMBAT',
  'SUSAH_AKTIVASI',
  'KUOTA_CEPAT_HABIS',
  'LAINNYA',
] as const;

export const INSTALL_REASONS = [
  'QR_TIDAK_TERBACA',
  'HP_TIDAK_MENDUKUNG',
  'GAGAL_SAAT_PASANG',
  'TIDAK_TAHU_CARANYA',
  'BELUM_DICOBA',
  'LAINNYA',
] as const;

export type ServiceReason = (typeof SERVICE_REASONS)[number];
export type InstallReason = (typeof INSTALL_REASONS)[number];

export const reasonsFor = (kind: ReviewKind): readonly string[] =>
  kind === 'INSTALL' ? INSTALL_REASONS : SERVICE_REASONS;

export const isValidReason = (kind: ReviewKind, value: unknown): boolean =>
  typeof value === 'string' && reasonsFor(kind).includes(value);
