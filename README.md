# arta-api

TypeScript backend API with Express and DynamoDB.

## Tech Stack

- Node.js + TypeScript
- Express
- AWS SDK v3 (DynamoDB)
- Lambda adapter: `@vendia/serverless-express`

## Project Structure

- `src/app.ts` - Express app setup
- `src/server.ts` - local server entrypoint
- `src/lambda.ts` - Lambda handler entrypoint
- `src/routes/v2/orders.ts` - v2 route
- `src/controllers/v2/ordersController.ts` - controller layer
- `src/services/orderService.ts` - DynamoDB access layer

## Environment Variables

Create `.env` in project root:

```env
PORT=3000
AWS_REGION=ap-southeast-1
ORDERS_TABLE_NAME=Order
ORDER_DATE_ATTRIBUTE=createdAt
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
MIDTRANS_STATUS_BASE_URL=https://api.midtrans.com/v2
MIDTRANS_AUTHORIZATION=Basic TWlkLXNlcnZlci02MzhUb3NIcFVHY2ticldSeFdGcS1RcWU6
AUTH0_DOMAIN=
AUTH0_ISSUER_BASE_URL=
AUTH0_AUDIENCE=
AUTH0_OAUTH_BASE_URL=https://artamobile.us.auth0.com
ESIM_ACCESS_CODE=
ESIM_ACCESS_BASE_URL=https://api.esimaccess.com
```

## Run Locally

```bash
npm install
npm run dev
```

Server starts at:

- `http://localhost:3000`

## API Endpoints

### Health Check

- `GET /health`

### Partner Orders (v2)

- `GET /v2/partner/orders?startDate=<ISO_DATE>&endDate=<ISO_DATE>`

Example:

```bash
curl "http://localhost:3000/v2/partner/orders?startDate=2026-02-01T00:00:00.000Z&endDate=2026-02-13T23:59:59.999Z"
```

### In Progress Orders (v2)

- `GET /v2/orders/in-progress?startDate=<ISO_DATE>&endDate=<ISO_DATE>`

In Progress order criteria:

- `status` is NOT `PAYMENT_EXPIRED`
- `status` is NOT `TOP_UP_COMPLETED`
- `status` is NOT `ESIM_PUBLISHED`

Example:

```bash
curl "http://localhost:3000/v2/orders/in-progress?startDate=2026-02-01T00:00:00.000Z&endDate=2026-02-13T23:59:59.999Z"
```

### Force Refund (v2)

- `POST /v2/refund/force`

Request body:

```json
{
	"orderId": "f2c6f049-000a-4a9b-be3d-362997446e5b",
	"amount": 10000
}
```

Rules:

- `orderId` must exist in `Order` table
- `amount` must be `<= order.price`
- update sets `refund = amount` and `forceRefund = true`

### Order Recovery (v2)

- `POST /v2/order/recovery`

Request body:

```json
{
	"orderId": "1cb368c3-c8e7-4440-9c3b-e2f2fc3ba5d2"
}
```

Rules:

- only process order with `status = CREATED`
- call Midtrans status API for the `orderId`
- when `transaction_status = settlement`:
	- update Order status to `PAID`
	- invoke one Lambda asynchronously based on order type + provider

### Partners (v2)

A partner is identified by a `partnerId` (`PTN-` + 8 characters, e.g.
`PTN-7K2M9QXA`) that never changes. Everything about them is one row in
`PartnerAccount`: login `email`, affiliate `key` (`go.artamobile.id/<key>`, one
per partner), `previousKeys` (history), `name`. Orders store the key they came
through (`Order.partner`) and the owner's `partnerId`; a partner's sales are
listed by `partnerId`, so they stay credited after the key or email changes.

