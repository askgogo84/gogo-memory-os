# 04 · Persistent Browser Diagnosis (READ-ONLY)

**Scope:** Why AskGogo's logged-in, persistent browser actions on the backend are
weak — diagnosed against the Wajo "Fo" competitor test (saved-login vault flow
acted inside the user's real Swiggy account and reused the cart; AskGogo built a
guest cart that never reached the user's account).

**Branch:** `claude/persistent-browser-diagnosis` · **Base:** `main` @ `4394c54`
**Method:** source read only. Every claim is anchored to `file:line`. Items with
no implementation are marked **NOT IMPLEMENTED**. No code was changed.

> **One-line verdict:** The logged-in session is *only* the on-disk Chromium
> profile inside a per-user Vercel Sandbox microVM that idles out after 20 minutes.
> Cookies are **never** exported to durable storage, there is **no positive
> "am I signed in?" check**, and verification confirms *that a click happened in
> the agent's browser* — never *that it happened in the user's account*. That is
> exactly the guest-cart failure the competitor test exposed.

---

## (a) 14-question answer table

| # | Question | Answer (with `file:line` evidence) |
|---|----------|------------------------------------|
| 1 | **Runtime / engine / where it runs / Vercel limits** | **Vercel Sandbox** (`@vercel/sandbox`) running **real Playwright Chromium** via `launchPersistentContext`. `Sandbox.getOrCreate({name, image:'vercel/sandbox/node:24', region:'bom1', timeout:20*60*1000, persistent:true})` — `secure-computer.ts:566-569`, region `secure-computer.ts:40`, image/profile `secure-browser-bootstrap.ts:55,65`. Chromium launched in-sandbox `secure-computer.ts:158,411`. Optional **Browserbase** managed mode behind `GOGO_BROWSER_RUNTIME==='browserbase'` (`managed-browser.ts:8`, region `ap-southeast-1`, IN proxy `managed-browser.ts:24`). The browser **physically runs inside the per-user microVM** `gogo-browser-v3-<sha256(userId)[:24]>` (`secure-browser-bootstrap.ts:43-46`). **Vercel-limit survival:** every browser-bearing route caps at the Pro max `export const maxDuration = 300` (`app/api/cron/autonomous-runs/route.ts:11`, `app/api/commerce/tasks/[runId]/browser/route.ts:9`, `app/api/agent/run/route.ts:33`, etc.); the read self-bounds at `READ_BUDGET_MS = 180_000` leaving ~120s for teardown (`secure-computer.ts:25-28`), and the in-sandbox worker self-kills at the deadline with `exit 124` (`secure-computer.ts:200-204`). The *long-lived host is the sandbox itself* (20-min persistent microVM); **cross-invocation continuation is DB-row + cron re-entry, not a background worker** (`vercel.json` crons; re-dispatch via `handleBrowserCommand` with `keepAlive:true,resumePage` `browser-command.ts:346-367`). No queue daemon. |
| 2 | **Session save — what/where/encryption/key/TTL** | **The session is the on-disk Chromium profile dir** `BROWSER_PROFILE_DIR = /home/vercel-sandbox/browser-profile` (`secure-browser-bootstrap.ts:65`) held by `launchPersistentContext(profile,…)` (`secure-computer.ts:158,411`; commerce daemon `persistent-commerce-browser.ts:13`). **Cookies/localStorage are never serialized out.** The DB stores **metadata only** in `vault_sessions` (`session-store.ts:38-57`; DDL `supabase/migrations/20260921171000_session_vault_v1.sql:6`): columns `telegram_id, provider, domain, credential_id, sandbox_name, profile_generation, status, auth_method, last_used_at, expires_at, metadata_json`. **No cookie/ciphertext/session-state column exists** (migration comment lines 2-4,34-35). **Key:** unique `(telegram_id, domain, sandbox_name)` (`session-store.ts:53`). **Encryption:** none needed — no secret is stored; only *credentials* are encrypted (`vault_credentials.username_ciphertext/secret_ciphertext` via `encryptVaultValue` `credential-store.ts:71-72`). **TTL:** `expires_at` is always written `null` (`upsertVaultSession` never sets it — `session-store.ts:48`); the *de facto* TTL is the sandbox's 20-min idle timeout. |
| 3 | **Session restore before first navigation?** | **Implicit and fragile — there is no explicit "load saved session" step.** A run calls `getComputer → Sandbox.getOrCreate` (`secure-computer.ts:564-566`); if the named sandbox is still alive, `launchPersistentContext` reopens the same profile dir and cookies are present; the first navigation happens right after (`inspect` `secure-computer.ts:645-646`). **No DB→browser cookie injection exists.** Fresh/**guest** browser results whenever the sandbox has expired, a new `SANDBOX_GENERATION` is cut (`'v3'` `secure-browser-bootstrap.ts:41`), or Browserbase mints a new context (`managed-browser.ts:79-90`). Note `vault_sessions.status` stays `'active'` even after the profile is gone — it is only re-validated on the *next* real login (`secure-computer.ts:978-993`). |
| 4 | **Session write-back at end of run?** | **MISSING for durable storage.** On non-`keepAlive` runs the microVM is stopped (`secure-computer.ts:1127,1135`); the persistent context flushes to the profile dir on `context.close()` (`secure-computer.ts:559`) but that dir lives only inside the (now idling) sandbox — **nothing is written back to Supabase**. `vault_sessions` is upserted **only** on a vault-credential `login_success` or `human_challenge` (`secure-computer.ts:983,1006`), never at normal run end, and even then stores no cookies. **Exception:** Browserbase mode persists the context provider-side (`context:{id,persist:true}` `managed-browser.ts:24`, "synchronized by the provider on close" `managed-browser.ts:75`) — that *is* durable write-back, but it is off by default and its context→id map (`managed-browser.json`) itself lives in the ephemeral sandbox. |
| 5 | **Logged-in detection before acting** | **One-sided — NO positive signed-in check.** The agent only detects the *negative*: `pageLooksLikeLogin` (`secure-computer.ts:612-619`) and `detectHumanAuthGate` (`browser-auth-gate.ts:33-88`). If a login wall/auth gate is seen it **pauses/blocks** (`secure-computer.ts:1025-1035`). But there is **no check that the account name / signed-in state is present** before acting. A site that silently serves a *guest* experience (e.g. Amazon/Swiggy cart without a login wall) is treated as fine and the agent **carries on as a guest** → the action lands in a throwaway guest context. **NOT IMPLEMENTED:** positive "is this the user's authenticated account?" verification. |
| 6 | **Login acquisition (no session)** | On `human_auth_required`, the caller messages the user on WhatsApp with a **vault-add link** `/dashboard/you/vault/add/<provider>` built by `buildVaultAddLink` (`connect-link.ts:12`; sent `browser-command.ts:403,410-418`; watcher `watchers.ts:725-734`) — "save your login securely, don't paste passwords/OTP here"; or a **"Take control" device-handoff** link `/dashboard/activity/<runId>/browser` (`secondary-auth-handoff.ts:46-47`; `browser-command.ts:394-398`). The user enters credentials on the dashboard Vault page → `saveVaultCredential` (`app/api/dashboard/vault/route.ts`, `credential-store.ts:47`). On the *next* run the secret is injected in-sandbox by `attemptVaultLogin` (`secure-computer.ts:621-641,964`) and on success `upsertVaultSession` records metadata **the moment login completes** (`secure-computer.ts:983`). **No provider-OTP relay exists** — provider OTP/passkey/CAPTCHA always route to human takeover (only AskGogo's *own* dashboard-login OTP exists: `lib/whatsapp.ts` `sendWhatsAppAuthOtp`, `lib/dashboard/whatsapp-otp.ts`). **Default country code `+91` / `Asia/Kolkata`** (`lib/waitlist/validate.ts:33`, `lib/dashboard/whatsapp-otp.ts:15`, `lib/timezone.ts:13`). |
| 7 | **Expiry / re-auth mid-run** | If the session expires mid-run and the page shows a login/auth gate, the run **blocks with a reserved handoff** (`secure-computer.ts:1024-1035`, final gate `1094-1101`). For non-password reasons `attachSecondaryAuthHandoff` sets the run `status:'paused'` and spins up a provider takeover (`secondary-auth-handoff.ts:17-48`); `resumeSecondaryAuthRun` continues **from the checkpoint** (`secondary-auth-handoff.ts:60-104`), and when a consequential action may already have fired (`safeToRetry=false`) it **does not retry** — it reconciles via `inspectPostAuthRun` and falls to `outcome_unknown` if the session is gone (`post-auth-outcome.ts:24-54`). A *password* expiry is retried by vault login at most **once per run** (guard `vaultAttempted` `secure-computer.ts:919,962`). **Silent-failure risk:** if the sandbox/handoff server has itself expired, release/resume returns `expired` (`browser-handoff.ts:120-131`) → `outcome_unknown`, not an automatic re-login. |
| 8 | **Concurrency — can two runs share one user's context?** | **No — serialized by an in-sandbox OS lock.** `acquireBrowserOwnerLock` holds `flock -n gogo-handoff.lock` for the run/takeover lifetime (`browser-owner-lock.ts:5-35`, acquired `secure-computer.ts:570`). Because there is exactly **one sandbox per user**, a second concurrent run contends on the same flock and is rejected with `browser_handoff_in_use` after 5 tries (`browser-owner-lock.ts:13-23`). Managed mode additionally refuses overlapping writers and waits 5s for provider sync (`managed-browser.ts:70-77`). **Caveat:** the lock is filesystem-local to that one microVM — it coordinates writers *within* a sandbox, not across a generation change. Within the current design, simultaneous corruption of one user's state is prevented. |
| 9 | **Action reliability — clicks / overlays / retries** | **Selector-based Playwright actions, not coordinates/vision.** `click/fill/select/check/search_enter` via `page.locator(selector)` (`secure-computer.ts:434-452`); selectors are *observed* real-DOM selectors from `selectorFor` (`secure-computer.ts:216-252`) chosen by the planner from `OBSERVED_CHOICES` refs (`secure-computer.ts:741-743,762-774`). **Vision/CUA is used only for human takeover** (screenshot + `page.mouse.click(x,y)` in `HANDOFF_SERVER` `browser-handoff.ts:49,53`), never for autonomous actions. **Overlays:** read-mode clicks that resolve to a plain link `goto` the href to dodge pointer interception (`secure-computer.ts:447-451`); pointer-intercept failures are coded `obscured` (`secure-computer.ts:530`). **No cookie-banner/popup dismissal logic exists.** **Retries:** each action is a single 10s-timeout attempt; read mode replans across up to `MAX_RESEARCH_WAVES=12` (`secure-computer.ts:24,926`); step-level retry/backoff is the autonomous runtime's `RETRY_MINUTES=[2,10,30,120]` (`autonomous-runtime.ts:9,276`). |
| 10 | **Post-action verification** | **Yes for "did a receipt appear", NO for "did it land in the user's account".** Execute mode snapshots the receipt before submit, waits for a *new* confirmation record, and requires `localExecutionConfirmation` or it throws `browser_objective_unverified` (`secure-computer.ts:456,462-522,843-890,1122-1125`). Draft verifies fields filled (`secure-computer.ts:544-553,1126`); read verifies grounded quotes (`assessReadOutcome` `secure-computer.ts:824-841,1110-1120`). **Places a success can be reported without account-level verification:** (i) **cart-add** is confirmed purely by on-page text "added to cart / 1 in cart" (`secure-computer.ts:850-858`) — a *guest* cart satisfies this exactly as a logged-in one would (**the competitor gap**); (ii) `inspectPostAuthOutcome` marks `completed` from retained-page confirmation text without re-reading identity (`post-auth-outcome.ts:49-54`); (iii) the persistent-commerce `keepAlive` read returns cart contents with no signed-in assertion. **Root issue: verification proves the *action*, never the *identity/destination*.** |
| 11 | **Handback — link in the user's browser or the agent's?** | **The agent's browser.** The takeover URL is served from the sandbox microVM at `https://sb-*.vercel.run/?token=…` (`provider-browser-handoff.ts:85-89`; health check `browser-handoff-health.ts:8`) and drives the *same* cloud Chromium via streamed screenshots + `page.mouse` (`browser-handoff.ts:49-57`). This is deliberate so the login persists in the sandbox for resume — but it means **the user never receives a working session/cart in their own browser or app.** The only link that opens in the *user's* browser is the vault-add page, and that merely stores credentials; it does not carry cart/session state across. So AskGogo **cannot** "carry over" a cart to the user the way the competitor claimed (and, per the test, the competitor also failed to). |
| 12 | **Domain policy — amazon / flipkart / swiggy / irctc** | **No navigation allowlist restricts providers** — `allowedHosts` only blocks localhost/private hosts (`secure-computer.ts:89-102`); any https host is browseable. **Vault password-login is supported for only 7 providers** (`providers.ts:12-55`): instagram, facebook, linkedin, **amazon.in**, **flipkart.com**, **irctc.co.in**, booking.com. So: **amazon.in** ✅ allowed + vault login (`providers.ts:31-36`, assets allowlisted `browser-page-network.ts:32`); **flipkart.com** ✅ allowed + vault login (`providers.ts:37-42`, `browser-page-network.ts:36`); **irctc.co.in** ✅ allowed + vault login but flagged for CAPTCHA/OTP→handoff (`providers.ts:43-48`); **swiggy.com** ⚠️ allowed for *read only* via residential proxy (`browser-proxy.ts:26-31`, assets `browser-page-network.ts:37`) but **has no vault provider entry at all** → a Swiggy login can never be saved → Swiggy is always guest-or-handoff. Swiggy is the single weakest target and the exact one the competitor test used. |
| 13 | **Production evidence SQL (project `qenhjcooyecmatwducpu`)** | Written, not run — see **section (e)**. Uses real tables `agent_runs`, `vault_sessions`, `vault_audit` and real columns. **Caveat surfaced by the schema:** there is **no per-run column recording "session loaded" or "written back"** — the query derives the best available proxies from `vault_sessions.status/last_used_at/auth_method` and `vault_audit` events joined by `telegram_id + domain`. |
| 14 | **Launch-master P0 audit (browser/vault/session/handoff)** | See **section (f)**. Summary: of the browser/session/handoff P0 lines, **only line 19** (idempotency/leases → `autonomous-runtime.ts` + `verify-autonomous-runtime.mts`, both exist and wired into `npm test`) carries a real, test-backed citation. **Lines 35, 73-77, 84-95 cite NO file and NO verify script** — the `[x]` marks on 73-77/85-86 are self-asserted with no evidence anchor. `scripts/verify-device-auth-handoff.mts` **exists but is NOT wired into `npm test`** (`package.json:11` is a hand-maintained `&&` chain with no auto-discovery). No `verify-browser-owner-lock` / `verify-secure-browser` / bare `verify-session`/`verify-vault` scripts exist. |

---

## (b) Six-step persistent-session lifecycle

> login once → save → restore → write back → verify after action → re-auth on expiry

| Step | State | Evidence & reason |
|------|-------|-------------------|
| 1. **Login once** | **WORKS (narrowly)** | Vault credential injected in-sandbox (`secure-computer.ts:621-641,964`); human takeover for OTP/passkey/CAPTCHA (`secure-computer.ts:1025-1035`). Only 7 providers can save a password; **Swiggy cannot** (`providers.ts:12-55`). |
| 2. **Save session** | **BROKEN** | Cookies live *only* in the sandbox profile dir (`secure-browser-bootstrap.ts:65`; `secure-computer.ts:158,411`). DB keeps **metadata only** (`session-store.ts:38-57`) — no cookie/storageState column (`20260921171000_session_vault_v1.sql`). Survives only ~20 min of sandbox idle (`secure-computer.ts:567`). |
| 3. **Restore session** | **BROKEN / MISSING** | No explicit restore; depends entirely on the sandbox + profile dir still being alive (`secure-computer.ts:564-566`). No DB→browser cookie injection. Sandbox expiry or `SANDBOX_GENERATION` bump (`secure-browser-bootstrap.ts:41`) → silent guest session while `vault_sessions.status` still reads `'active'`. |
| 4. **Write back after run** | **MISSING** (default) | `sandbox.stop()` ends the microVM (`secure-computer.ts:1127,1135`); nothing persisted to durable storage. Only Browserbase mode writes back provider-side (`managed-browser.ts:24,75`) and it is off by default. |
| 5. **Verify after action** | **PARTIAL / MISLEADING** | Receipt/confirmation verification is solid (`secure-computer.ts:456-522,843-890,1122-1125`) but verifies the *action*, not the *account*. A guest "added to cart" passes (`secure-computer.ts:850-858`). No signed-in assertion anywhere (ties to step-5 of Q5/Q10). |
| 6. **Re-auth on expiry** | **PARTIAL** | Checkpoint pause+resume works for reserved handoffs (`secondary-auth-handoff.ts:17-104`); irreversible-action safety (`outcome_unknown`) works (`post-auth-outcome.ts:24-54`). But expired sandbox/handoff → no auto re-login; password re-auth is one attempt per run (`secure-computer.ts:919,962`). |

**Net:** steps 2, 3, 4 — the heart of "stay logged in across runs" — are **BROKEN/MISSING** in the default (non-Browserbase) runtime. The system *appears* to persist sessions because a sandbox often survives between back-to-back cron ticks, but there is no durable, portable session store, so any gap longer than the sandbox idle window logs the user out with no signal.

---

## (c) Failure modes, ranked by user impact

1. **Guest action masquerading as a real one (HIGHEST — the competitor gap).** No positive signed-in check (Q5) + verification that only proves a click produced on-page text (Q10) means the agent can "add to cart / place order prep" inside a *guest* or *expired* session and report success. The user's real account never changes. Evidence: `secure-computer.ts:612-619` (negative-only detection), `secure-computer.ts:850-858` (cart confirmed by page text), no identity assertion anywhere. **This is precisely the empty-Amazon-cart outcome.**
2. **Silent logout between runs (HIGH).** Session = sandbox profile dir with a ~20-min idle TTL and no write-back (Q2/Q4). A run an hour later starts as a guest while `vault_sessions.status='active'` lies about it (`secure-computer.ts:978-993`, `20260921171000_session_vault_v1.sql`). Any `SANDBOX_GENERATION` bump wipes *every* user's saved session at once (`secure-browser-bootstrap.ts:41`).
3. **Swiggy (and any non-provider site) can never hold a login (HIGH for the tested flow).** Swiggy has no vault provider entry (`providers.ts:12-55`), so it is always guest-or-handoff — the exact site the competitor demoed.
4. **Handback never reaches the user's own browser (MEDIUM-HIGH).** Takeover is the agent's cloud browser (`provider-browser-handoff.ts:85-89`); the user cannot be handed a working cart/session in their own app (Q11).
5. **Expiry during an irreversible step → `outcome_unknown` dead-end (MEDIUM).** Correctly fail-safe, but the user must reconcile manually with the provider (`post-auth-outcome.ts:24-54`); no automatic recovery.
6. **No overlay/cookie-banner handling + single-attempt clicks (MEDIUM).** Interstitials/popups reduce reliability on real storefronts (`secure-computer.ts:434-452,530`); no dismissal logic.
7. **Unverified launch-master claims (MEDIUM, process risk).** The browser/session/handoff P0s are self-asserted without files or wired verify scripts (section f), so regressions in exactly this area are not caught by `npm test`.

---

## (d) Proposed fix plan — small, independent PRs (PLAN ONLY, nothing implemented)

Ordered by impact-per-risk. Each PR is independently shippable and testable.

- **PR-1 · Positive signed-in assertion before any consequential action.**
  Files: `lib/agent/browser-auth-gate.ts` (add `detectSignedInState(page)` reading account-name/greeting/logout-control signals), `lib/agent/secure-computer.ts` (gate execute/cart/draft-submit on it near `:1055,:1122`). New `scripts/verify-signed-in-gate.mts`, wire into `package.json:11`.
  Risk: low (fail-closed → one more pause/handoff). Directly closes failure mode #1.

- **PR-2 · Durable session write-back + restore (storageState).**
  Files: `lib/agent/secure-computer.ts` (`BROWSER_SCRIPT`/`VAULT_LOGIN_SCRIPT` export `context.storageState()` on close; inject via `addCookies`/`storageState` before first nav in `inspect`), new `lib/vault/session-state-store.ts` (encrypted blob via `lib/security/vault-crypto`), new migration adding `vault_sessions.state_ciphertext text` + `key_version int`. New `scripts/verify-session-state-roundtrip.mts`.
  Risk: medium (crypto + storage of sensitive cookies — must reuse `vault-crypto`, never log). Closes #2 and makes sessions portable across sandbox generations.

- **PR-3 · Session freshness truth in `vault_sessions`.**
  Files: `lib/vault/session-store.ts` (set a real `expires_at`; add `markVaultSessionStatus('expired')` when a restore finds no cookies), `lib/agent/secure-computer.ts` (downgrade status on guest-detection). Verify: extend PR-2's script.
  Risk: low. Stops the `status:'active'` lie behind #2.

- **PR-4 · Swiggy (and q-commerce) credential path.**
  Files: `lib/vault/providers.ts` (add `swiggy`/`zepto`/`blinkit` entries, phone-OTP-first note), confirm `browser-proxy.ts` coverage. New `scripts/verify-vault-provider-routing` case.
  Risk: low-medium (Swiggy is OTP-first → mostly enables handoff + session persistence, not password auto-login). Addresses #3.

- **PR-5 · Make Browserbase durable-context the default for logged-in commerce, with the context map in Supabase.**
  Files: `lib/agent/managed-browser.ts` (persist the `scope→contextId` map to a new `vault_browser_contexts` table instead of `managed-browser.json`), config flip of `GOGO_BROWSER_RUNTIME`. New migration + `scripts/verify-managed-context-persistence.mts`.
  Risk: medium-high (provider dependency, cost). Strongest long-term fix for #2/#4; keep behind a flag.

- **PR-6 · Overlay/cookie-banner dismissal + bounded click retry.**
  Files: `lib/agent/secure-computer.ts` (pre-action dismiss pass for `[role=dialog]`/consent banners; one bounded retry on `obscured`). Extend `scripts/verify-browser-search-controls.mts`.
  Risk: low-medium (must not auto-click consequential controls — reuse `isConsequentialControl`). Addresses #6.

- **PR-7 · Launch-master evidence anchors + wire orphan verifier.**
  Files: `AUTONOMOUS-LAUNCH-MASTER.md` (cite files + verify scripts on lines 35, 73-77, 84-95; only keep `[x]` where a wired script exists), `package.json:11` (add `scripts/verify-device-auth-handoff.mts`; consider a glob runner). Risk: none (docs/test wiring). Addresses #7.

**Sequencing:** PR-1 and PR-3 are safe immediate wins; PR-2 is the keystone durability fix; PR-4/PR-6 broaden coverage; PR-5 is the strategic option; PR-7 restores trust in the checklist. PRs are independent except PR-3 benefits from PR-2's restore path.

---

## (e) Q13 — read-only production evidence SQL

Supabase project **`qenhjcooyecmatwducpu`**. **Read-only; do not run blind — review first.**
The schema records **no per-run "session loaded / written back" flag**, so those two
columns are *derived proxies* from `vault_sessions` + `vault_audit`, clearly labelled.

```sql
-- Last 30 browser-capability agent runs, with user, domain, best-effort session
-- evidence, final status and error. Proxies are explained inline.
-- Tables/columns verified against: supabase/agent-os-v1.sql,
-- supabase/migrations/20260921171000_session_vault_v1.sql,
-- supabase/migrations/20260920170000_shared_vault_foundation.sql.
with browser_runs as (
  select
    r.id            as run_id,
    r.telegram_id,
    r.status        as run_status,
    r.error         as run_error,
    r.summary       as run_summary,
    r.started_at,
    r.completed_at,
    coalesce(
      r.metadata_json->>'browser_url',
      r.metadata_json->>'url',
      r.metadata_json->>'checkin_url'
    )               as browser_url,
    (r.metadata_json ? 'handoff')                 as had_handoff,
    r.metadata_json->'handoff'->>'sandboxName'    as handoff_sandbox,
    r.metadata_json->>'vault_credential_id'       as vault_credential_id
  from public.agent_runs r
  where r.capability = 'browser'
  order by r.started_at desc
  limit 30
),
runs_with_domain as (
  select
    br.*,
    lower(regexp_replace(
      split_part(split_part(coalesce(br.browser_url, ''), '://', 2), '/', 1),
      '^www\.', ''
    )) as domain
  from browser_runs br
)
select
  rd.run_id,
  rd.telegram_id,
  rd.browser_url,
  rd.domain,
  -- SESSION LOADED (proxy): an active vault_sessions row for this user+domain whose
  -- last_used_at is at/after run start implies the saved profile was reused.
  (vs.id is not null and vs.status = 'active'
     and vs.last_used_at >= rd.started_at)        as session_loaded_proxy,
  vs.status           as vault_session_status,
  vs.auth_method      as vault_session_auth_method,
  vs.sandbox_name     as vault_session_sandbox,
  vs.last_used_at     as vault_session_last_used_at,
  -- SESSION WRITTEN BACK (proxy): vault_audit records a login_success / resolve
  -- AFTER run start. (There is no true cookie write-back column in the schema.)
  wb.last_write_event as session_writeback_event_proxy,
  wb.last_write_at    as session_writeback_at_proxy,
  rd.had_handoff,
  rd.handoff_sandbox,
  rd.run_status,
  rd.run_error,
  rd.run_summary,
  rd.started_at,
  rd.completed_at
from runs_with_domain rd
left join lateral (
  select vs.id, vs.status, vs.auth_method, vs.sandbox_name, vs.last_used_at
  from public.vault_sessions vs
  where vs.telegram_id = rd.telegram_id
    and vs.domain = rd.domain
  order by vs.updated_at desc
  limit 1
) vs on true
left join lateral (
  select va.event_type as last_write_event, va.created_at as last_write_at
  from public.vault_audit va
  where va.telegram_id = rd.telegram_id
    and va.domain = rd.domain
    and va.event_type in ('login_success', 'credential_resolved', 'human_challenge')
    and va.created_at >= rd.started_at
  order by va.created_at desc
  limit 1
) wb on true
order by rd.started_at desc;
```

> If `agent_runs.capability` filtering is too narrow (some browser work is tagged
> via `metadata_json->>'plan_type' = 'secure_browser'`), widen the `where` to:
> `where r.capability = 'browser' or r.metadata_json->>'plan_type' = 'secure_browser'`.

---

## (f) Q14 — Launch-master P0 audit detail

`npm test` = a single hand-maintained `&&` chain of ~160 verifiers at **`package.json:11`**
(no auto-discovery; `typecheck` is separate at `:10`; `verify` = test + typecheck at `:12`).

| Master line | Item | `[x]/[ ]` | Cites file? | Cites verify script? | File exists? | Script exists? | Wired into `npm test`? |
|---|---|---|---|---|---|---|---|
| 19 | Retry w/ idempotency & leases | `[x]` | ✅ `lib/agent/autonomous-runtime.ts` | ✅ `scripts/verify-autonomous-runtime.mts` | ✅ | ✅ | ✅ |
| 35 | Device handoff (provider block/OTP/biometric/human) | `[ ]` | ❌ none | ❌ none | — | (`verify-device-auth-handoff.mts` exists, unreferenced) | ❌ **not wired** |
| 73 | BookMyShow link routing | `[x]` | ❌ none | ❌ none | — | — | — |
| 74 | Browser/provider retry handling | `[x]` | ❌ none | ❌ none | — | — | — |
| 75 | Cloudflare/device handoff | `[x]` | ❌ none | ❌ none | — | — | — |
| 76 | Ticket screenshot completion | `[x]` | ❌ none | ❌ none | — | — | — |
| 77 | Booking detail + credential attachment | `[x]` | ❌ none | ❌ none | — | — | — |
| 85 | Isolated browser foundation | `[x]` | ❌ none | ❌ none | — | — | — |
| 86 | Mobile browser context for providers | `[x]` | ❌ none | ❌ none | — | — | — |
| 87-95 | Read/extract, download, draft-fill, approval-gated submit, booking prep, controlled execution, audit evidence, provider block/auth/OTP/CAPTCHA handoff | `[ ]`×9 | ❌ none | ❌ none | — | — | — |

**Conclusion:** every browser/session/handoff P0 item except line 19 is either
unchecked or a `[x]` with **no traceable file and no wired verify script**. The
area most exposed by this diagnosis is the least test-covered. `verify-device-auth-handoff.mts`
is the one existing handoff verifier that `npm test` never runs. No
`verify-browser-owner-lock` / `verify-secure-browser` exists at all.

---

*Diagnosis only. No source files were modified. Fix plan in (d) is a proposal, not implemented.*
