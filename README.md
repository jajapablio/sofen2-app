PThis is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Supabase Setup

1. Back up the existing database and confirm the base PredictPOS schema is installed, including `profiles`, `stores`, `products`, `sales`, `sale_items`, the `payment_type` enum, and `record_sale_with_discount`. The checked-in `supabase/setup.sql` is empty in this workspace, so it cannot initialize a fresh database as-is.
2. Run [`supabase/void_sale.sql`](supabase/void_sale.sql) once in Supabase SQL Editor as the project owner. This enables audited voids, percentage discounts, and item-level refunds.
3. Run [`supabase/payment_simulator.sql`](supabase/payment_simulator.sql) as the project owner. It adds a separate demo-payment ledger, owner-only reads, atomic confirmation, and server-only admin metrics without changing existing sales tables.
4. Run `supabase/forecast_engine.sql` as the project owner. This creates the forecast tables, upgrades existing inventory forecasts, and installs the store-authorized generation function and shortage-alert view. Then copy `.env.example` to `.env.local` and fill in the Supabase project URL, anon/publishable key, and service-role key. The service-role key is used only by server API routes: never prefix it with `NEXT_PUBLIC_` or expose it to client code.
5. Use **Sign up** once to create the administrator and first store. This endpoint closes owner signup after any store exists. The first admin enters their full name, username, business/store name, email, and password.
6. The administrator signs in and opens the Staff section to add cashier and manager accounts. Employees can sign in with their username or email and are routed according to their `profiles.role`.
7. Add products to `public.products` with the store UUID. Set `stores.tax_rate` as a decimal fraction (for example, `0.0800` for 8%). Configure Supabase Auth's site URL and redirect allow-list for the app origin so password reset links work.

For an existing database that already has stores and administrator accounts, initial owner signup is intentionally closed. Promote the intended owner in SQL Editor after verifying the account:

```sql
UPDATE public.profiles
SET global_access = TRUE, role = 'admin'
WHERE username = 'your-owner-username';
```

The cashier's Cash, QRPH, and Card options are test simulations only. A server-created payment snapshot fixes the amount and expires after five minutes; only the authenticated confirmation RPC can record a sale and mark it Paid (Simulated). Run `supabase/qr_guest_payments.sql` after the payment simulator setup. New QR links include a signed capability in the URL fragment and can be scanned on another phone without login. They expire after five minutes and automatically confirm only that QR test payment. The service-role key remains server-only and also signs these links; rotating it invalidates outstanding links. The guest confirmation RPC is callable only by the service role and reuses atomic payment confirmation. Card mode accepts only `TEST-CARD-001` (success), `TEST-CARD-002` (declined), and `TEST-CARD-003` (insufficient simulated funds); no real card number, CVV, or banking credential is requested. QRPH sales are recorded using the existing `mobile_wallet` sale enum while the payment ledger retains `qrph`. Payment pages show Test mode and receipts are marked Test receipt. These records and the admin simulated-revenue dashboard are separate from real financial records. The current system has no order-management table, so `order_id` remains nullable and the completed `sale_id` is stored instead. The current schema does not store staff shifts or loyalty points. Forecast and purchase-order views remain empty until those tables contain real data.

### Payment Simulator Test Checklist

1. Sign in as a cashier, add in-stock products, and record a Cash simulation with enough tender; verify change and the printable demo receipt.
2. Select QRPH, create the QR, confirm the amount/reference and five-minute countdown, then scan the QR on a signed-out phone. Verify Processing followed by Payment successful, and confirm the cashier polling updates automatically. Verify the success receipt and completed sale.
3. Try each fictional card identifier. `TEST-CARD-001` should succeed; `TEST-CARD-002` and `TEST-CARD-003` should fail with their scenario messages and leave inventory unchanged.
4. Leave a QR payment pending until the five-minute expiry; verify the status becomes Expired and it cannot create a sale.
5. Submit the same confirmation twice; verify there is still only one sale and the second request returns the existing status.
6. Try an invalid payment ID and load another cashier's payment URL; both must be rejected. Confirm the admin tab can filter and export simulated transactions without changing sales reports.

The global admin dashboard uses the `global_access` profile flag and the RLS policies in `supabase/setup.sql`. It includes store-wide metrics, catalog management, CSV product import/export, staff account controls, supplier records, audit views, device heartbeats, and saved ML/auto-PO settings. Device and ML status remain unconfigured until those services write rows to `pos_devices` and `ml_engine_status`. Integration cards expose configured/not-configured state only; values stay in server environment variables. Cashier refund, discount, and void actions enforce the corresponding permission overrides and PIN approval rules.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

### Automated forecasts

`supabase/forecast_engine.sql` installs the `refresh-store-forecasts` Cron job at minute 5 of every hour and generates the initial forecasts. It runs in the database without an open browser. Monitor runs in Supabase → Integrations → Cron. The manager overview shows generation timestamps and offers an authorized manual refresh for the assigned store. Stores without completed sales wait for history instead of displaying invented demand. Sales estimates cover 14 days and inventory demand covers 7 days; confidence is a history-based heuristic, not a calibrated probability.

### Guest QR verification

Scan a freshly generated QR using the deployed HTTPS site. Test invalid, expired and canceled links, then scan/refresh a completed payment twice and verify only one sale and inventory deduction. Only the server-authenticated cashier can create or cancel payments. The guest endpoint accepts no amount, cart or user ID from the scanner. Existing QR codes without a signed token must be regenerated.
