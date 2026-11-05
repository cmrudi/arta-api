# Brevo template — refund emails

One transactional template covers every refund email sent by
`src/services/refundEmailService.ts`.

**Live in Brevo as template 12 "Refund Update"** (sender Arta Mobile
<contact@artamobile.id>, subject `{{ params.subject }}`, tag `refund`). Edit the
copy in Brevo; keep this file in step if you change the structure.

1. In Brevo: Templates → New template → paste `refund-update.html`, using the
   same sender as the eSIM delivery email (template 1).
2. Set the template's subject to `{{ params.subject }}`.
3. Put the template's ID on the `arta-api` Lambda as `BREVO_REFUND_TEMPLATE_ID`.

While the variable is unset, refunds work as normal and the emails are skipped
(logged as `[refundEmail] template not configured`).

## When it is sent

| `params.kind` | Flag set to true | When | Subject sent |
|---|---|---|---|
| `RECEIVED` | `isReceived` | customer submits a refund | Pengajuan refund REF-… diterima |
| `REJECTED` | `isRejected` | CS rejects it | Pengajuan refund REF-… ditolak |
| `COMPLETED` | `isCompleted` | money returned (Midtrans or manual) | Refund REF-… selesai |

The template branches on the three boolean flags rather than comparing
`params.kind`, so it needs nothing beyond `{% if %}` in Brevo's template language.

## Params

| Param | Example |
|---|---|
| `subject` | Pengajuan refund REF-1A2B3C4D diterima |
| `refundId` | REF-1A2B3C4D |
| `region` | Jepang |
| `iccid` | 8985… |
| `amount` | Rp 75.000 |
| `paymentMethod` | QRIS |
| `requestedAt` | 10 Oktober 2026 pukul 10.12 (WIB) |
| `reviewSla` | 3×24 jam |
| `rejectReason` | set when rejected |
| `refundedAt` | set when completed |
| `manualRefund` | `true` when CS returned the money by hand |
| `statusUrl` | https://shop.artamobile.id/sim/{SimId}/refund/status |
| `csUrl` | WhatsApp CS link |

Optional overrides on the Lambda: `SHOP_BASE_URL` (default
`https://shop.artamobile.id`) and `WA_CS_LINK`.

---

# Brevo template — partner payout emails

One transactional template covers every withdrawal email sent by
`src/services/partnerPayoutEmailService.ts`.

1. In Brevo: Templates → New template → paste `partner-payout-update.html`,
   using the same sender as the refund template.
2. Set the template's subject to `{{ params.subject }}`.
3. Put the template's ID on the `arta-api` Lambda as
   `BREVO_PARTNER_PAYOUT_TEMPLATE_ID`.
4. Optional: set `PARTNER_PAYOUT_OPS_EMAIL` to the finance inbox. It gets a copy
   of every `REQUESTED` email, so finance hears about new requests.

While the template variable is unset, withdrawals work as normal and the emails
are skipped (logged as `[partnerPayoutEmail] template not configured`).

## When it is sent

| `params.kind` | Flag set to true | When | Subject sent |
|---|---|---|---|
| `REQUESTED` | `isRequested` | partner submits a withdrawal | Pengajuan pencairan WD-… diterima |
| `PAID` | `isPaid` | finance marks it transferred | Pencairan WD-… sudah ditransfer |
| `REJECTED` | `isRejected` | finance rejects it | Pengajuan pencairan WD-… ditolak |

## Params

| Param | Example |
|---|---|
| `subject` | Pengajuan pencairan WD-1A2B3C4D diterima |
| `withdrawalId` | WD-1A2B3C4D |
| `partnerEmail` / `partnerKey` | budi@example.com / budi |
| `amount` | Rp 750.000 |
| `bankName` / `accountNumber` / `accountName` | BCA / •••• 7890 / Budi Santoso |
| `requestedAt` | 5 November 2026 pukul 10.12 |
| `paidAt` / `transferReference` | set when paid |
| `rejectReason` | set when rejected |
| `portalUrl` | `${PARTNER_PORTAL_URL}/dashboard?tab=withdrawal` |
| `csUrl` | WhatsApp link (`WA_CS_LINK`) |

Optional overrides on the Lambda: `PARTNER_PORTAL_URL` (default
`https://partner.artamobile.id`) and `WA_CS_LINK`.
