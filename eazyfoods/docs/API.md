# API overview

All endpoints live under `/api`, accept and return JSON, and use the session cookie (or a Bearer token). Errors have the shape `{ "error": { "code", "message", "details" } }` with a stable `code` and a message that is safe to show to a person. Writes from a browser must send `x-requested-with: ezweb`.

Money values in responses are decimal dollars. Dates are ISO 8601 in UTC.

Run `npm run dev:api` and read the route files in `apps/api/src/routes` for exact request schemas: every route validates its body with a zod schema defined next to the handler.


## Accounts and sessions

`auth.ts` mounted at `/api/auth`

| Method | Path |
| --- | --- |
| POST | `/api/auth/register` |
| POST | `/api/auth/register/vendor` |
| POST | `/api/auth/register/chef` |
| POST | `/api/auth/register/driver` |
| POST | `/api/auth/apply/vendor` |
| POST | `/api/auth/apply/driver` |
| POST | `/api/auth/login` |
| POST | `/api/auth/logout` |
| GET | `/api/auth/me` |
| PATCH | `/api/auth/me` |
| POST | `/api/auth/password/forgot` |
| POST | `/api/auth/password/reset` |
| POST | `/api/auth/password/change` |
| DELETE | `/api/auth/me` |
| GET | `/api/auth/sessions` |
| DELETE | `/api/auth/sessions/:id` |

## Catalogue, search, stores, content, ads, delivery check

`public.ts` mounted at `/api`

| Method | Path |
| --- | --- |
| GET | `/api/products` |
| GET | `/api/products/facets` |
| GET | `/api/products/autocomplete` |
| GET | `/api/products/:slug` |
| GET | `/api/products/:slug/recommendations` |
| GET | `/api/recommendations` |
| GET | `/api/categories` |
| GET | `/api/cuisines` |
| GET | `/api/stores` |
| GET | `/api/chefs` |
| GET | `/api/stores/:slug` |
| GET | `/api/chefs/:slug` |
| GET | `/api/home` |
| GET | `/api/articles` |
| GET | `/api/articles/:slug` |
| GET | `/api/collections/:slug` |
| GET | `/api/ads` |
| POST | `/api/ads/:id/impression` |
| GET | `/api/ads/:id/click` |
| POST | `/api/events` |
| POST | `/api/locate` |
| GET | `/api/delivery/check` |
| GET | `/api/config` |
| GET | `/api/seo/sitemap` |

## Customer cart, checkout, orders, account

`customer.ts` mounted at `/api`

| Method | Path |
| --- | --- |
| GET | `/api/carts/current` |
| POST | `/api/carts/items` |
| PATCH | `/api/carts/items/:variantId` |
| DELETE | `/api/carts/items/:variantId` |
| DELETE | `/api/carts/current` |
| PATCH | `/api/carts/options` |
| POST | `/api/carts/quote` |
| POST | `/api/checkout` |
| POST | `/api/orders/:id/pay` |
| GET | `/api/orders` |
| GET | `/api/orders/:id` |
| POST | `/api/orders/:id/cancel` |
| POST | `/api/orders/:id/reorder` |
| GET | `/api/customers/me/addresses` |
| POST | `/api/customers/me/addresses` |
| PUT | `/api/customers/me/addresses/:id` |
| DELETE | `/api/customers/me/addresses/:id` |
| GET | `/api/customers/me/favorites` |
| PUT | `/api/customers/me/favorites` |
| GET | `/api/customers/me/wishlists` |
| POST | `/api/customers/me/wishlists` |
| PUT | `/api/customers/me/wishlists/:id/items` |
| DELETE | `/api/customers/me/wishlists/:id` |
| POST | `/api/reviews` |
| GET | `/api/customers/me/reviews` |
| GET | `/api/notifications` |
| POST | `/api/notifications/read` |
| GET | `/api/notifications/preferences` |
| PUT | `/api/notifications/preferences` |
| POST | `/api/notifications/push-token` |
| GET | `/api/customers/me/loyalty` |
| POST | `/api/customers/me/loyalty/redeem` |
| GET | `/api/customers/me/coupons` |
| GET | `/api/customers/me/insights` |
| GET | `/api/customers/me/recently-viewed` |

