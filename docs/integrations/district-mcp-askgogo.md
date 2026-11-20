# District MCP × AskGogo — guarded integration pilot (20 Nov 2026)

## Official provider facts

- District documentation: https://studio.district.in/mcp/
- Streamable HTTP endpoint: `https://mcp-server.district.in/v2/mcp`.
- Six areas and 22 advertised capabilities: movies, dining, events, sports, salons, bookings.
- Documented workflow verbs: `search` (operation/recipe discovery), `execute` (read results), `act` (hold/book/cancel), `pay` (begin UPI), `cancel_payment` (stop unfinished UPI payment).
- District calls the existing connector **personal use** and directs product developers to contact its team. Its FAQ says other web apps cannot sign in until District enables them.
- Commercial/integration contact: **developers@district.in**.
- Legacy Zomato MCP and new District MCP are separate endpoints/products.

## What this branch DOES

- Adds `lib/commerce/district-mcp-pilot.ts`: a hard-coded endpoint, typed public capability list, action-risk classification, partner/OAuth prerequisites, guarded MCP Streamable HTTP initiation, tools/list and *only* an exact named `search` read call, where the runtime tool schema verifies a string `query` argument.
- No model-supplied server URL, redirects, OAuth credentials, or arbitrary MCP methods.
- Two operator-only gates (`DISTRICT_PARTNER_APPROVED=true` AND `DISTRICT_MCP_READ_ENABLED=true`) must be explicitly enabled before **any** network call. Both should stay OFF pending permission.
- Requires a trusted server-side connection broker to provide a credential bound to the same canonical AskGogo owner ID. There is deliberately **no** OAuth callback, token storage or user connect button in this branch.
- Bounded response size, timeout, MCP session preservation, fail-closed response/schema validation.
- Mock-only verification with a fake District MCP server: `npx tsx scripts/verify-district-mcp-pilot-nov20.mts`.

## What this branch DOES NOT do

- No District account linking, OAuth, OTP, guest access, bookings, cancellations, charges, payments, refunds, or production calls.
- No real results returned to consumers; no runtime routing or user-facing activation.
- No provider approval has been obtained.
- No approval-gated execution has been implemented for `execute`, `act`, `pay` or `cancel_payment`.
- The pilot test's fake success is **not provider acceptance**.

## Existing AskGogo integration points

Inspect and reuse, do not duplicate:

- `lib/commerce/mcp.ts` — existing Swiggy/Zepto MCP client and explicit read allowlists.
- `lib/agent/booking-engine.ts` — existing booking/connection logic and provider confirmation.
- `lib/agent/autonomous-runtime.ts` — durable mission/idempotency/recovery.
- `lib/agent/policy.ts`, `lib/agent/approval-binding.ts` — approval and execution authority.
- `lib/dashboard/connection-catalogue.ts` — District already appears as a browser sign-in option. **Do not mark it as an OAuth MCP connector** until a real partner-approved OAuth flow is built.
- Commerce purchase PR #1524 — existing draft purchase ledger; reconcile before introducing any new mutation executor.

## Required steps to make AskGogo a production District MCP client

1. Request **written partner approval** for AskGogo/Lanoryn product integration, including consent, privacy, app registration, endpoints, rate limits and allowed workflows.
2. Verify live tools and schemas with a provider-authorized owner session. No unapproved test against private accounts.
3. Add server-side, owner-scoped OAuth with PKCE/state, encrypted token storage, refresh/revocation, scopes and reauth; respect District's app enablement.
4. Check source attribution, result provenance, freshness, error response semantics and how bookings link to account identity.
5. Connect `search` into the existing agent capability registry only after read-only contract tests. Show "not connected" until verified.
6. Review all `execute` recipes before expanding reads, because a recipe can contain stateful operations. Never permit generic arbitrary tool calls.
7. For `act` and `pay`, add typed purchase/booking intent, cost/refund preview, exact user approval, stable business-operation idempotency, provider readback and unknown-outcome reconciliation using the existing ledger.
8. Add cross-owner, cross-tenant, token expiry, partial payment, duplicate webhook, crash after external mutation, refund, cancel and prompt-injection tests.
9. Require exact-head CI, typecheck/build, internal security review, provider-approved staging, real-device/UPI testing, human UAT, and explicit production rollout permission.

## AskGogo as its OWN MCP server — separate follow-up

District's model also suggests exposing AskGogo's original hotel concierge, restaurant operations, enterprise search and CreditIQ advisory skills to authorized external assistants. This requires an independent, authenticated MCP **server** with strict tenant scopes, action approvals, audit, data entitlements and appropriate OAuth. Do not expose internal tenant/guest data or admin functions in a public unauthenticated service.

## Release status

**DRAFT / code and fixtures only.** No migrations, environment changes, partner access, production deployment or financial side effects. Keep all flags OFF and record outstanding partner dependency in issue #274.
