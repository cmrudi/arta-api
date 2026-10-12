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