## Tickets, disputes and order messages

`support.ts` mounted at `/api`

| Method | Path |
| --- | --- |
| GET | `/api/tickets` |
| POST | `/api/tickets` |
| GET | `/api/tickets/:id` |
| POST | `/api/tickets/:id/messages` |
| PATCH | `/api/tickets/:id` |
| GET | `/api/support/agents` |
| GET | `/api/suborders/:id/messages` |
| POST | `/api/suborders/:id/messages` |
| POST | `/api/suborders/:id/dispute` |
| GET | `/api/disputes` |
| GET | `/api/disputes/:id` |
| POST | `/api/disputes/:id/resolve` |

## Vendor and chef portal (all routes are under /api/vendors/:vendorId)

`vendor.ts` mounted at `/api/vendors`

| Method | Path |
| --- | --- |
| GET | `/api/vendors/:vendorId/manage` |
| PATCH | `/api/vendors/:vendorId/manage` |
| POST | `/api/vendors/:vendorId/submit` |
| PUT | `/api/vendors/:vendorId/hours` |
| POST | `/api/vendors/:vendorId/holidays` |
| DELETE | `/api/vendors/:vendorId/holidays/:day` |
| POST | `/api/vendors/:vendorId/documents` |
| PUT | `/api/vendors/:vendorId/chef` |
| GET | `/api/vendors/:vendorId/chef/capacity` |
| POST | `/api/vendors/:vendorId/chef/blackouts` |
| DELETE | `/api/vendors/:vendorId/chef/blackouts/:bid` |
| GET | `/api/vendors/:vendorId/zones` |
| POST | `/api/vendors/:vendorId/zones` |
| PUT | `/api/vendors/:vendorId/zones/:zoneId` |
| DELETE | `/api/vendors/:vendorId/zones/:zoneId` |
| GET | `/api/vendors/:vendorId/products` |
| POST | `/api/vendors/:vendorId/products` |
| GET | `/api/vendors/:vendorId/products/:productId` |
| PUT | `/api/vendors/:vendorId/products/:productId` |
| DELETE | `/api/vendors/:vendorId/products/:productId` |
| GET | `/api/vendors/:vendorId/labels` |
| GET | `/api/vendors/:vendorId/inventory` |
| GET | `/api/vendors/:vendorId/inventory/lookup` |
| POST | `/api/vendors/:vendorId/inventory/adjust` |
| PATCH | `/api/vendors/:vendorId/inventory/:variantId` |
| GET | `/api/vendors/:vendorId/inventory/:variantId/movements` |
| GET | `/api/vendors/:vendorId/orders` |
| GET | `/api/vendors/:vendorId/orders/:suborderId` |
| POST | `/api/vendors/:vendorId/orders/:suborderId/accept` |
| POST | `/api/vendors/:vendorId/orders/:suborderId/prepare` |
| POST | `/api/vendors/:vendorId/orders/:suborderId/ready` |
| POST | `/api/vendors/:vendorId/orders/:suborderId/reject` |
| POST | `/api/vendors/:vendorId/orders/:suborderId/cancel` |
| POST | `/api/vendors/:vendorId/orders/:suborderId/collect` |
| POST | `/api/vendors/:vendorId/orders/:suborderId/delivery` |
| GET | `/api/vendors/:vendorId/promotions` |
| POST | `/api/vendors/:vendorId/promotions` |
| PUT | `/api/vendors/:vendorId/promotions/:promoId` |
| GET | `/api/vendors/:vendorId/promotions/:promoId/stats` |
| GET | `/api/vendors/:vendorId/payouts` |
| GET | `/api/vendors/:vendorId/payouts/:payoutId` |
| GET | `/api/vendors/:vendorId/analytics` |
| GET | `/api/vendors/:vendorId/reviews` |
| POST | `/api/vendors/:vendorId/reviews/:reviewId/respond` |
| GET | `/api/vendors/:vendorId/disputes` |
| POST | `/api/vendors/:vendorId/disputes/:disputeId/respond` |
| POST | `/api/vendors/:vendorId/team` |
| DELETE | `/api/vendors/:vendorId/team/:userId` |
| GET | `/api/vendors/:vendorId/ingredients` |
| POST | `/api/vendors/:vendorId/ingredients` |
| PUT | `/api/vendors/:vendorId/ingredients/:ingredientId` |
| GET | `/api/vendors/:vendorId/recipes` |
| POST | `/api/vendors/:vendorId/recipes` |
| PUT | `/api/vendors/:vendorId/recipes/:recipeId` |
| GET | `/api/vendors/:vendorId/recipes/:recipeId` |
| POST | `/api/vendors/:vendorId/recipes/:recipeId/plan` |

