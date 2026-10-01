# AskGogo commerce overnight handoff — 1–2 October 2026

## Authorized objective and limits

User explicitly requested overnight implementation, with morning end-to-end testing: per-user Swiggy/Zepto connection → saved delivery address → verified availability/prices/fees → delivered-total comparison → explicitly selected cart addition → correct phone cart link → consistent WhatsApp/dashboard outcome.

Heartbeat `askgogo-overnight-commerce-loop` is active hourly, ending 2 Oct 2026 at 09:00 IST. It belongs to this task. Continue meaningful independent work; do not repeat unchanged blocked checks. No subagents requested. No review-round loop. No unrelated refactoring. No purchases, external provider outreach, actual cart mutations or orders. No OTP/CAPTCHA/payment handling. Do not download production secrets. Do not touch Claude's checkout at C:/Users/gover/gogo-memory-os.

Repo: this work/gogo-memory-os checkout. Branch: `feat/india-commerce-connect-loop`, based on production `a8c3985f` (#317). All new commerce work is BRANCH ONLY until gates and release verification say otherwise. Preserve untracked scratch logs. No schema changes or new dependencies in this milestone.

## Current implementation

- `lib/commerce/providers.ts`: exact official OAuth/MCP endpoints; Swiggy and Zepto per-provider enable flags default OFF. Callback URLs derived from the configured app origin, never request Host or chat text.
- `lib/commerce/oauth.ts`: dynamic public-client registration or configured client ID, PKCE S256, random state, owner/provider/callback/issuer/ten-minute binding, token exchange with redirect rejection and safe errors. No OTP endpoint calls. Swiggy JSON token request follows its docs; Zepto uses form encoding. Missing/invalid token lifetime fails closed.
- `lib/commerce/connection-store.ts`: owner/provider-scoped encrypted OAuth tokens in existing service-role-only vault_credentials, using existing unique key. No token in prompts, task metadata or browser JSON. Expired tokens require sign-in again; no speculative refresh.
- `/api/commerce`: private connection status; `/api/commerce/[provider]/connect`, `/callback`, `/disconnect`: authenticated connection/revocation flow. Browser-bound encrypted HttpOnly OAuth cookie, state+owner checks, fixed post-callback redirect. Disconnect reports unverified remote revocation honestly.
- `/dashboard/commerce`: connection UI linked from Connections. Clearly distinguishes approval required, not connected and account authorized. Account authorized does NOT mean cart/delivery verified.
- `lib/commerce/mcp.ts`: bounded MCP JSON/SSE transport, initialize/session/version handling, tools/list and documented Swiggy READ tools only. No automatic retries. Write tools, order/payment and unknown Zepto read schemas cannot execute. Zepto catalogue discovery is possible after auth; actual adapters remain to build.
- `lib/commerce/addresses.ts` and private `/api/commerce/swiggy/addresses`: documented address-page parser and authenticated provider call. Phone numbers are omitted. Exact-ID/unique-label selection helper refuses ambiguity. Pagination is explicit. Address selection is now re-read from the provider and persisted on the exact owner task; only ID/label/source/time are retained, not the street or phone. Zepto address endpoint explicitly returns adapter pending.
- `lib/commerce/evidence.ts`: typed quote scope/evidence, freshness, equivalent-basket and confirmed-location comparison, exact cart-item/variant/quantity match, validated provider URLs and honest summary. This is tested core logic; no provider adapter has populated a live quote yet. Missing fees are not converted to zero; ranking uses provider payable totals, not a sum guessed from components.
- `scripts/verify-commerce-connection.mts`: real OAuth functions, encrypted store, callback handler and transport with fixture server/DB. Tests owner isolation, state/provider/issuer/expiry rejection, token non-disclosure, disconnect scoping, JSON/SSE, callback cookie consumption, and write-tool rejection. Wired into npm test.

## Evidence already obtained

- Targeted commerce test PASS; TypeScript PASS.
- Full existing package test manifest PASS (exit 0; outputs/commerce-full-test.log). Final production build PASS (exit 0; outputs/commerce-build-final.log). Final TypeScript PASS. Focused commerce tests were re-run after the later address/evidence additions and pass. These are local/fixture gates, not live-provider acceptance. No shell sessions remain running for these checks.
- Read-only production metadata query: vault_credentials and vault_audit have RLS enabled and zero client policies. No production row written by this work.
- Live unauthenticated metadata fetch: Swiggy issuer https://mcp.swiggy.com/auth, authorization/token/register paths under /auth, PKCE S256. Zepto protected-resource metadata points to https://auth.zepto.co.in; its own authorization-server metadata provides /authorize, /token, /register and /revoke. Never guess endpoints from the MCP host.
- Unauthenticated tools/list probes on both official MCP endpoints returned 401. No live user tokens/addresses/cart were obtained. Do not keep probing without user authorization.
- Existing production remains a8c3985f, READY from the previous turn. It only has location-based food discovery, not commerce authentication.

## Finish next, in dependency order

1. Initial connection milestone gates have passed; do not repeat them until new changes justify it. For future Windows full tests, package test command exceeds 8191 chars: write package.json scripts.test verbatim to a Bash script file and execute that file. Load env via existing C:/Users/gover/gogo-memory-os/scripts/load-env.ps1 without printing values. Do not modify that checkout.
2. Same-task OAuth and saved-address selection are implemented on the branch. Next, continue from the selected address into documented provider catalogue/quote reads. The task remains paused with an honest waiting_verified_quote summary until that executor exists; it does not yet autonomously search after selection.
3. Implement provider adapters with actual documented schemas: food search/menu/cart; Instamart comparison partner for Zepto (Zepto does not make a like-for-like restaurant-food provider). Discover Zepto tools/schema after authorization, or use only official published contracts; do not invent names from generic shopping assumptions.
4. Populate the implemented typed evidence from provider adapters and verify exact item/variant/quantity/address/currency, availability and provider payable total. Verify provider money units before converting to paise. Menu snippets aren't cart quotes; missing fees remain unknown. Compare equivalent baskets at an explicitly matching delivery location. No fake zero fees or invented discounts; no cart mutation merely to compare unless authorized.
5. Add a durable explicit cart-selection approval path. Read existing cart first, preserve unrelated items, never silently clear it. Record outcome_unknown before uncertain mutation retries; read back before any retry. Verify requested item/variant/quantity/address and total before claiming cart success. Exclude order-placement/payment tools entirely.
6. Use returned provider item/cart URLs, validate their provenance, keep phone opening/installed-app behavior unverified until user tests. A link alone does not prove cart sync.
7. Reflect actual state/evidence and next action in the same agent run on WhatsApp and dashboard. Add integration tests through actual routes/handlers, not just helpers. Use fixtures honestly; separate simulated from live evidence.
8. Commit/push bounded completed changes, run CI/build, release only validated code with provider activation OFF until access is approved. No fresh Codex review request. Verify production alias exact commit. Prepare numbered copyable morning tests and an evidence table (implemented/tested/live-verified/blocked).

## External blockers — already known, do not repeatedly ask/check

- Owner confirmed Swiggy access has NOT been added. Production activation needs provider approval and exact callback allowlisting. Zepto also needs AskGogo callback allowlisting and product-use confirmation.
- Proposed concrete callbacks: https://app.askgogo.in/api/commerce/swiggy/callback and https://app.askgogo.in/api/commerce/zepto/callback. These routes now exist on the branch, not yet production.
- Flags `COMMERCE_SWIGGY_ENABLED=true` / `COMMERCE_ZEPTO_ENABLED=true` are NOT set by this work. Enable only when corresponding provider access/callback is confirmed. Optional `COMMERCE_SWIGGY_CLIENT_ID` / `COMMERCE_ZEPTO_CLIENT_ID`; otherwise documented dynamic registration happens on user Connect.
- Existing `VAULT_MASTER_KEY_V1` must be provisioned for the deployed environment; do not expose or download its value. Connect fails closed when absent.
- User must authenticate on the provider page. Their phone app/cart must be verified by them. Do not claim these steps can be completed unattended.
- Zomato third-party use restricted; not part of the authorized initial integration build.

## Primary references

- https://mcp.swiggy.com/builders/docs/start/enterprise/delegated-auth/
- https://mcp.swiggy.com/builders/docs/start/authenticate/
- https://mcp.swiggy.com/builders/docs/reference/food/get_addresses/
- https://mcp.swiggy.com/builders/docs/reference/food/get_food_cart/
- https://mcp.swiggy.com/builders/docs/reference/food/update_food_cart/
- https://github.com/zeptonow/mcp
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- `outputs/INDIA_COMMERCE_INTEGRATIONS.md`

## Morning status honesty

Until the above provider approvals and user sign-in exist, the end-to-end LIVE commerce loop remains OPEN. Deliver the completed code/test evidence and exact missing step, not a claim that a fixture pass means live cart access works.

## 00:47 IST heartbeat milestone — same-task connection and address selection

- Added lib/commerce/task.ts and authenticated /api/commerce/tasks/[runId]. OAuth flow carries an explicit owned run ID; callback returns to that exact task, never a newer run. Existing authorized account can be reused without another sign-in.
- Closed/replaced/terminal tasks cannot be resumed. Updates compare the previously read updated_at and status; simultaneous changes return a conflict rather than overwrite task state.
- Address POST re-fetches the selected provider page, validates the exact address ID, persists necessary ID/label on that task, and renders the response from the saved row. Wrong-owner, fabricated selection, provider read failure and persistence failure never confirm success.
- Dashboard supports saved-address pagination/selection. Food replies include the task connection link; "show my food comparison" reads the stored summary used by the dashboard.
- Restaurant-food tasks bind only Swiggy. Zepto groceries require the future grocery-basket task; do not pretend they are a second restaurant-delivery provider.
- New actual-handler fixture suite: scripts/verify-commerce-task-continuation.mts, wired into package test. It covers OAuth preservation, existing-account reuse, owner isolation, late callback after closure, concurrent update conflict, address re-read, non-disclosure and stored summary consistency. Existing commerce and food suites pass. TypeScript and build pass. Full existing manifest (150 commands) passed, exit 0. No shell sessions remain running. All gates apply to the final executable changes in this milestone.
- Local build log: outputs/commerce-task-build.log. Test log: outputs/commerce-task-full-test.log. No production release or live provider/cart access in this milestone.

### Provider contract research for the next implementation

Official Swiggy Food docs expose search_restaurants(addressId,query,offset?) and search_menu(addressId,query,restaurantIdOfAddedItem?,vegFilter?,offset?). Search-menu data has menu_item_id, restaurant_id, inStock and two mutually exclusive customization formats. Cart output includes addressId and nested data/cart_id/items/pricing; the public input table for update_food_cart only types cartItems as object[]. Do not invent its inner item contract; obtain the published detailed schema or authenticated tools/list.

Food cart pricing fields are numeric, but their source-unit contract is not explicit in the inspected cart pages. apply_food_coupon explicitly calls coupon_discount rupees; that alone does not establish every Food/Instamart field unit. Preserve this uncertainty until authoritative evidence or live provider readback verifies it. No provider cart URL was documented in inspected Food output schema; do not fabricate a checkout/deep link.

Instamart's official index documents search_products, get_cart and update_cart on /im. update_cart REPLACES the entire cart, so any authorized addition must preserve existing items and reconcile unknown outcomes before retrying. Read full schemas before adding adapters. Zepto's public repository still provides capabilities rather than actual input/output schemas; authenticated discovery remains blocked by user sign-in/access.

References: https://mcp.swiggy.com/builders/docs/reference/food/search_menu/ ; https://mcp.swiggy.com/builders/docs/reference/food/update_food_cart/ ; https://mcp.swiggy.com/builders/docs/reference/instamart/ ; https://github.com/zeptonow/mcp

- Morning acceptance draft: outputs/COMMERCE_MORNING_TESTS.md. It clearly separates branch-only fixture coverage, provider approval/sign-in, and unfinished live quote/cart/phone checks.
