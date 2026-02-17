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

### Product Mappings (v2)

- `GET /v2/products`

### Regions (v2)

- `GET /v2/regions`

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
