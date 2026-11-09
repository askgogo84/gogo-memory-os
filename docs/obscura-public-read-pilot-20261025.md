# Obscura public-read pilot — 25 October 2026

## Scope / exact release
- Upstream: https://github.com/h4ckf0r0day/obscura, Apache-2.0.
- Engine version: **v0.2.5**, `obscura-x86_64-linux-no-render.tar.gz`.
- Expected SHA256: `405b7d1b79a94f89be1dcad03edab3c48858568b5cb03b90d9e7dcbfda449b12` (GitHub release asset manifest).
- Main application feature gate: **OFF by default**. Existing Browserbase/Chromium continues to serve everyone.
- Feature flags on the server only:
  - `GOGO_OBSCURA_PUBLIC_READ=1`
  - `GOGO_OBSCURA_PILOT_HOSTS=www.example.com,books.toscrape.com` (exact hostname list, no wildcards)
- Never use the pilot for logged-in tasks, Vault, OTP/CAPTCHA, booking submission, payments, sends, account mutation, draft/fill actions, or Take Control.
- The pilot launches a **fresh disposable** Vercel Sandbox with the pinned binary, locks setup egress to upstream GitHub asset hosts, locks page egress to existing AskGogo allowlist, reads one page, and stops the sandbox in finally.
- Obscura output does NOT certify a completed task. An observed page must pass existing AskGogo login/block/location gates and `assessReadOutcome` evidence checks; otherwise the normal existing browser runs. An errored or unsupported pilot simply yields null on an eligible read.

## Mandatory release gates — no production enablement yet
1. Run `npx tsx scripts/verify-obscura-pilot.mts`.
2. GitHub CI at exact head: full registered regression, `npm run typecheck`, fixture production build.
3. **Real engine check** on reviewed Linux compute: verified SHA download, executable/version, 1 static page, 1 JavaScript-rendered page, outbound host restriction, 1 redirect/login blocker. Stop all test sandboxes.
4. Validate the Vercel Sandbox runtime's glibc: upstream Linux builds require **glibc 2.35+**, and the current AskGogo sandbox image may not satisfy that. A release build passing Next.js does **not** prove a browser executable can run in the runtime.
5. Manual safe comparison against Browserbase/Chromium at identical public URL, same source/time, same client location, collect successful read correctness, time-to-evidence, memory/compute cost and failure category. Never compare an old observed price with a new one as if current.
6. Independent security review for redirect/DNS/subresource egress and downloaded binary, plus owner-authorized production canary of exact hostname(s).
7. Only after those checks should the runtime flag be enabled for a limited population. Do not globally replace Browserbase.

## Pilot test cases
| Test | Action | Pass condition |
|---|---|---|
| OBSC-01 | Public static HTML page and title | Real title/body and observed source; neither empty nor an invented answer |
| OBSC-02 | Public JS-rendered content | Text from actual page after scripts settle; no fabricated product cards |
| OBSC-03 | Flipkart/Croma retail product page read-only | Exact item/variant, observed offer price, source/time or honest incomplete |
| OBSC-04 | Restaurant listing or read-only research | Restaurant/area/date/party source observed; no claimed live reservation slots |
| OBSC-05 | Redirect to login/CAPTCHA/WAF | Block or fallback; no misleading successful result and no automated challenge solving |
| OBSC-06 | Domain/IP/userinfo/private query/SSRF tests | Reject unsafe target and cross-host navigation |
| OBSC-07 | Intent mutation/credential/handoff | Obscura never starts; existing approval/Vault/browser path is authoritative |
| OBSC-08 | Cold binary/startup failure or source mismatch | No price/booking hallucination; existing browser fallback |
| OBSC-09 | Owner isolation and cleanup | Unique disposable browser for each run, no cookie transfer, sandbox stops |
| OBSC-10 | Read evidence validator | Unsupported/empty/loader response cannot be marked complete |
| OBSC-11 | Site-specific cost and latency | Report measured median/p95 and evidence-quality pass percentage |
| OBSC-12 | Existing T1–T11 + addenda regression | No baseline functionality or safety gates regress |

**Evidence vocabulary:** implemented != unit-tested != CI-pass != preview-deployed != production-enabled != live-tested != accepted.

## BrowserOS/Obscura limitations
This engine implements its own DOM, JS and networking and does **not** guarantee Chrome parity. The vendor's memory/speed figures are not AskGogo benchmarks. Protected websites can refuse access legitimately. Enforce terms and robots/site restrictions as applicable; the pilot does not bypass account authentication, CAPTCHA, WAF or rate limits. Real signed-in flows remain on the established Browserbase/Vault/Take Control until independently tested.

## Follow-ups after the read-only pilot
- Provider-by-provider reliability matrix for prices, product variants, delivery pincode/address, restaurant area, party size/date/time, historical vs real-time availability.
- Optional persistent Obscura session adapter only if security/profile persistence, cross-owner isolation, lost-session recovery, and human takeover independently pass. Never transfer existing Browserbase cookies to Obscura automatically.
- Operator UI must show why a provider blocked and safe continuation; the Vault stores only evidence/checkpoints and allowed session metadata, not page instructions or secret values.
- No automatic bookings, account changes, checkout or sends from an unverified Obscura browser.
