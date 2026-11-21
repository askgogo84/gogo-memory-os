# AskGogo partner-commerce bridge readiness — 21 Nov 2026

**Company:** CIQ AI Solutions Pvt Ltd. **Product:** AskGogo.

## Release state
**Draft, not shipped. No provider or payment network request, no partner access, no credential storage, no customer OAuth, no consumer checkout route, no migration.**

This branch is isolated from:
- [Zomato catalogue pilot PR #1546](https://github.com/askgogo84/gogo-memory-os/pull/1546) (draft/default OFF)
- [District read pilot PR #1545](https://github.com/askgogo84/gogo-memory-os/pull/1545) (draft/default OFF)
- [Commerce purchase/outcome ledger PR #1524](https://github.com/askgogo84/gogo-memory-os/pull/1524) (draft/default OFF)

The original Zomato manifest limits unauthorized third-party product usage; District's public FAQ requires commercial partner permission. Neither the public published tool list nor a passing synthetic suite grants consent or authority. The Zomato POS partnerships routing email and District developer email were sent on 20 Nov; there is no confirmed product integration authorization yet.

## What this branch provides (new files only)

1. `lib/commerce/partner-bridge/authorizations.ts` — tenant/provider grant checks, explicit owner and scope-matched consent checks, short-lived one-time hashed OAuth state, PKCE S256 verifier/challenge, callback principal/redirect/state checks. No unknown auth endpoints, redirects, token exchange, JWT signing or fake consent registration. All grant and state/consent stores are **trusted-server interfaces**, not browser state.
2. `lib/commerce/partner-bridge/action-ledger.ts` — provider-agnostic exact quote digest and pricing checks, immutable pending intent, explicit owner confirmation bound to the exact displayed digest, atomic durable store interface with version CAS, irreversible one-time submission reservation, outcome-unknown on response or exception, authenticated readback reconciliation. **A 200 response is NEVER a verified order.** No arbitrary MCP tool calls.
3. `app/dashboard/(app)/commerce/partner-bridge/PartnerConsentReview.tsx` — unmounted consent/revocation review component. Connection is disabled without trusted partner enablement. No customer-visible route is created.
4. `scripts/verify-partner-bridge-nov21.mts` — synthetic-only regression suite registered in `scripts/tests.d/partner-bridge-nov21.list`; operator/consent denied, cross-owner, nonce replay, stale quote, quote total mismatch, exact approval, one-attempt, uncertain transport, readback mismatch, verified terminal evidence. Fixture/mock adapters make **zero** partner calls.

## Developer integration contracts and important gaps

Before integrating this into AskGogo runtime:
- Acquire provider-signed **commercial** agreement and product-specific OAuth allowlist/sandbox, allowed operations, redirects/scopes, data processing limits, and pricing/rate-limit terms **separately** for Zomato and District.
- Implement trusted operator-backed `PartnerAuthorizationSource` and encrypted, owner/tenant-bound credential vault, plus token refresh/revocation. This PR does **not** assume connection metadata implies consent.
- Implement `PartnerOAuthStateStore` with unique state hash and atomic one-time consume. Only a verified account session may call issuance/callback handlers. Broker must exchange code with registered provider endpoints, validate granted scopes, encrypt tokens, and **only then** persist owner consent.
- Implement a transactional `DurablePartnerActionStore` on the existing #1524 ledger (or compatible unified persistence) using owner- and tenant-bound RLS and a unique idempotency key. Do not use an in-memory store in production. Integrate exact quote readback and server-side totals before preparing an action.
- Implement separate allowlisted **single-operation** provider adapters after partner tool-schema verification. Never expose arbitrary `tools/call` or LLM-defined operation names. Mark the write explicitly operator-enabled only after a scoped risk/security approval. Do not invoke `dispatchPartnerAction` for catalogue/dining discovery reads.
- Wire a real account management page and a separate checkout/booking approval experience, keyed to authenticated owner and exact quote digest; the component here is intentionally unmounted. UI permission is not a grant, and auth state alone never approves a payment.
- Make `ApprovedProviderAdapter.readback` perform a trusted authenticated provider read, bind actual merchant/outlet, transaction and totals to the original request, and log evidence provenance. If the provider cannot give safe independent evidence, keep `outcome_unknown` and route to human support; never automatically resubmit.
- For production, ensure the dispatcher and CAS reserve commit survive crashes, reconciliation runs with bounded rate limits, audit logs retain redacted evidence refs only, and revocation/erase duties are enforced.

## Acceptance matrix (not yet live-proven)

| Test / control | This branch | Production |
| --- | --- | --- |
| Deny vendor/operator approval absent | Contract fixture | Not wired |
| Tenant/owner-scoped OAuth + consent | Contract fixture | No credential vault/callback |
| Replay and expired state rejection | Contract fixture | No durable state store |
| Pricing and exact user approval | Contract fixture | Requires verified provider quote |
| One-attempt durable reservation | CAS interface + fixture | DB integration pending |
| Unknown outcome; no blind resend | Contract fixture | Provider adapter pending |
| Actual authenticated result reconciliation | Evidence schema + fixture | Partner sandbox acceptance pending |
| Customer consent screen | Preview, **unmounted** | Product UI pending |
| Zomato cart/order/payment | Not implemented | Provider approval blocked |
| District reservations/payment/cancel | Not implemented | Provider approval blocked |

### Safe activation sequence

1. Independent review of this draft; CI must pass at the exact PR head or inspected synthetic merge, and all TypeScript and build checks must be green.
2. Partner agreement + registered OAuth app/sandbox, explicit operator go/no-go and user consent.
3. Merge/compose only after reconciling draft PRs #1524/#1545/#1546, then implement runtime stores/adapters in a new reviewed PR.
4. Perform negative and approved sandbox UAT with no real customers, then controlled production read-only canary; mutations require separately verified evidence and approval.
5. Record owner-controlled successful order, booking, cancellation, payment/refund readbacks independently. **No live claim before verified evidence.**

Coordination: [issue #274](https://github.com/askgogo84/gogo-memory-os/issues/274).
