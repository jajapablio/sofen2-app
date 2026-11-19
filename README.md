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

The cashier's Cash, QRPH, and Card options are test simulations only. A server-created payment snapshot fixes the amount and expires after five minutes; only the authenticated confirmation RPC can record a sale and mark it Paid (Simulated). Run `supabase/qr_guest_payments.sql` after the payment simulator setup. New QR links include a signed capability in the URL fragment and can be scanned on another phone without login. They expire after five minutes and allow the customer to pay or cancel only that QR test payment. The service-role key remains server-only and also signs these links; rotating it invalidates outstanding links. The guest confirmation RPC is callable only by the service role and reuses atomic payment confirmation. Card mode accepts only `TEST-CARD-001` (success), `TEST-CARD-002` (declined), and `TEST-CARD-003` (insufficient simulated funds); no real card number, CVV, or banking credential is requested. QRPH sales are recorded using the existing `mobile_wallet` sale enum while the payment ledger retains `qrph`. Payment pages show Test mode and receipts are marked Test receipt. These records and the admin simulated-revenue dashboard are separate from real financial records. The current system has no order-management table, so `order_id` remains nullable and the completed `sale_id` is stored instead. The current schema does not store staff shifts or loyalty points. Forecast and purchase-order views remain empty until those tables contain real data.

### Payment Simulator Test Checklist

1. Sign in as a cashier, add in-stock products, and record a Cash simulation with enough tender; verify change and the printable demo receipt.
2. Select QRPH, create the QR, confirm the amount/reference and five-minute countdown, then scan the QR on a signed-out phone. Tap Pay now and verify Processing followed by Payment successful, and confirm the cashier polling updates automatically. Verify the success receipt and completed sale.
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

### Installable app (PWA)

Open the production HTTPS domain in Chrome or Edge and choose Install app (or the browser menu → Install app / Add to Home screen). The login page offers installation when the browser supports it. On iPhone/iPad, open the site in Safari → Share → Add to Home Screen. Installed launches open the login/home route in a standalone window.

The service worker caches only the offline page and public icons. Account pages, API calls, Supabase responses, inventory and payments are never cached by the service worker or queued for offline submission. Internet access is required for sales and payment processing. Installation availability depends on the browser; the development server does not register the worker.

### Purchase order approval

Purchase-order permission hardening is applied to the connected pos database. For other databases, run `supabase/purchase_order_approvals.sql` to replace permissive purchase-order policies with store-scoped reads/requests and admin-only approval. Managers create manual orders with `generated_by_ml=false`. Admin → Inventory lists the assigned store’s orders with Approve order actions and a pending navigation count. Both dashboards refresh order statuses every 15 seconds; approval does not receive stock or increase inventory.

### Password reset with EmailJS

Forgot Password opens a popup: registered email → Send code → Verify code → new password.
EmailJS delivers the email. The server generates an 8-digit code, stores only an HMAC
of the code, and verifies it in Postgres. Supabase Auth stores accounts and updates the
password only after successful verification; its recovery email service is not used.

#### One-time setup

