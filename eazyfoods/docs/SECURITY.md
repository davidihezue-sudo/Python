# Security

## Authentication and sessions

* Passwords are hashed with scrypt and per password salts. Passwords need at least 10 characters with letters and numbers.
* Sessions are random opaque tokens stored hashed in `sessions`, sent as an HTTP only, `SameSite=Lax` cookie (`Secure` in production) or as a Bearer token for apps. Changing a password signs out the other sessions; suspending a user revokes all of theirs.
* After five failed sign ins an account is locked for 15 minutes. Login, registration, password reset and checkout endpoints have per route rate limits; a global limit applies to everything.
* Password reset tokens are single use, hashed in storage and expire.

## Authorisation

* Every route checks permissions on the server. The web app hides screens a user cannot use, but hiding is only a convenience.
* Staff roles are bundles of permission keys managed in the operations portal. Vendor team members (owner, manager, staff) get capabilities per business. A vendor user can only read or change their own business.
* Customers can only read their own orders, addresses, tickets and messages. Drivers can only see jobs assigned to them, with privacy rules that hide the full address until acceptance and hide customer details after completion.
* Server sent event topics are authorised per connection.

## Data and input

* All input is validated with zod before use; SQL is parameterised everywhere.
* Money is integer cents in code and `NUMERIC(12,2)` in storage, never floating point.
* Uploads are checked for type and size; private documents are only served to their owner and to staff with the right permission.
* Card data never touches this system: checkout takes a processor token. The sandbox processor accepts only fixed test tokens.
* Cookie authenticated writes require the `x-requested-with` header and an allowed `Origin`, which blocks cross site form posts alongside `SameSite=Lax`.
* Security headers (`helmet`, `X-Content-Type-Options`, `Referrer-Policy`, frame protection) are set on the API and the web app.

## Audit and fraud signals

Sensitive actions (approvals, refunds, payouts, settings, role changes, suspensions, status overrides) are written to `audit_logs` with the actor, IP and device. The fraud scanner raises risk signals (refund abuse, promotion abuse, referral self dealing, repeated failed payments, unusual order patterns) for a person to review. It never blocks a customer automatically.

## Before real customers

This is a complete foundation, not a security audit. Before launch: run an independent penetration test, add a content security policy tuned to your chosen payment and map providers, enable email verification and multi factor authentication for staff, rotate the demo credentials, configure WAF and DDoS protection at the edge, and review privacy, tax and food safety obligations with qualified advisers in each jurisdiction you operate in.
