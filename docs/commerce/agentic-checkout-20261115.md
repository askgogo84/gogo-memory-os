# AskGogo Commerce & Payments — isolated purchase handoff

Branch: feat/commerce-purchase-handoff-20261115
Base: main d18a91ad7389fb1c25eacb7091c9a88f31afa15b (14 November 2026)
Status: DRAFT, feature disabled by default; no production migration or provider activation authorized.

## Boundary and existing integration

This branch creates a customer checkout proposal from an existing authenticated, provider-confirmed cart. It does not charge, place an order, store payment credentials or confirm a payment.

- The server reads the source task and creates a SHA-256 approval fingerprint over the exact owner, task, merchant, cart, saved address ID, SKU/quantity basket, INR payable total, provider HTTPS checkout URL, phone-cart verification and provider observation time.
- It accepts no customer-supplied prices, checkout URLs, card details or payment tokens.
- A proposal is unique per owner and source task. Changed amounts, delivery address or items require a new task. Source evidence expires five minutes after provider readback.
- Checkout approval requires exact amount, merchant, fingerprint and affirmative consent. It uses an owner-scoped status compare-and-swap. Only a fresh approved proposal can reveal a provider checkout link upon a distinct customer action.
- Releasing that URL is not proof that it was opened, nor proof of payment, order placement or refund. The ledger records handoff_released, not an unverified browser opening. No retry of an uncertain provider financial write occurs.
- The new service-role-only table has RLS enabled and holds no card PAN, CVV, OTP, UPI PIN or OAuth tokens. AskGogo Razorpay subscription billing is untouched.
- The dashboard review screen shows missing verification; it never initiates payment automatically. The INR 50,000 cap is a deliberate pilot constraint.

New API endpoints: POST /api/commerce/purchases; GET and POST /api/commerce/purchases/[id] with actions approve, open and cancel. Dashboard: /dashboard/commerce/checkout. Feature flag: COMMERCE_PURCHASES_ENABLED=true, default off. Migration: supabase/migrations/20261115090000_commerce_purchase_intents.sql.

## Verified external blockers

1. Current Instamart cart readback explicitly sets providerUrl=null and phoneVerified=false. Therefore current proposals remain awaiting_provider_handoff. The public Swiggy MCP docs do not establish that AskGogo can obtain a direct, phone-verified provider checkout link in this integration. Approval will remain blocked until a trusted adapter and Android/browser acceptance test provide both.
2. Swiggy and Zepto per-user OAuth requires actual provider authorization; implementation and fixture tests are not activation. Do not enable COMMERCE_SWIGGY_ENABLED or COMMERCE_ZEPTO_ENABLED without permission and user consent.
3. Swiggy agreement restrictions on competitor comparison remain enforced by the existing swiggy-policy module. The review-only branch does not alter them.
4. No connected third-party payment tokenization, merchant payout arrangement, verified CreditIQ merchant rewards API, live receipts/order status, refunds, disputes or enterprise approver workflow exists in this branch.
5. Swiggy checkout is an irreversible order/payment operation according to official documentation. It is intentionally not wired into our generic read-only MCP client. A separately audited, durable approval-and-outcome executor is required.

## Acceptance before any release

- Independent security review on exact PR head, with RLS/owner isolation, CSRF/native bearer authorization, SQL constraints and concurrency tests.
- Fresh cart readback: exact items, quantities, selected saved delivery address, currency and all-in payable amount, not a price snippet or incomplete fee estimate.
- Two independent accounts and international number-collision tests, stale snapshot, changed total, lost-acknowledgement and duplicate-request tests.
- Phone test on Android: approved provider deep-link opens the actual selected account and exact cart; browser fallback must not claim verified state without proof.
- Explicit customer approval bound to exact cart/amount, provider checkout link, expiration, payment method and final seller confirmation.
- No paid, ordered, or refunded claim without trusted merchant transaction/order evidence. Test partial deliveries, declined UPI, failed payment, refunds and ambiguous statuses.
- Provider/PSP contract, RBI/PCI review when applicable, app permissions, tenant budgets and escalation paths.
- Database migration review and rollback plan; production activation only after the owner authorizes the exact reviewed SHA and gates pass.

## Deferred, not falsely labeled as implemented

CreditIQ card optimization: lib/commerce/creditiq-rewards.ts now provides a strictly verified-offer advisory ranking engine, with negative tests. No authenticated production CreditIQ merchant-offer adapter exists. Point balances alone cannot prove a card reward, and a card recommendation is not a payment credential.

Enterprise commerce: lib/commerce/enterprise-spending-policy.ts now evaluates tenant, merchant, category, freshness, budgets and independent approvers in a pure fail-closed preflight. It cannot execute. Tenant-scoped policy storage, verified employee identity, approval ledger, finance exports, refunds and audit/retention still require integration and security tests. No company funds may be spent by learned routing.

Tokenized cards: network/PSP integration, issuer and cardholder authentication, compliant credential storage, revocation and dispute handling. The OpenAI ChatGPT Wallet announcement is not a general external-wallet API.

No source lease from issue #274 is modified. No merge, deploy, provider activation, real order, payment or Claude notification is authorized as part of writing this branch.
