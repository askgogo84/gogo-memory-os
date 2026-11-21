# AskGogo × Zomato MCP — preview-only synthetic owner test (21 Nov 2026)

**Company**: CIQ AI Solutions Pvt Ltd. **Product**: AskGogo.

## Status
This is NOT a connected Zomato application, not a signed-in Zomato account, and not a live MCP integration. Zomato's manifest currently prohibits third-party products without prior written agreement (https://github.com/Zomato/mcp-server-manifest). Partner-authorized OAuth redirect, sandbox, real tool schemas and operator go/no-go are unavailable. No production activation, network calls, credentials, orders, transactions, payment QR or real provider evidence are part of this test. Existing partner PRs remain separate: #1545 (District), #1546 (Zomato catalogue), #1551 (auth/consent/approval bridge), #1524 (commerce ledger).

## Owner test URL
After the **preview deployment for branch `feat/zomato-mcp-owner-sandbox-nov21` is READY**, open:
`https://<verified-preview-host>/dashboard/commerce/zomato-sandbox`

The existing dashboard layout requires a signed-in AskGogo session. The page deliberately returns 404 on Vercel Production; it is allowed only in preview or local development. Do not merge it into main as a production feature.

## Suggested synthetic acceptance walkthrough
1. Click **Enable simulated connection**. This does not invoke OAuth.
2. Choose Demo South Kitchen or Demo Pizza Studio (fictional).
3. Add 2 masala dosas and 1 filter coffee. Expected synthetic total: ₹392.50 (₹350 subtotal + ₹17.50 illustration tax + ₹25 delivery).
4. Review the exact cart. Alter any quantity: previous review is invalidated; re-review required.
5. Choose `Fixture readback: completed`, check the explicit **simulation approval** box and click one simulated submission.
6. Observe `outcome_unknown` first. Do NOT offer a repeat submit. Click **Check synthetic provider readback**; observe a fixture-only completion, clearly not a Zomato receipt.
7. Reset. Repeat with `failed` to observe fixture failure; with `pending` observe persistent unknown outcome and no resubmit.

## Evidence boundary
- UX flow uses the deterministic, pure `zomato-sandbox-demo.ts` state machine and makes **zero HTTP requests**. It neither claims a vendor OAuth exchange nor validates real pricing/availability.
- `scripts/verify-zomato-sandbox-nov21.mts` exercises consent toggle, cross-merchant item exclusion, stale quote, explicit approval, one-attempt reservation, pending/failed/completed fixture outcomes and no-repeat behavior; registered under `scripts/tests.d/`.
- Existing #1551 durable CAS/PKCE contracts remain independent. This UI preview is a product walkthrough, not proof of end-to-end production security.

## Real launch blockers
Written commercial authorization, provider-approved OAuth client and redirect/sandbox, scoped token broker and encrypted owner/tenant store, approved tool schemas, verified real menu/quote and cart operations, real persistent transaction ledger integration, explicit approval and authenticated provider order/payment readback, independent security review, branch-exact CI, human acceptance and separately authorized production release. District requires independent approval.

**Coordination:** GitHub issue #274. Keep all Zomato production feature flags OFF.
