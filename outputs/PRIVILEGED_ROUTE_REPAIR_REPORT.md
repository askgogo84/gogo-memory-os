# Privileged Route Authorization — Repair Report

**Date:** 2026-10-01 (overnight)
**Base commit:** `5cb08c9925f95b9e4dde7b99f21439e40c2292ec` (main / production HEAD at handoff)
**Branch:** `fix/privileged-route-authorization`
**Final commit:** `c657be7a` (pushed HEAD containing the full repair; this SHA line corrected in a trailing doc-only commit). See §Final commit.
**Scope:** authorization only, for the routes named in `outputs/ASKGOGO_READINESS_REPORT.md` §Bug A. No memory/learning/watcher/train/browser work. No new libraries, no schema changes, no deployment, no merge.

> **PRODUCTION IS UNCHANGED.** This is an un-merged, un-deployed branch. The live exposure is NOT closed until this branch is merged and deployed. Do not treat this report as remediation of production.

---

## 1. Confirmed exposures and local reproducers

All routes below instantiate the Supabase **service-role** client and, before this change, performed privileged reads/writes with **no authentication**. Two were verified by direct code read during the readiness pass; the rest share the identical shape (service-role client + caller-supplied `phone`/id + no guard).

| Route | Exposure (pre-fix) | Evidence |
|---|---|---|
| `GET /api/admin/stats` | Returns table counts + latest 10 users' PII (`name, whatsapp_id, telegram_id, tier`) with no auth | `app/api/admin/stats/route.ts` (pre-fix): `GET()` opened straight into the service-role queries |
| `POST /api/todos` | add/mark-done/list/**clear** any user's todos by body `phone` | `app/api/todos/route.ts` |
| `POST /api/contacts` | save/recall/list any user's contact notes by body `phone` | `app/api/contacts/route.ts` |
| `POST/GET /api/expenses` | log/read any user's expenses by `phone` | `app/api/expenses/route.ts` |
| `POST /api/news` | read/write any user's `news_topics` by `phone` | `app/api/news/route.ts` |
| `POST /api/skin-reminder` | insert a reminder for any user by `phone` | `app/api/skin-reminder/route.ts` |
| `POST /api/briefing` | assemble a full briefing (reminders/todos/followups/notes) for any `phone` | `app/api/briefing/route.ts` (GET already had `?secret=CRON_SECRET`) |
| `POST /api/reminders/create` | insert a reminder **and overwrite another user's timezone** by `phone` | `app/api/reminders/create/route.ts` (no in-repo caller) |
| `GET/POST /api/referral` | read/mint a user's referral code + paid-referral count, set `referred_by`, by `phone` | `app/api/referral/route.ts` (no in-repo caller) |

**Local reproducer (behavioral, no production PII touched):** `scripts/verify-privileged-route-auth.mts` transpiles and executes each **actual route handler** with a mocked Supabase/session boundary and a request-spy. Pre-fix, an unauthenticated `POST /api/todos` with a victim `phone` reaches `supabase.from('todos')`; post-fix it returns 401 with **zero** `.from()` calls. Run it alone:

```
. .\scripts\load-env.ps1
npx tsx scripts/verify-privileged-route-auth.mts
```

No live HTTP reproducer was run against production (the readiness report already documented `GET /api/admin/stats` → 200 + PII as the code-level proof; it was **not** re-exercised here, per "do not retrieve production PII").

---

## 2. Files changed and why

### Authentication infrastructure (reused, not new)
- **`lib/security/cron-auth.ts`** — added `isInternalServiceAuthorized(request)` and `internalServiceAuthHeaders()`. `isInternalServiceAuthorized` delegates to the existing `isCronAuthorized` (timing-safe `Authorization: Bearer <CRON_SECRET>` check, fail-closed when the secret is unset). `internalServiceAuthHeaders()` returns the matching `Authorization` header for trusted internal callers, emitting an empty Bearer (→ downstream 401) when the secret is unset, so nothing degrades to a permissive fallback. No new env var, library, or table: it shares the `CRON_SECRET` already provisioned for cron.

### Admin authority
- **`app/api/admin/stats/route.ts`** — `GET()` now calls `requireAdminSession()` (the existing session→`users.whatsapp_id`→`isAdminPhone` guard, PR #160's infra) and returns its `{status}` before any query. Unauthenticated → 401; authenticated non-admin → 403; admin → proceeds.

### Internal-service authorization (bot-action routes)
Each handler now rejects with 401 via `isInternalServiceAuthorized(req)` **before** reading the body or touching the database:
- **`app/api/todos/route.ts`**, **`app/api/contacts/route.ts`**, **`app/api/news/route.ts`**, **`app/api/expenses/route.ts`** (POST **and** GET), **`app/api/skin-reminder/route.ts`**, **`app/api/briefing/route.ts`** (POST only; GET keeps its existing `?secret=CRON_SECRET` guard).
- **`app/api/reminders/create/route.ts`**, **`app/api/referral/route.ts`** (GET+POST) — same guard, applied fail-closed. These have **no in-repo caller** (see §4); gating (rather than deleting) closes the exposure without an irreversible removal of a route that could have an out-of-repo caller (e.g. a future mobile client).

### Internal callers updated (so legitimate traffic still works)
- **`lib/feature-intents-legacy.ts`** — the bot pipeline's server-to-server `post()`/`get()` helpers now attach `internalServiceAuthHeaders()`. This is the sole caller of todos/contacts/expenses/news/skin-reminder/briefing.
- **`app/api/cron/reminders/route.ts`** — its direct `POST /api/briefing` fan-out now attaches `internalServiceAuthHeaders()` (the second briefing caller).

### Test + fixture
- **`scripts/verify-privileged-route-auth.mts`** — new behavioral test (see §5).
- **`scripts/verify-delivery-reliability.cjs`** — added `@/lib/security/cron-auth` to the mock map for its existing in-VM load of `cron/reminders/route.ts`; my new import would otherwise be an unmocked import in that fixture. (Fixture-only change; no production behavior touched.)
- **`package.json`** — wired `verify-privileged-route-auth.mts` into `npm test` after `verify-cron-followups-security.mts`.

---

## 3. Authentication & ownership behavior — before / after

| Route(s) | Before | After |
|---|---|---|
| `admin/stats` | Anyone → counts + 10 users' PII | Admin session required (`requireAdminSession`); 401/403 otherwise, zero DB on rejection |
| todos, contacts, expenses, news, skin-reminder, briefing (POST) | Anyone with a `phone` → that user's data | Internal-service Bearer (`CRON_SECRET`) required; 401 + zero DB otherwise. The bot pipeline is the trusted caller; the `phone` it passes was already resolved from the **signed webhook**, so it is the *target owner*, never the authorization |
| reminders/create, referral | Anyone with a `phone` → mint reminders / overwrite timezone / set referral | Internal-service Bearer required (fail-closed); no in-repo caller today |

**Ownership principle applied:** a caller-supplied `phone`/user-id is never authorization. Authorization is either (a) an authenticated admin session (`admin/stats`) or (b) the internal-service shared secret proving the caller is our own backend. Only after the caller is authenticated does the trusted-caller-supplied `phone` select the target owner. Every read/mutation in these handlers is already scoped by `whatsapp_id`/`telegram_id` to that owner; no cross-owner widening was introduced.

**Fail-closed:** if `CRON_SECRET` is unset, `isInternalServiceAuthorized` returns false and `internalServiceAuthHeaders()` emits an empty Bearer — both callers and routes fail to 401 rather than silently allowing traffic. (`CRON_SECRET` is already required by the cron routes and is present in production.)

---

## 4. Legitimate callers checked

Searched the repo (`lib`, `app`, `components`) for every route path:

- **todos, contacts, expenses (POST+GET), news, skin-reminder, briefing (POST)** — sole caller is `lib/feature-intents-legacy.ts` via `post()`/`get()` (server-to-server, from the WhatsApp/Telegram pipeline). **briefing (POST)** has a second caller: `app/api/cron/reminders/route.ts` (the briefing-keyword fan-out). Both callers were updated to send the internal header.
- **reminders/create** — **no caller** anywhere in the repo.
- **referral** — **no caller**; the referral feature (`lib/bot/handlers/referral-unlock.ts`) talks to Supabase directly, not through this route.
- **admin/stats** — **no caller**; no admin page fetches it. Guarded with admin authority.
- **`/api/waitlist`** — intentionally public marketing-site signup (CORS allowlist `askgogo.in`), not a per-user privileged route. **Left unchanged / out of scope** (requiring auth would break anonymous signup). Noted here so it is not mistaken for an unaddressed exposure.

Because reminders/create and referral have no legitimate caller, they were gated fail-closed rather than deleted — a reversible, bounded action that closes the exposure while preserving any out-of-repo caller path for a follow-up decision.

---

## 5. Behavioral test results

`scripts/verify-privileged-route-auth.mts` executes the **real handlers** (transpiled + run in a VM with mocked Supabase/session boundaries and a `.from()` call-spy). It does not grep source for guard names. Coverage:

- **Guard truth-table** (real `isInternalServiceAuthorized`/`internalServiceAuthHeaders`): missing header → reject; correct bearer → accept; wrong bearer → reject; **fail-closed when `CRON_SECRET` unset**; empty-secret header emits `Bearer `.
- **Missing authentication** — every bot-action route → 401, **zero** privileged DB calls.
- **Invalid authentication** — todos with `Bearer wrong` → 401, zero DB (no delete).
- **User A targeting User B** — unauthenticated caller supplying a victim `phone` → 401, zero DB (todos/contacts/expenses/skin-reminder/reminders-create/referral).
- **Authenticated non-admin → admin stats** → 403, **zero** PII query. Unauthenticated → 401, zero query. Admin → 200, `users` queried only after auth.
- **Malformed authorized request** — authorized + missing required field → 400, **zero** DB mutation (todos, news).
- **Valid authorized request** — internal-service bearer → guard passes and the handler proceeds to its DB work (todos insert; contacts read; expenses owner-lookup; skin-reminder/reminders insert; briefing user load).

Result: **all checks pass.** `privileged-route authorization verification passed`.

### Gate exit codes (captured immediately; run once after the repair)

| Gate | Exit code | Notes |
|---|---|---|
| `npx tsc --noEmit` | **0** | `outputs/repair-gate-tsc.exit` |
| `npm test` (full suite incl. the new check) | **0** | `outputs/repair-gate-test.log` / `.exit`. The new check runs and passes inside the suite. |
| `npm run build` | **0** | `outputs/repair-gate-build.log` / `.exit` |

**Gate run history (transparency):** the first `npm test` after the route edits failed at the existing `verify-delivery-reliability.cjs`, which loads `cron/reminders/route.ts` in a VM and threw on my new (unmocked) `@/lib/security/cron-auth` import — a failure **caused by this patch's new import**, fixed by adding the mock (§2). After that fix, the full suite passes (exit 0), re-verified via an isolated clean run. A transient `TEST_EXIT=1` observed mid-work was a stale exit-file artifact from the pre-fix run sharing the same path, not a real failure (the corresponding run subsequently reported exit 0). `tsc` and `build` were run once post-repair (both 0); the only edits after they passed were test scaffolding (`.cjs` fixture mock, `package.json` test list, the new `.mts`), none of which affect app compilation.

---

## 6. Remaining blockers

- **None blocking this branch.** All three gates pass.
- **Design note (not a blocker):** the bot-action routes remain thin server-to-server endpoints authenticated by a shared secret. A future hardening could fold these legacy features into in-process calls (removing the self-HTTP round-trip entirely) or behind the dashboard session for direct user access; out of tonight's scope.
- **Out of scope, still open** (tracked in the readiness report, not touched here): watcher dedup/cadence drift, fact-correction provenance, embedding-recall verification.

---

## 7. Safe post-deployment verification (for later approval — do NOT run against prod now)

After this branch is reviewed, merged, and deployed:

1. **Admin stats locked.** `curl -i https://app.askgogo.in/api/admin/stats` (no cookie) → expect **401/redirect**, not 200 + PII. With a signed-in admin session → 200.
2. **Bot-action routes reject external callers.** `curl -i -X POST https://app.askgogo.in/api/todos -H 'content-type: application/json' -d '{"phone":"+<your-own-test-number>","action":"list"}'` → expect **401**. (Use only your own test number; do not probe another user's phone.)
3. **Legitimate WhatsApp features still work.** From the test WhatsApp account: `add task buy milk`, then `tasks`; `spent 200 on lunch`; `morning` (briefing); `remind skin check in 2 weeks`. Each must reply normally — confirming the internal caller's Bearer header is accepted end-to-end.
4. **Reminder briefing fan-out.** Confirm the daily/keyword briefing still delivers (the `cron/reminders` → `/api/briefing` POST now carries the internal header).
5. **Regression watch:** confirm no spike in 401s on the bot-action routes in logs (would indicate `CRON_SECRET` mismatch between caller and route in the deployed env).

---

## Final commit
`c657be7a` — branch `fix/privileged-route-authorization`, pushed to origin, **not** merged, **not** deployed. Production remains unchanged.