1. Create an [EmailJS account](https://www.emailjs.com/) and connect an email service.
2. Create a template. Set **To Email** to `{{to_email}}`, use a subject such as
   `Your PredictPOS password reset code`, and copy the body from
   `supabase/templates/emailjs-password-reset.html`. Keep the recipient dynamic;
   do not set it to your own email address.
3. In EmailJS account security settings, enable requests from non-browser apps and
   require the private key for API requests. The app uses EmailJS's REST API from
   the server. Check your provider/account limits and email delivery configuration.
4. Set these **server-only** variables in `.env.local` and your deployment environment:
   `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`,
   `EMAILJS_PRIVATE_KEY`, and `PASSWORD_RESET_SECRET` (generate using
   `openssl rand -hex 32`). Never prefix these with `NEXT_PUBLIC_`. Existing
   `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are also required.
5. Apply `supabase/migrations/20261117080042_emailjs_password_reset.sql` to the
   app's existing Supabase database as the project owner. It creates new recovery
   tables in a private schema and service-role-only RPCs; existing sales/account
   tables are preserved. Do not run the empty base setup.sql on a new database.
6. Redeploy with the environment variables configured. This does not require
   changing Supabase's Reset Password email template.

Codes expire after 10 minutes and lock after 5 incorrect attempts. Verification
exchanges a code for a random, single-use reset token valid for up to 5 minutes.
Sending a new code invalidates the previous challenge for that email. The database
enforces a 60-second resend cooldown, 5 requests/hour per email, and 20/hour per IP.
On Vercel, the IP comes from Vercel's overwritten `x-vercel-forwarded-for` header.
Other production hosts use a shared bucket until a trusted proxy IP integration is
implemented; do not replace it with untrusted client headers.

Only existing, confirmed, non-banned Auth accounts receive codes; unknown emails
receive the same generic response and never create accounts. EmailJS delivery
failures also return a generic response to avoid revealing account existence; check
server logs and EmailJS delivery history when troubleshooting. Provider-wide EmailJS
quotas still apply. Supabase's configured password policy is enforced during update.
The reset token is held only in popup memory; closing the popup discards it. If the
password update fails after consuming a token, request a new code. No Auth session is
created by this flow, and existing login state in the browser is left intact.

#### Verification

Use a registered test account: request a code, confirm the recipient and 8-digit code,
reject an incorrect/expired code, verify the correct code, reject mismatched passwords,
set the new password, then sign in. Verify resending invalidates old codes, five failed
attempts lock the challenge, a used code/token cannot be replayed, and unknown emails
do not create accounts. Check EmailJS delivery failures, server rate limits, keyboard
focus/Escape, and mobile layout. Real email delivery requires the setup above.

Database regression checks are in `supabase/tests/password_reset.sql`; run them as
owner on a test database after applying the migration (for example,
`psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/password_reset.sql`).
The suite rolls back its temporary Auth account and recovery records.

### Signup email verification

Create Account now sends an EmailJS code and shows a verification screen. A successful
code verification is required before creating the Supabase Auth account, administrator
profile, store, and audit entry. Signup does not return a session. Existing accounts
are not re-verified or modified. This proves access to the mailbox; it does not test
whether a Gmail address is available for registration or prove a person's legal identity.
All valid email providers are supported.

Apply `supabase/migrations/20261119103732_signup_email_verification.sql` before deploying.
Create an EmailJS signup-verification template using
`supabase/templates/emailjs-signup-verification.html`, set **To Email** to `{{to_email}}`,
use a subject such as “Verify your PredictPOS email”, and set the server-only
`EMAILJS_SIGNUP_TEMPLATE_ID` in the deployment environment. It uses the existing
EmailJS service/keys and `PASSWORD_RESET_SECRET` with a separate signup HMAC namespace.
Never reuse a password-reset email body for signup. Do not expose secrets to the browser.

Codes expire after 10 minutes, allow 5 attempts, and are consumed once atomically.
Resending replaces the previous challenge. Signup requests are limited to one per
60 seconds, 5/hour per email, and 20/hour per trusted Vercel IP. Other production hosts
use a shared IP bucket until a trusted proxy integration is configured. Codes and
passwords are never saved in plaintext in the verification tables. Form values are
kept only in component memory while the verification screen is open. Refreshing or
editing signup details starts over. If account creation fails after proof is consumed,
request a fresh code. Provisioning the store, profile and audit is transactional.

Database regression checks: `supabase/tests/signup_verification.sql` on a test database.
Manual acceptance: submit signup → receive code → reject wrong code → verify correct
code → confirm one account/store → sign in. Also cover expiry, resend invalidation,
email mismatch, replay, request limits, duplicate username/email, delivery failure,
mobile layout and keyboard focus. Do not mark mailbox-delivery or live account-creation
tests as passed without exercising them with a dedicated test account.
