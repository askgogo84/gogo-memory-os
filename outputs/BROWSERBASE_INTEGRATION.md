# Browserbase integration — 2 October 2026

The secure browser executor, vault login, ticket reader and human takeover can
use Browserbase while the existing Vercel sandbox remains the isolated worker.
Enable with server-only `GOGO_BROWSER_RUNTIME=browserbase`,
`BROWSERBASE_API_KEY`, and `BROWSERBASE_PROJECT_ID`. No new database schema or
application dependency. Without the runtime flag the existing browser remains.

## Session ownership and behavior

- Context IDs are stored by sandbox owner and website in the persistent sandbox.
  They contain no credentials; Browserbase retains encrypted provider profiles.
- New sessions use Singapore compute, India proxy egress, a 20-minute limit,
  no recording, no session logging and no automated CAPTCHA solving.
- Agent waves and human takeover attach to the same cloud browser. Commerce
  resume still requires the matching task marker; a replaced/expired live page
  is reported as expired, never silently treated as the previous page.
- Generic browser waves preserve DOM during the request; after completion the
  session is released and the profile retained. Commerce sessions remain alive
  for the bounded takeover/resume window.
- Existing approval/action guards remain authoritative. A read cannot add to a
  cart, book, send or purchase. Connecting a browser grants no extra action scope.
- Browserbase restricts top-level navigation to the requested site. A connected
  broker additionally restricts HTTP/WebSocket resources to the existing provider
  allowlist and bypasses service workers. This was checked from a separate real
  CDP client in the isolated cloud smoke test, not merely a source assertion.
- Ambiguous context/session creation leaves a pending marker and does not retry.
  Reconcile the provider dashboard and the owner metadata before clearing that
  marker. Never clear it just to force a new session or reuse another user's ID.

## Importing an already authenticated trial

Optional server-only `GOGO_BROWSER_CONTEXT_IMPORTS` is JSON shaped as
`{ "exact-sandbox-name": { "provider-host": "context-uuid" } }`.
Imports verify the Context's project. There is no global/shared default login.
Bind only an explicitly authorized user's known sandbox. Commerce currently has
its own owner namespace (`userId:commerce`); general browser tasks use `userId`.
Do not bind a single Context to simultaneous writers across those namespaces.

## Evidence and limits

The earlier live Swiggy trial proved human sign-in, authenticated reconnect,
saved Home address selection and a single Amul Taaza 1-litre carton listed at
INR77. That price is historical evidence, not a fresh quote. No cart was changed;
delivery fees, delivered totals and phone-cart handoff were not verified.

The isolated integration smoke test loaded Example Domain from a Vercel worker
through Browserbase and blocked an out-of-scope resource request. Both test
sessions were stopped afterward. A real endpoint mismatch (`connect.apse1`)
was found and fixed before production activation.

Website reachability is site-specific. Saved sessions can expire. A provider may
still require human sign-in or refuse access. This integration does not supply
MCP approval, invent deep links, guarantee mobile-app cart synchronization, or
establish complete delivered-price comparison.

## Rollback

Remove the runtime flag or set it to `local`, then redeploy the last validated
commit. Stop any live Browserbase sessions belonging to the rollout after human
takeover has ended. Cloud contexts remain separate from local Chromium profiles;
rollback may require signing in again. No cart/order rollback is performed.
