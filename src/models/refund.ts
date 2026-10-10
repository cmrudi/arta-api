/**
 * One customer refund request for one order.
 *
 * Partition key refundId. The `status-createdAt-index` GSI drives the admin
 * queue. The owning Order row carries `refundId` and `refundStatus` as a
 * mirror, so the eSIM detail page learns the state from one read and a second
 * request for the same order is rejected by a condition on that row.
 */
export type RefundItem = {
  refundId: string;
  orderId: string;
  SimId: string;
  iccid?: string;
  /** The buyer, from the Order row - never trusted from the client. */
  email: string;
  status: RefundStatus;
  /** Order.price at request time; what refundExecute records and Midtrans returns. */
  amount: number;
  paymentType?: string;
  provider?: string;
  regionCode?: string;
  reason: RefundReason;
  note?: string;
  source: 'CUSTOMER' | 'CS';
  /** Answer of refundEligibilityByOrderId when the request was made. */
  eligibilitySnapshot?: Record<string, unknown>;
  /** createdAt + REVIEW_SLA_HOURS - sorts the queue and drives the countdown. */
  deadlineAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectReason?: string;
  esimCancelledAt?: string;
  esimCancelResponse?: Record<string, unknown>;
  gatewayResponse?: Record<string, unknown>;
  refundedAt?: string;
  /** Set when CS returned the money outside Midtrans (e.g. a bank transfer order). */
  manualRefund?: boolean;
  lastError?: string;
  retryCount: number;
  events: RefundEvent[];
  createdAt: string;
  updatedAt: string;
};

export type RefundEvent = {
  at: string;
  status: RefundStatus;
  by?: string;
  note?: string;
};

/**
 * PENDING_REVIEW -> APPROVED -> ESIM_CANCELLED -> REFUNDED is the happy path.
 * APPROVED and ESIM_CANCELLED are transient: they only stay put when the
 * process stopped mid-way, which the admin sees as "Diproses".
 * ESIM_CANCEL_FAILED and REFUND_FAILED are "Perlu tindakan": CS retries, or
 * for REFUND_FAILED returns the money by hand and marks it done.
 */
export const REFUND_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'ESIM_CANCEL_FAILED',
  'ESIM_CANCELLED',
  'REFUND_FAILED',
  'REFUNDED',
  'REJECTED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const isRefundStatus = (value: unknown): value is RefundStatus =>
  typeof value === 'string' && (REFUND_STATUSES as readonly string[]).includes(value);

/** A refund in one of these blocks a new request and archiving the SIM. */
export const OPEN_REFUND_STATUSES: readonly RefundStatus[] = [
  'PENDING_REVIEW',
  'APPROVED',
  'ESIM_CANCEL_FAILED',
  'ESIM_CANCELLED',
  'REFUND_FAILED',
];

export const REFUND_REASONS = [
  'TRIP_CANCELLED',
  'WRONG_PACKAGE',
  'DEVICE_NOT_SUPPORTED',
  'OTHER',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const isRefundReason = (value: unknown): value is RefundReason =>
  typeof value === 'string' && (REFUND_REASONS as readonly string[]).includes(value);

export const REFUND_WINDOW_DAYS = 30;
export const REVIEW_SLA_HOURS = 72;
export const MAX_NOTE_LENGTH = 500;

/**
 * Auth0 role that may review refunds - the same "customer" role the admin app
 * gates its customer-service pages on.
 */
export const REFUND_REVIEWER_ROLE = 'customer';