## Driver app

`driver.ts` mounted at `/api/drivers`

| Method | Path |
| --- | --- |
| GET | `/api/drivers/me` |
| PATCH | `/api/drivers/me` |
| POST | `/api/drivers/me/vehicles` |
| POST | `/api/drivers/me/documents` |
| POST | `/api/drivers/me/submit` |
| POST | `/api/drivers/me/availability` |
| POST | `/api/drivers/me/location` |
| GET | `/api/drivers/me/offers` |
| POST | `/api/drivers/me/offers/:jobId/accept` |
| POST | `/api/drivers/me/offers/:jobId/reject` |
| GET | `/api/drivers/me/jobs` |
| POST | `/api/drivers/me/jobs/:jobId/arrived` |
| POST | `/api/drivers/me/jobs/:jobId/pickup` |
| POST | `/api/drivers/me/jobs/:jobId/start` |
| POST | `/api/drivers/me/jobs/:jobId/deliver` |
| POST | `/api/drivers/me/jobs/:jobId/issue` |
| GET | `/api/drivers/me/jobs/:jobId/messages` |
| POST | `/api/drivers/me/jobs/:jobId/messages` |
| GET | `/api/drivers/me/earnings` |

## Marketing portal

`marketing.ts` mounted at `/api/marketing`

| Method | Path |
| --- | --- |
| GET | `/api/marketing/overview` |
| GET | `/api/marketing/promotions` |
| POST | `/api/marketing/promotions` |
| PUT | `/api/marketing/promotions/:id` |
| GET | `/api/marketing/promotions/:id/stats` |
| GET | `/api/marketing/segments` |
| POST | `/api/marketing/segments` |
| POST | `/api/marketing/segments/preview` |
| DELETE | `/api/marketing/segments/:id` |
| GET | `/api/marketing/campaigns` |
| POST | `/api/marketing/campaigns` |
| PUT | `/api/marketing/campaigns/:id` |
| GET | `/api/marketing/campaigns/:id/metrics` |
| GET | `/api/marketing/ads` |
| POST | `/api/marketing/ads` |
| PUT | `/api/marketing/ads/:id` |
| GET | `/api/marketing/homepage` |
| GET | `/api/marketing/homepage/preview` |
| POST | `/api/marketing/homepage` |
| PUT | `/api/marketing/homepage/:id` |
| DELETE | `/api/marketing/homepage/:id` |
| POST | `/api/marketing/homepage/reorder` |
| GET | `/api/marketing/collections` |
| POST | `/api/marketing/collections` |
| PUT | `/api/marketing/collections/:id/items` |
| GET | `/api/marketing/products/lookup` |
| GET | `/api/marketing/articles` |
| GET | `/api/marketing/articles/:slug` |
| POST | `/api/marketing/articles` |
| PUT | `/api/marketing/articles/:id` |
| GET | `/api/marketing/synonyms` |
| PUT | `/api/marketing/synonyms` |
| GET | `/api/marketing/settings` |
| PUT | `/api/marketing/settings/:key` |

## Operations portal

`admin.ts` mounted at `/api/admin`

