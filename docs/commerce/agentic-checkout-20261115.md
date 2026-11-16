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

## Merchant outcome verification — follow-on implementation

Added an append-only, service-role-only authenticated merchant order/payment readback ledger, a read-only customer endpoint (`GET /api/commerce/purchases/[id]/outcome`) and checkout review status panel. Records bind purchase, merchant, cart, order, payment, and refund references; require same-account merchant adapter verification; reject stale evidence, cross-owner/cross-cart claims, inconsistent amounts, replay conflicts and guessed statuses. The UI reports unknown whenever a verified readback is absent. No customer-supplied payment confirmation is accepted, and no webhook execution endpoint was added. The internal `persistAuthenticatedMerchantOutcome` function **must only** be called by a separately approved merchant adapter that performs real authenticated merchant API readback. Until such provider access exists, outcomes remain unverified. A new additive migration `20261115120000_commerce_outcome_readbacks.sql` is NOT applied in production. Tests run on exact PR head. Order placement, payment processing and live merchant order readback are NOT enabled by this patch.

## Native Swiggy checkout discovery (read-only adapter)

Swiggy official MCP docs expose `get_payment_options`, `checkout`, `check_payment_status`, `confirm_order`, and `get_orders`; checkout is a real merchant order/payment action, not a URL redirect. This commit integrates only authenticated live **read-only** `get_payment_options` after a fresh exact-cart readback, and a UI to review only returned COD/UPI/QR/Swiggy Money options. It does not select any method or execute `checkout`; real payment/order orchestration still requires its own durable CAS claim, explicit per-order selected-method confirmation, the provider's approved integration and separate financial review. The customer must not be told checkout is activated. Expired handoff links are no longer exposed from GET after TTL.

## Enterprise purchase approval audit ledger

Added immutable tenant/purchase/snapshot/policy-version-bound approval requests and independent multi-approver votes. Verified tenant IAM context is mandatory at the service boundary, employees cannot approve their own purchases, cross-tenant votes are rejected, and vote writes are append-only/idempotent. No public approval-mutation endpoint exists until enterprise IAM and policy storage can provide verified actor context; no budget is reserved and no company money can be spent by these approvals. Migration `20261115150000_commerce_enterprise_spend_approvals.sql` has not been applied. Integration with authoritative tenant budgets, finance reconciliation, receipts and credit provisioning remains a live release blocker.

## CreditIQ authenticated merchant-exact benefits (read-only bridge)

Added a signed, linked-user CreditIQ commerce advisory client with strict contract, owner/cart/merchant/amount binding, expiry gating, and an authenticated customer GET/view. `CREDITIQ_COMMERCE_REWARDS_ENABLED` is **off by default**. It only accepts dedicated issuer-verified quote evidence from `https://creditiq.app/api/internal/gogo/commerce/merchant-benefits`. That authenticated CreditIQ endpoint does not yet exist in the currently audited `creditIQ` main branch. Existing CreditIQ catalogue optimizer and statement balance routes are explicitly **not** substituted for issuer offer evidence. Until the counterpart endpoint, issuer feed verification, account linking and integration tests exist, this bridge safely returns zero verified offers and cannot influence or authorize checkout. Existing signed travel bridge secret `CREDITIQ_GOGO_SERVICE_SECRET` is reused; no credential or PAN is ever passed to a browser.

## Native merchant checkout (dark-launch only; NEVER activated)
A separately gated native Instamart checkout executor was added using Swiggy's documented `checkout` action. A live authenticated cart with all-in payable amount and full saved delivery address is read back; the exact delivery address and payment-method choices are bound to a short-lived SHA-256 review. A distinct customer-origin POST requires the exact review and amount plus independent affirmative cart/selected-method/address consent. A unique purchase attempt is INSERTED **before** any outbound merchant checkout call. Timeouts and partial-store results are never retried. The API never says paid or ordered on a transport response. No `confirmDuplicate` calls exist and company tenant purchasing is blocked from bypassing enterprise policy. Service-role-only migrations preserve attempts; detailed address is never stored in these tables.

Activation requires **all** flags `COMMERCE_NATIVE_CHECKOUT_ENABLED=true`, `COMMERCE_PURCHASES_ENABLED=true`, and `COMMERCE_SWIGGY_ENABLED=true`, merchant agreement, security review, tenant/customer consent, correct payment-method/device tests, and merchant-confirmed outcomes. Those flags remain **OFF**, no migration has been applied, and no real order/payment call was made. This implementation is NOT an accepted production checkout: it still lacks verified payment/confirm_order orchestration, complete UPI device handoff, production account authorization, deployment, and live multi-store/return/refund acceptance.

Native checkout review creation is POST-only with session/CSRF origin checks, not a GET side effect. Its optional customer UI checks all three operator flags, shows the exact provider address and payable amount, asks two explicit acknowledgements, and never retries after an uncertain financial write. All flags remain OFF and no production migration has been applied.

## Native merchant order history re-read

Authenticated `get_orders` is allowlisted for read only. An owner-scoped API matches only exact order IDs returned by the single native checkout attempt and the saved merchant delivery address ID. Missing/partial/multi-store outcomes remain partial or unknown, and merchant order history alone never implies captured payment or refund. Any attempt with no returned IDs is deliberately unreconciled rather than guessed by matching cart totals or timestamps. Live acceptance requires provider account and real orders; no merchant calls were made while adding this code.

Native direct checkout is explicitly limited to the returned COD or Swiggy Money choices; UPI intent and QR are shown only in read-only payment discovery until a device-safe payment continuation and payment confirmation worker are implemented. Attempting UPI via the native POST fails closed.

Native direct checkout now requires Swiggy's `agenticPaymentEligible===true` attestation at both quote preparation and final preflight, and binds/display human-readable live cart item names, variants and quantities in the exact review fingerprint alongside the saved address and total. No stale, renamed, or changed basket can be silently ordered.

Critical cancellation race protection: after the one-attempt insert and before any merchant checkout call, the executor atomically CAS-transitions the purchase intent from `awaiting_provider_handoff` to `native_checkout_started`. Competing proposal cancellation then fails safely. If the cancellation happened first, the checkout request will never reach the merchant. The status check constraint is extended by the additive native checkout migration; users are warned that proposal cancellation cannot undo a merchant order.

## Authenticated native payment-status readback (non-executing)
Added a separately authenticated, origin-validated customer POST path to query Swiggy `check_payment_status` **only** when an earlier uniquely claimed checkout attempt has persisted a real `paasId` plus `orderId` from the merchant's first response. The identifiers cannot come from the caller, model, or browser. The provider result must match both exact identifiers and non-contradictory terminal flags; a pending result is NOT a payment. The check is cadence-limited through a durable CAS claim and produces an append-only, service-role-only evidence row. It NEVER initiates checkout, retries an earlier payment write, calls `confirm_order`, or claims a refund. The Swiggy status-check API can auto-finalize a previously approved UPI payment, therefore the route is POST/customer-triggered rather than GET/background. UPI checkout itself is still blocked pending device and explicit payment authentication tests. No production migration/flags have been changed.
