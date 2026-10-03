# Architecture

## Shape of the system

```
Browser / PWA ──► Next.js (apps/web) ──/api rewrite──► Fastify API (apps/api) ──► PostgreSQL 16
                       ▲                                   ▲  ▲                       ▲
                       │ server sent events                │  └── Worker (apps/api/src/worker.ts) ──┘
                       └───────────── LISTEN/NOTIFY ◄──────┘     jobs, schedules, dispatch, payouts
```

The browser only talks to one origin. Next.js forwards `/api/*` to the API, which keeps the API deployable on its own and avoids cross-site cookie problems. The API process and the worker process are the same code base; the worker runs the job queue and scheduled tasks and publishes events through Postgres `NOTIFY`, which the API turns into server sent events.

## Data model (apps/api/src/migrations)

* **Identity and access**: `users`, `sessions`, `roles`, `role_permissions`, `user_roles`, `vendor_users`. Authorisation is by permission key (for example `refunds.issue`), never by role name. Vendor team members have capabilities derived from their member role (owner, manager, staff).
* **Marketplace**: `vendors` (stores and chefs), `chefs`, `vendor_hours`, `products`, `product_variants`, `product_images`, `categories`, `brands`, `inventory`, `inventory_movements`, `inventory_batches`, `ingredients`, `recipes`.
* **Orders**: `carts`, `orders` (one per checkout), `suborders` (one per vendor), `order_items`, `order_status_history`. A cart with items from several sellers becomes one order with several suborders, each with its own status, fulfilment type, commission and payout.
* **Delivery**: `delivery_zones`, `delivery_fee_rules`, `delivery_jobs`, `delivery_offers`, `delivery_batches`, `driver_profiles`, `vehicles`, `driver_locations`, `driver_earnings`, `driver_issues`.
* **Money**: `payments`, `payment_transactions`, `refunds`, `ledger_entries`, `payouts`, `payout_items`, `commission_rules`, `tax_rules`.
* **Growth**: `promotions`, `promotion_redemptions`, `segments`, `campaigns`, `ads`, `ad_placements`, `homepage_sections`, `collections`, `articles`, `search_synonyms`, `loyalty_ledger`, `customer_credit_entries`, `referrals`.
* **Trust and operations**: `disputes`, `support_tickets`, `messages`, `reviews`, `risk_signals`, `compliance_documents`, `compliance_rules`, `audit_logs`, `notifications`, `message_outbox`, `jobs`, `schedules`, `app_settings`, `analytics_events`, `daily_metrics`.

Integrity is enforced in the database where it matters:

* `inventory`: `CHECK (reserved <= on_hand)` and non negative counters make overselling impossible even under concurrent checkouts. Stock is reserved with a conditional `UPDATE` inside the checkout transaction.
* `ledger_entries`: an `UPDATE` or `DELETE` trigger raises an error (the ledger is append only), and a deferred constraint trigger requires every transaction id to balance to zero at commit.
* Chef capacity is checked under a per chef advisory lock, so two checkouts cannot both take the last portion.

## Pricing (apps/api/src/pricing/quote.ts)

`computeQuote` is a pure function: cart lines, vendor facts, address, coupon codes and settings in; a fully itemised quote out. The same function prices the cart page, the checkout confirmation and the order that is written, so a customer never pays a different number from the one shown (checkout rejects with `QUOTE_CHANGED` if anything moved). It covers per vendor groups, sale prices, promotions with stackability and a global discount cap, tax by region and product class, delivery fees, service fee, tip, store credit, minimum orders, vendor hours and chef capacity.

Delivery fees come from data: zones (radius, postal prefix or polygon) set the base fee, per km fee and free delivery threshold; `delivery_fee_rules` add surcharges, multipliers and discounts under conditions such as time of day, weight, product type, demand ratio or multi vendor orders. Commission resolves in this order: vendor override, vendor rule, category rule, global rule, default setting.

## State machines (apps/api/src/lib/states.ts)

Suborder: `pending_payment`, `confirmed`, `vendor_accepted`, `preparing`, `ready_for_pickup`, `driver_assigned`, `driver_arriving`, `picked_up`, `in_transit`, `delivered`, `completed`, with `cancelled`, `refunded`, `partially_refunded` and `disputed` branches. Every transition is validated against an allowed table, recorded in `order_status_history`, and publishes an event. The parent order status is derived from its suborders.

Delivery job: `waiting_for_ready`, `searching`, `offered`, `assigned`, `at_pickup`, `picked_up`, `in_transit`, `delivered`, `failed`, `cancelled`, `unassigned`.

## Ledger and payouts

Every money movement posts a balanced double entry set (capture, commission, delivery revenue, service fee, tax liability, driver pay, promotion subsidy, refund, payout). `GET /api/admin/finance/summary` returns the trial balance and a reconciliation of payments against the ledger. Payouts are swept from ledger balances per payee, can be held, released or reversed, and a payout that would go negative carries the shortfall forward instead of being paid.

## Dispatch (apps/api/src/modules/deliveries.ts, batching.ts, driverpay.ts)

When a suborder is ready, a delivery job is created and offered to eligible drivers one at a time, scored by distance to pickup, rating, acceptance, cold storage and current load. Offers expire; the worker moves on to the next driver and finally raises an operational alert for staff. Two jobs close together can be batched when a permutation search finds a route within the detour limit. Driver pay is computed from configurable components (base, distance, time, peak, surge, guarantee top up, multi order bonus). Drivers see only an approximate area for offers and the full address only after accepting, and customer details are hidden again after completion (settings `privacy`).

## Real time

`GET /api/stream?topics=...` opens a server sent events connection. Topics are authorised per connection: `order:<id>`, `vendor:<id>`, `driver:<id>`, `admin`, plus the user's own `user:<id>`. The web app uses these for order tracking, the vendor order board, the dispatch screen and the command centre. Nothing is simulated: a screen only changes when an event arrives from the database.