Partner routes (the partner portal's Auth0 token; the account is the one for
the token's email, never one named in the request):

- `GET /v2/partner/keys/:key/exists` - public; `{ "exist": true | false }`
- `POST /v2/partner/register` - `{ "key": "budi" }`. Creates the account. 409 `KEY_TAKEN`, or `ALREADY_REGISTERED` when the email already has an account.
- `GET /v2/partner/me` - the account
- `GET /v2/partner/me/orders` - the partner's paid eSIM orders, newest first (customer masked, commission as `price`). 404 `Partner not found` when the email has no account.

Finance routes (arta-admin token with the `finance` role):

- `GET /v2/admin/partners` - every partner
- `GET /v2/admin/partners/:partnerId`
- `PATCH /v2/admin/partners/:partnerId` - `{ "email": "new@example.com", "key": "budi-baru", "name": "Budi" }` (any of them). A new key credits sales from then on; the old one moves to `previousKeys` and stops crediting new sales. 409 `EMAIL_TAKEN` / `KEY_TAKEN`.

DynamoDB:

| Table | Key | Global secondary indexes |
|---|---|---|
| `PartnerAccount` | `partnerId` (S) | `email-index`: `email` (S); `key-index`: `key` (S); projection ALL |
| `Order` (existing) | `orderId` (S) | adds `partnerId-createdAt-index`: `partnerId` (S) + `createdAt` (S), projection ALL |

DynamoDB cannot make an indexed value unique, so one account per email and per
key is kept by checking the index before writing and re-checking about a second
later (`PARTNER_RECHECK_DELAY_MS`, default 1000); a clashing account created in
parallel deletes itself. Should a duplicate ever remain, the oldest account wins
and `GET /v2/admin/partners` flags it (`duplicateEmail` / `duplicateKey`).

### Partner Payouts (v2)

Semi-automated payouts for affiliate partners. Finance credits each partner's
balance by hand (from the profit-sharing sheet); the partner requests a
withdrawal in the partner portal; finance transfers the money by bank and marks
it paid with the transfer reference. Every balance change is a ledger entry, and
the wallet, ledger and withdrawal rows are always written in one transaction.

Lifecycle: `PENDING_REVIEW` → `APPROVED` → `PAID`. `PENDING_REVIEW` can go
straight to `PAID`. `PENDING_REVIEW`/`APPROVED` → `REJECTED`, or the partner
cancels while `PENDING_REVIEW` (`CANCELLED`); both return the amount to the
balance. A partner has at most one open withdrawal.

Partner routes (the portal's own Auth0 token; the wallet is the one for the
token's email claim):

- `GET /v2/partner/wallet` - balance, amount on hold, minimum, open withdrawal, history (404 `PARTNER_NOT_FOUND` when the login email has no partner account)
- `POST /v2/partner/withdrawals` - `{ "amount": 750000, "bankAccount": { "bankName": "BCA", "accountNumber": "1234567890", "accountName": "Budi Santoso" }, "note": "optional" }`
- `POST /v2/partner/withdrawals/:withdrawalId/cancel`

Finance routes (arta-admin access token with the Auth0 `finance` role):

- `GET /v2/admin/partner-wallets`
- `GET /v2/admin/partner-wallets/:partnerId` - wallet with ledger and withdrawals
- `POST /v2/admin/partner-wallets/adjustments` - `{ "partnerId": "PTN-7K2M9QXA", "type": "CREDIT" | "DEBIT", "amount": 750000, "note": "Komisi Oktober 2026", "entryId": "<uuid>", "partnerKey": "budi", "partnerName": "Budi" }`. `email` (the partner's login email) may be given instead of `partnerId`. `entryId` makes a retried submit a no-op (409 `DUPLICATE_ENTRY`); the first credit creates the wallet.
- `GET /v2/admin/partner-withdrawals?status=PENDING_REVIEW,APPROVED` (default: open ones)
- `GET /v2/admin/partner-withdrawals/:withdrawalId`
- `POST /v2/admin/partner-withdrawals/:withdrawalId/approve`
- `POST /v2/admin/partner-withdrawals/:withdrawalId/reject` - `{ "reason": "..." }` (sent to the partner)
- `POST /v2/admin/partner-withdrawals/:withdrawalId/pay` - `{ "transferReference": "...", "note": "optional" }`

DynamoDB tables (on-demand capacity is fine):

| Table | Key | Global secondary indexes |
|---|---|---|
| `PartnerWallet` | `partnerId` (S) | - |
| `PartnerLedger` | `entryId` (S) | `partnerId-createdAt-index`: `partnerId` (S) + `createdAt` (S), projection ALL |
| `PartnerWithdrawal` | `withdrawalId` (S) | `status-createdAt-index`: `status` (S) + `createdAt` (S); `partnerId-createdAt-index`: `partnerId` (S) + `createdAt` (S); both projection ALL |

Every row also stores the partner's email at the time, for emails and for
finance to read; the partnerId is what links them.

The Lambda role needs `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query`,
`Scan` and `TransactWriteItems` on these tables, `PartnerAccount` and their
indexes, plus `Query` on `Order/index/partnerId-createdAt-index`.

Environment:

- `PARTNER_MIN_WITHDRAWAL` - minimum withdrawal in IDR (default `500000`)
- `BREVO_PARTNER_PAYOUT_TEMPLATE_ID`, `PARTNER_PAYOUT_OPS_EMAIL`, `PARTNER_PORTAL_URL` - see `templates/brevo/README.md`

### Product Mappings (v2)

- `GET /v2/products`

### Regions (v2)

- `GET /v2/regions`

### Distributor Wallet Balance (v2)

- `GET /v2/dist/wallet/balance`
- Requires header: `Authorization: Bearer <access_token>`

Example:

```bash
curl --request GET 'http://localhost:3000/v2/dist/wallet/balance' \
	--header 'authorization: Bearer <Your Access Token>'
```

### Distributor OAuth Token (v2)

- `POST /v2/dist/oauth/token`

Request body:

```json
{
	"clientId": "udROWCnxvYWR5NIZI92cM95k5NI4fCPp",
	"clientSecret": "LPnCzJzG-BwW4oHaxVggrpmbLG57R24XfRIxEWXDdDcDqQ7mutZM0aXIj179sztp"
}
```

## Scripts

- `npm run dev` - run in watch mode
- `npm run typecheck` - TypeScript type check
- `npm run build` - build to `dist`
- `npm start` - run compiled build

## Deploy to AWS Lambda (GitHub Actions)

Workflow file:

- `.github/workflows/deploy-lambda.yml`

Required GitHub repository secrets:

- `AWS_ROLE_TO_ASSUME`
- `AWS_REGION`
- `AWS_LAMBDA_FUNCTION_NAME`

Lambda configuration:

- Handler: `dist/lambda.handler`
- Runtime: `nodejs20.x`

## Notes

- Current DynamoDB read uses `Scan` with date-range filter + `partner` existence filter.
- For better performance at scale, migrate to `Query` with proper key/index design.