| Method | Path |
| --- | --- |
| GET | `/api/admin/command-centre` |
| GET | `/api/admin/analytics` |
| GET | `/api/admin/analytics/vendor/:id` |
| GET | `/api/admin/search` |
| GET | `/api/admin/alerts` |
| POST | `/api/admin/alerts/:id/resolve` |
| GET | `/api/admin/orders` |
| GET | `/api/admin/orders/:id` |
| POST | `/api/admin/orders/:id/notes` |
| POST | `/api/admin/suborders/:id/cancel` |
| POST | `/api/admin/suborders/:id/refund` |
| POST | `/api/admin/suborders/:id/status` |
| GET | `/api/admin/deliveries` |
| GET | `/api/admin/deliveries/:id` |
| POST | `/api/admin/deliveries/:id/reassign` |
| GET | `/api/admin/drivers/online` |
| GET | `/api/admin/vendors` |
| GET | `/api/admin/vendors/:id` |
| POST | `/api/admin/vendors/:id/review` |
| PATCH | `/api/admin/vendors/:id` |
| GET | `/api/admin/documents` |
| POST | `/api/admin/documents/:id/review` |
| GET | `/api/admin/compliance/rules` |
| PUT | `/api/admin/compliance/rules` |
| GET | `/api/admin/drivers` |
| GET | `/api/admin/drivers/:id` |
| POST | `/api/admin/drivers/:id/review` |
| GET | `/api/admin/customers` |
| GET | `/api/admin/customers/:id` |
| POST | `/api/admin/users/:id/suspend` |
| POST | `/api/admin/users/:id/reactivate` |
| GET | `/api/admin/staff` |
| POST | `/api/admin/staff` |
| POST | `/api/admin/users/:id/roles` |
| DELETE | `/api/admin/users/:id/roles/:role` |
| GET | `/api/admin/roles` |
| PUT | `/api/admin/roles/:key/permissions` |
| GET | `/api/admin/products` |
| POST | `/api/admin/products/:id/status` |
| POST | `/api/admin/products/:id/verify-dietary` |
| POST | `/api/admin/categories` |
| PUT | `/api/admin/categories/:id` |
| GET | `/api/admin/categories` |
| POST | `/api/admin/reviews/:id/moderate` |
| GET | `/api/admin/reviews` |
| GET | `/api/admin/finance/summary` |
| GET | `/api/admin/finance/ledger` |
| GET | `/api/admin/finance/payments` |
| GET | `/api/admin/finance/refunds` |
| GET | `/api/admin/finance/payouts` |
| GET | `/api/admin/finance/payouts/:id` |
| POST | `/api/admin/finance/payouts/run` |
| POST | `/api/admin/finance/payouts/:id/process` |
| POST | `/api/admin/finance/payouts/:id/hold` |
| POST | `/api/admin/finance/payouts/:id/release` |
| POST | `/api/admin/finance/payouts/:id/reverse` |
| POST | `/api/admin/finance/vendors/:id/payout` |
| GET | `/api/admin/settings` |
| PUT | `/api/admin/settings/:key` |
| GET | `/api/admin/zones` |
| POST | `/api/admin/zones` |
| PUT | `/api/admin/zones/:id` |
| GET | `/api/admin/fee-rules` |
| PUT | `/api/admin/fee-rules` |
| GET | `/api/admin/commission-rules` |
| PUT | `/api/admin/commission-rules` |
| GET | `/api/admin/tax-rules` |
| PUT | `/api/admin/tax-rules` |
| GET | `/api/admin/plans` |
| POST | `/api/admin/plans/assign` |
| GET | `/api/admin/risk` |
| POST | `/api/admin/risk/:id/review` |
| GET | `/api/admin/audit` |
| GET | `/api/admin/outbox` |

## Server sent events

`stream.ts` mounted at `/api`

| Method | Path |
| --- | --- |
| GET | `/api/stream` |

## Uploads

`files.ts` mounted at `/api`

| Method | Path |
| --- | --- |
| POST | `/api/files` |
| GET | `/api/files/:id` |
