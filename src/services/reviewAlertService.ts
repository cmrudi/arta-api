import { getRegionByCode } from '../lib/dynamoDb';
import { SimReviewItem } from '../models/simReview';
import { sendBrevoHtmlEmail } from './brevoService';

/** Ops inbox that hears about unhappy customers (same as the internal order confirmations). */
const LOW_REVIEW_ALERT_RECIPIENT = 'infinityroamservice@gmail.com';

/** 1 and 2 stars count as unhappy. */
export const LOW_REVIEW_MAX_RATING = 2;

const KIND_LABELS: Record<string, string> = {
  SERVICE: 'Koneksi (Connection)',
  INSTALL: 'Pemasangan (Installation)',
};

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatWib = (iso: string): string =>
  new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' WIB';

/**
 * Should this save alert ops? Only when the review becomes 1-2 stars: a new
 * low review, or an existing one lowered from 3+. Re-saving a review that was
 * already low does not send a second email.
 */
export const shouldAlertLowReview = (rating: number, previousRating?: unknown): boolean => {
  if (rating > LOW_REVIEW_MAX_RATING) return false;
  const previous = Number(previousRating);
  return !Number.isFinite(previous) || previous > LOW_REVIEW_MAX_RATING;
};

/** Email ops about a 1-2 star review. The customer's address is the reply-to. */
export const sendLowReviewAlert = async (review: SimReviewItem): Promise<void> => {
  let regionName = review.regionCode || '-';

  if (review.regionCode) {
    try {
      const region = await getRegionByCode(review.regionCode);
      if (region.Item?.name) regionName = `${String(region.Item.name)} (${review.regionCode})`;
    } catch {
      // the code alone is fine
    }
  }

  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  const kind = KIND_LABELS[review.kind] || review.kind;
  const row = (label: string, value: unknown) =>
    value === undefined || value === null || value === ''
      ? ''
      : `<tr><td style="padding:6px 12px;color:#595959;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 12px;">${escapeHtml(value)}</td></tr>`;

  const htmlContent = `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#fafafa;font-family:Arial,sans-serif;color:#1f1f1f;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #f0f0f0;border-radius:12px;">
<tr><td style="padding:20px 20px 8px;">
<div style="font-size:13px;color:#a8071a;font-weight:700;">REVIEW ${review.rating} BINTANG</div>
<h1 style="margin:6px 0 4px;font-size:20px;">${escapeHtml(kind)} · ${escapeHtml(regionName)}</h1>
<div style="font-size:22px;color:#faad14;letter-spacing:2px;">${stars}</div>
</td></tr>
<tr><td style="padding:8px 20px;">
<div style="background:#fff1f0;border:1px solid #ffccc7;border-radius:10px;padding:12px 14px;font-size:14px;line-height:22px;">
${review.comment ? escapeHtml(review.comment).replace(/\n/g, '<br>') : '<span style="color:#8c8c8c;">(tanpa komentar)</span>'}
</div></td></tr>
<tr><td style="padding:8px 8px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
${row('Waktu', formatWib(review.updatedAt || review.createdAt))}
${row('Pelanggan', review.email)}
${row('ICCID', review.iccid)}
${row('Order', review.orderId)}
${row('Provider', review.provider)}
${row('Status SIM', [review.simStatus, review.smdpStatus].filter(Boolean).join(' · '))}
${row('Alasan', review.reason)}
${row('SimId', review.SimId)}
</table></td></tr>
<tr><td style="padding:0 20px 20px;">
<a href="https://arta-admin.lovable.app/dashboard/reviews" style="display:inline-block;background:#237804;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:10px 16px;border-radius:8px;">Buka Customer Reviews</a>
<a href="https://shop.artamobile.id/sim/${encodeURIComponent(review.SimId)}" style="display:inline-block;margin-left:8px;color:#237804;font-weight:700;font-size:14px;padding:10px 4px;">Lihat halaman SIM</a>
</td></tr>
</table></body></html>`;

  await sendBrevoHtmlEmail({
    to: LOW_REVIEW_ALERT_RECIPIENT,
    subject: `[Review ${review.rating}★] ${kind} – ${regionName} – ${review.email || 'pelanggan'}`,
    htmlContent,
    replyTo: review.email || undefined,
    tags: ['low-review-alert'],
  });
};
