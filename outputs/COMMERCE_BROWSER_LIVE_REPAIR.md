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

## Live retest on bcde6966 and provider page dependencies

PR #320 deployed as `bcde6966638ebfd8f629cc1683fe2dcdfb11cd00`, production `dpl_2fHPTvQzeazUgyQKGKcx5jwpETYT` READY. The existing task explicitly reported its expired live page. Reopening account/location control on the same child now loads the authenticated takeover UI instead of 502. Its actual provider screenshot remained blank.

A local browser at the identical public Instamart URL rendered its location/sign-in screen. Its DOM contained script sources on `media-assets.swiggy.com`, `instamart-media-assets.swiggy.com` and the specific provider WAF host `b67f7794189c.edge.sdk.awswaf.com`. The existing cloud allowlist admitted only `www.swiggy.com` and `*.www.swiggy.com`, excluding those page dependencies. The follow-up repair adds only those explicit dependencies for the exact Swiggy root/www hosts in both worker and handoff. It does not grant page text authority to add hosts or permit the unrelated analytics hosts observed in the DOM. Whether provider anti-bot controls independently block the cloud environment remains a live acceptance question.

After Return control and resume, the production log on bcde6966 shows the primary model rejection was handled through fallback and the result was `browser_objective_unverified`, not `browser_planning_failed`. Thus fallback recovered in production without inventing a result from the blank page. No provider sign-in or location entry was attempted.

The provider dependency tests cover both real worker/handoff policy paths, the exact allowed dependency set and unchanged unrelated-host behavior. Updated release/gate evidence is in the handoff.

## Cloud rendering diagnosis and repair (after e0f602c1)

An isolated, unauthenticated bom1 Sandbox using the production Chromium bootstrap and network policy reproduced the white viewport on both providers. Only status codes, public dependency hosts and rendering counts were exported; no user profile or private process logs were read.

| Public page | Original policy, actual Chromium | With the observed dependency admitted |
| --- | --- | --- |
| Swiggy Instamart | HTTP 202, `x-amzn-waf-action: challenge`, zero visible text; challenge script failed `net::ERR_NAME_NOT_RESOLVED` | Challenge script loads, then provider returns HTTP 403 with 92 visible characters |
| Zepto | HTTP 202, `x-amzn-waf-action: challenge`, zero visible text; challenge script failed `net::ERR_NAME_NOT_RESOLVED` | Challenge script loads, then provider returns HTTP 429 with an empty body |

The two missing hosts came from the providers' actual cloud HTML responses:

- Swiggy: `b67f7794189c.f957f42c.ap-south-1.token.awswaf.com`
- Zepto: `277df17f54ea.f4d9c26b.ap-south-1.token.awswaf.com`

These exact dependencies are now scoped to their respective provider. This lets the provider's normal browser script run; it does not solve a CAPTCHA, fabricate a challenge token, disable TLS verification, or grant arbitrary website-supplied hosts access. AWS documents the distinction between a 202 challenge and the normal page: https://docs.aws.amazon.com/waf/latest/APIReference/API_ChallengeAction.html

The shared worker/takeover page observer now distinguishes a loaded page from a pending security check, HTTP error, navigation failure and empty document. Workers give page rendering a bounded 12-second opportunity before returning a truthful blocked result. An empty challenge/403/429 no longer reaches the model planner or becomes a sign-in request. The takeover banner reports load problems; its authenticated health endpoint exposes only state and HTTP status.

Regression coverage is in the existing browser lifetime, proxy and device-handoff tests. The lifetime test executes the shared observer and reproduces 202-to-403, empty 429, navigation failure and recovery. The real handler test proves blocked pages never invoke the planner and never claim an authentication step.

**Remaining external blocker:** the existing cloud connection still receives provider refusals after the rendering dependency is fixed. A 403/429 alone does not prove whether IP reputation, automation detection, rate policy or another provider rule is responsible. No proxy purchase/configuration or anti-bot bypass was attempted. Successful storefront access, sign-in, saved addresses, delivered prices and cart/phone handoff remain unverified.
