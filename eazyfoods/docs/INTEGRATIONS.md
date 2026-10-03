# Integrations and credentials

Every external service sits behind a small provider interface selected by an environment variable. With no credentials the platform runs entirely in `dev` or `sandbox` mode, which is what the demo and the automated tests use.

| Capability | Variable | Default | Real provider | Status |
| --- | --- | --- | --- | --- |
| Card payments | `PAYMENT_PROVIDER` | `sandbox` | Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) | Sandbox is tested. The Stripe adapter is written but has **not** been run against Stripe. Live card entry in the checkout page needs Stripe's hosted fields wired in (see below). |
| Email | `EMAIL_PROVIDER` | `dev` (recorded in `message_outbox`) | SendGrid (`SENDGRID_API_KEY`) | Adapter written, untested. |
| SMS | `SMS_PROVIDER` | `dev` | Twilio (`TWILIO_*`) | Adapter written, untested. |
| Push | `PUSH_PROVIDER` | `dev` | Firebase (`FIREBASE_SERVER_KEY`) | Adapter written, untested. The web app does not yet register a service worker for push. |
| Geocoding and distance | `MAPS_PROVIDER` | `local` (postal prefix and city table, straight line distance with a road factor) | Google (`GOOGLE_MAPS_API_KEY`) or Mapbox (`MAPBOX_TOKEN`) | Adapters written, untested. |
| File storage | `STORAGE_PROVIDER` | `local` | S3 compatible | Local is tested. Add the S3 provider to `apps/api/src/lib/storage.ts`. |
| Analytics | `ANALYTICS_PROVIDER` | `internal` (events stored in Postgres) | Any external tool | Internal only. |

## Switching payments to Stripe

1. Set `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PUBLISHABLE_KEY`. `GET /api/config` then reports `payments.mode = "live"` and the checkout page stops showing test cards.
2. Replace the "live card entry" notice in `apps/web/src/components/checkout-flow.tsx` with Stripe Elements (or Payment Element). It must return a payment method id, which is what `POST /api/checkout` expects as `paymentToken`.
3. Point a Stripe webhook at the API and test refunds, declines and 3D Secure in Stripe's test mode before using live keys.
4. Review `captureLedger`, `payOrder` and `refundSuborder` in `apps/api/src/modules/orders` with your accountant. Provider calls currently run inside the database transaction that reserves stock; for high volume, move them out (authorise first, then commit) as noted in the limitations.
