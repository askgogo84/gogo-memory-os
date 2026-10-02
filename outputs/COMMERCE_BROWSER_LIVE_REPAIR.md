# Browser live-journey repair — 2 October 2026

The user signed into AskGogo and authorized continuing the saved milk comparison. This report covers observed production failures, not speculative review findings.

## Reproduction on production 153a6ba8

- Saved grocery comparison: `2e231c89-f390-4b0b-b0c7-da535e586ebf`, Amul Taaza toned milk, 1 litre.
- Blinkit child `e6f7af0d-be83-43ac-843d-283fd2f52ff0`: provider access block. No availability or price was claimed.
- Instamart child `562aad80-8b28-4e9b-b5de-30e554465b78`: `SECURE_BROWSER_PLAN_FAILED` / `browser_planning_failed`. The actual production model request was rejected by Anthropic. The browser bypassed the existing configured OpenAI fallback. No platform balance check or top-up was performed.
- The same task's manual account/location handoff produced `502 SANDBOX_NOT_LISTENING`. Read-only sandbox command metadata showed the launch cwd was `/vercel`; the shared bootstrap installs Playwright in `/home/vercel-sandbox`. The server was written/required relative to the former, and returned a takeover URL after a fixed delay without proving readiness. A later module probe could not finish because the sandbox expired; do not represent that probe as a successful runtime root-cause test.
- Dashboard comparison and dashboard chat both showed the same saved child blockers. Independent WhatsApp delivery and phone cart opening are not verified.

## Repair

1. Browser action planning and evidence assessment use the existing configured provider fallback. Assessment keeps its system instruction role. Deterministic evidence validation still rejects claims not present in the observed page.
2. Handoff server is written and required by its absolute shared-runtime path, so Node resolves Playwright from the actual installation. Existing owner-lock location/protocol is preserved.
3. An authenticated loopback readiness check must pass before returning a control link. The endpoint returns only `{ready:true}`, not provider content. Failed readiness aborts the reserved handoff.

No schema, provider credentials, enabled integrations, cart contents, orders or payment settings changed. Persistent browser sessions still have the existing 20-minute sandbox lifetime.

## Regression evidence

- `verify-device-auth-handoff.mts` drives the real browser handler and real fallback module with mocked network SDKs. Primary rejection recovers for both planning and evidence assessment. Invented prices and dual-provider failure cannot become completed results. Existing execution/handoff guards stay covered.
- The handoff test checks the installed runtime path, readiness before returning, and rejection of a non-listening server.
- `verify-commerce-browser-lifetime.mts` verifies readiness requires authentication and returns no page data; existing same-page worker/human/worker continuity assertions remain.
- The existing general-planner source assertion is updated for the optional system-instruction argument.

Final local gates passed: all 155 commands in the existing package test manifest (exit 0, `outputs/browser-model-full-test.log`), TypeScript (exit 0, `outputs/browser-model-tsc.log`), and production build (exit 0, `outputs/browser-model-build.log`). No executable changes followed these gates. CI and release evidence are recorded in the handoff after completion. No fresh review round requested.

## Live acceptance after release

1. Open the existing comparison in AskGogo. Continue Instamart on this same task.
2. If the old session expired, report that explicitly; a fresh read must not claim the previous DOM or login survived.
3. Open the account/location handoff and verify that the actual provider page appears.
4. User completes any provider sign-in or delivery-location selection in that browser, then returns control and resumes the same task.
5. Verify source-backed product/availability/price evidence and matching saved status. Delivered fees/totals, cart preparation and phone-cart opening remain separate open acceptance requirements.
