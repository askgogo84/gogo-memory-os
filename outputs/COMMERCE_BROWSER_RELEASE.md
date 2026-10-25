# Commerce browser continuation — 2 October 2026

## Scope and finding

The user is pursuing official MCP access independently and asked to continue through the browser. MCP account connection remains disabled; this change does not claim provider approval.

Before this change, secure-computer launched a persistent *profile* for each action batch, navigated to the URL, then closed Chromium. Takeover launched another Chromium instance. Cookies could survive, but a live form, SPA state and sessionStorage were not preserved across the worker/takeover boundary.

Commerce reads now use a private Chromium daemon and attach over loopback CDP. Worker batches and takeover detach without closing it. A task marker prevents a different task or fresh daemon from silently pretending to resume a lost page. These changes are scoped to a separate per-user commerce browser; existing ticket/booking browser lifetimes remain unchanged. The existing 20-minute sandbox timeout still applies; this is not a promise of an indefinitely running browser or permanent login.

## User journey

The food/grocery comparison page offers **Use browser** without requiring MCP enable flags. Supported reads: Swiggy Food, Instamart, Zepto and Blinkit. Each browser child is linked to the owned comparison before any provider visit. The route rechecks ownership, request origin, execution permissions and the active parent. A per-owner lease and existing browser ownership lock prevent overlapping control.

The user can select **Choose account or delivery location in browser**, open the task, take control, complete provider sign-in/location selection, and resume the same task. OTP, CAPTCHA and password entry stay in the provider browser. Automated actions cannot run through the takeover endpoint while the human has control.

WhatsApp food/grocery status and the comparison page project the same saved child observations. They explicitly distinguish a completed browser read from a verified delivered-total comparison, cart write or phone-app handoff. No guessed prices or cart links were added. This implementation performs reads only; it does not add items, order or pay. Cart controls are blocked during read actions.

## Verification

- Actual route/executor fixtures: MCP disabled, ownership, origin, lease, permission recheck, parent link failure, same-task authentication resume, manual location takeover, closed parent, provider blockage and consistent chat/dashboard result.
- Actual embedded worker and takeover programs: action waves retain the page; takeover and return do not close its context; expired/replaced task fails; legacy cleanup unchanged; cart controls blocked.
- Real local Chromium: daemon → worker → action wave → human takeover → release → worker retained the page nonce, input value, sessionStorage and cookie. This used an isolated local page/profile, not a live provider account. Evidence: outputs/commerce-real-browser-lifetime.log. The optional probe uses an already-installed local Playwright/Chromium, with no new project dependency.
- Existing device-auth and Vault broker regressions passed.
- Final local gates: all 155 commands in the complete package test manifest passed (exit 0), TypeScript passed (exit 0), production build passed (exit 0). Logs: outputs/commerce-browser-full-test.log, outputs/commerce-browser-tsc.log, outputs/commerce-browser-build.log. The manifest was executed verbatim through Bash to avoid the Windows command-length limit; no test command was skipped. An initial invocation without the local environment failed; the full successful run loaded the already-existing environment with scripts/load-env.ps1. No production secrets were downloaded.
- Release branch: feat/commerce-browser-fallback, based on production 650b4108. Commit/deployment evidence is appended to COMMERCE_OVERNIGHT_HANDOFF.md after verification.

## Remaining live boundaries

The direct local cloud probe failed before reaching Swiggy because Vercel Sandbox credentials were unavailable in the local execution context. That is not evidence of a Swiggy bot block. No production secrets were downloaded. Production OIDC and real provider navigation still need a deployed journey.

Live sign-in, saved-address retrieval, provider fees, equivalent-basket totals, browser cart preparation/readback, and correct-cart opening in the user's phone app are NOT proven by this release. MCP approval does not block trying a browser read, but browser access/authentication may still block it. Cloud cookies do not establish that a cart will synchronize to a native app; that needs the same provider account and a real phone check.

## Numbered live checks after deployment

1. Send in AskGogo:

```text
Compare grocery prices for Amul Taaza toned milk, 1 litre
```

2. Open the returned comparison link. Under **Use browser**, choose **Check Blinkit** (or Instamart/Zepto). Account-connection approval must not block this browser action. A provider block or runtime failure must remain incomplete, with no invented price.

3. If account/location selection is needed, choose **Choose account or delivery location in browser**, open the browser task and **Take control**. Complete sign-in directly with the provider, select the intended saved address, return control and use **Resume this task**. Do not paste login codes into chat.

4. Return to the comparison and refresh. The task IDs must be unchanged. Then send:

```text
Show my grocery comparison.
```

The response and dashboard must agree on the observed result/blocker. Unknown fees stay unknown. This read must not claim to have prepared a cart.

5. Phone-cart acceptance remains OPEN. Do not mark it passed merely because a provider product link opens its app. A later explicitly requested cart operation requires exact item/account/address/quantity readback and a phone-side check.
