# Zomato food MCP × AskGogo — permission-locked scaffold (20 Nov 2026)

## Public provider facts
- Official manifest: https://github.com/Zomato/mcp-server-manifest
- Endpoint: `https://mcp-server.zomato.com/mcp` (remote Streamable HTTP).
- Public advertised capabilities: restaurant discovery; menu browse; cart creation; food ordering and tracking; QR payment.
- Zomato explicitly disallows new third-party apps on its MCP under its current security/legal restrictions, and public OAuth redirect allowlisting does not include AskGogo. Personal-use developer intake is **not** permission to embed this in a commercial product.
- Zomato food MCP and District experiences MCP are independent services. See draft PR #1545 for District.

## Current AskGogo engineering state
- New `lib/commerce/zomato-mcp-pilot.ts` implements a **catalogue-only** gated MCP handshake and `tools/list`. It does not implement `tools/call` or assert a safe real tool name. Returned tool summaries are **unreviewed** and not executable.
- All outbound calls are blocked until trusted operator env flags `ZOMATO_PARTNER_APPROVED=true`, `ZOMATO_OAUTH_CLIENT_APPROVED=true`, and `ZOMATO_MCP_CATALOGUE_ENABLED=true` are all set. Keep these OFF until documented provider approval.
- An owner-bound `ZomatoMcpConnection` (token from a trusted server-side broker, not model input) is required. No broker, OAuth callback, token store, consent UI or production routing is added.
- Fixed vendor URL, no HTTP redirects, bounded response, auth failure, malformed response and opaque session handling.
- `npx tsx scripts/verify-zomato-mcp-pilot-nov20.mts` uses **synthetic HTTP fixtures only**; no vendor calls. A passing test is not Zomato acceptance.
- Does **not** modify existing `lib/commerce/mcp.ts`, food specialist, browser flow, purchase ledger #1524, payment handling, approvals, production env or deployments. Never claim live orders or provider verification from this scaffold.

## Current partner outreach
- Original request to `api@zomato.com` was sent 20 Nov 2026 but delivery failed via its Google Groups posting restriction. Do not retry it.
- Follow-up 20 Nov 2026 sent to `pos-partnership@zomato.com`, an **official contact for POS integrations only**, asking that team to route AskGogo to the MCP partnerships owner. This is **not a verified MCP-specific mailbox** and does not indicate approval.
- Public Zomato MCP repository has other third-party integration requests under Issues; their existence does not confer access.
- Entity: **CIQ AI Solutions Pvt Ltd**. Product: **AskGogo**.

## Authorized activation path (not yet completed)
1. Secure written commercial permission and the correct Zomato technical owner; agree use cases, API limits, security/privacy/data use and commercial terms.
2. Obtain explicit client registration/redirect allowlisting and a sanctioned OAuth PKCE flow; canonical owner/tenant binding, encrypted tokens, consent, refresh and revocation.
3. Inspect live tool schema only with a vendor-approved pilot identity. Contract-test each candidate safe **read** operation; do not infer safety from a name or a documentation screenshot.
4. Wire verified restaurant/menu reads to the existing food specialist and commerce provider catalogue. Require exact restaurant/outlet identity, locality, taxes/fees and provider attribution. Use provenance and freshness; prevent unverified availability or pricing claims.
5. For any cart change, order, payment or cancellation, reuse durable approval and purchase intent boundaries. Require exact item/quantity/total/delivery-address review, explicit approval, idempotency, provider readback, unknown-outcome reconciliation and auditable transaction history.
6. Add owner-isolation, consent, token expiry, injection, stale cart, address mismatch, changed total, price/fee drift, 401/429/5xx, partial execution and duplicate-retry regressions. Require exact-head CI, real partner sandbox UAT and explicit rollout permission.

## Release decision
**Draft / mock-verified only. No commercial enablement, no live OAuth, no external order, no production deployment.** Track dependencies in coordination issue #274. Never merge/enable merely because a CI test passed.
