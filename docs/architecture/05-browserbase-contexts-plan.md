# 05 · Browserbase Contexts migration plan (PLAN ONLY)

Branch: `claude/persistent-browser-diagnosis`. Companion to
[`04-persistent-browser-diagnosis.md`](./04-persistent-browser-diagnosis.md).

**Decision (owner-approved):** move persistent, logged-in browser actions onto
Browserbase **Contexts** (the existing `GOGO_BROWSER_RUNTIME==='browserbase'`
path), replacing reliance on the ephemeral Vercel Sandbox profile dir. Provider
stays swappable at the data layer (Steel Profiles is Plan B) by storing only a
generic `provider` + `external_identity_id` — never cookies.

**Confirmed production facts (Oct 2026):** Production *and* Preview run managed
mode (`GOGO_BROWSER_RUNTIME='browserbase'`, ap-southeast-1); `BROWSERBASE_API_KEY`,
`BROWSERBASE_PROJECT_ID`, `GOGO_BROWSER_CONTEXT_IMPORTS` set for both;
`VAULT_MASTER_KEY_V1` Production-only. Browserbase dashboard shows sessions
**leaking to the 1-hour timeout** (normal runs 33–45 s; leaked runs 01:00:0x);
last 7 days ≈ 10 h browser time / 797 MB proxy data.

Verified against live docs: Contexts (`POST`/`DELETE /v1/contexts`,
`browserSettings.context {id, persist}`, "wait a few seconds after a `persist:true`
close before reusing", "avoid multiple sessions on the same Context at once");
Proxies (`type: browserbase|none|external`, `geolocation {country,state,city}`,
per-domain `domainPattern` regex, first-match-wins). **No `@browserbasehq/sdk` or
`steel` dependency exists** — `lib/agent/managed-browser.ts` is a hand-rolled REST
client over `fetch`; Playwright is installed at runtime inside the sandbox.

---

# PR-0 — Session-leak HOTFIX (production-facing, ships first; implement only after plan approval)

## §0.1 Where a Browserbase session is created but `REQUEST_RELEASE` may never be sent

Session creation: `resolveManagedSession` → `api('sessions', managedSessionConfig(...))`
(`managed-browser.ts:87`), returning a `release` closure that sends
`REQUEST_RELEASE` (`managed-browser.ts:68` reused, `:90` created). Leak = any path
that reaches a live session without that closure being invoked.

| # | Leak path | Evidence | Why it leaks |
|---|-----------|----------|--------------|
| L1 | **Every `keepAlive` (persistent-commerce) run** | `secure-computer.ts:1127` releases `only if(!params.keepAlive)`; `getComputer` catch also guards `if(!keepAlive)` (`:583`). Session config is `keepAlive:true` (`managed-browser.ts:23`). | keepAlive runs return without `REQUEST_RELEASE`; `keepAlive:true` keeps the Browserbase session **alive after CDP disconnects**, so it runs to the provider timeout. |
| L2 | **Every `blocked`/handoff early return** (provider block, auth gate, delivery-location) | returns at `secure-computer.ts:935, 1034, 1041, 1100, 1103, 1108` all occur **before** the `:1127` release and are **not** covered by the catch (`:1135`) or the `finally` (`:1139-1140` releases only the owner-lock). | The auth-gate block is exactly the OTP/live-view handoff case (comment `:931-934` deliberately keeps the sandbox alive) — but the managed **session is never released**, so it leaks to timeout. **Prime suspect for the 1-hour sessions.** |
| L3 | **Provider/live-view handoff lifecycle** | `startProviderBrowserHandoff` creates a managed session (`provider-browser-handoff.ts:69`) but stores **no `release` handle**; success returns URLs (`:89`), catch only writes abort/removes transfer (`:90-94`). Handoff `/release` endpoint does `attached.close()` (`browser-handoff.ts:74`) = closes the **CDP connection only**. `releaseRunAuthHandoff` (`secondary-auth-handoff.ts:50-57`) and `cancelProviderBrowserHandoff` (`provider-browser-handoff.ts:15-21`) both call `releaseBrowserHandoff` → the same CDP close. | Nothing ever sends `REQUEST_RELEASE`; with `keepAlive:true`, closing CDP does **not** end the Browserbase session. Every OTP/live-view pause leaks until timeout. |
| L4 | **`ensureManagedBrowser` post-create failures** | session created (`managed-browser.ts:125`) then `updateNetworkPolicy` (`:127`), broker `writeFiles`/`runCommand` (`:131-133`) — **no `try/finally`** around them; `release` is only called on broker-not-ready (`:138`). | If `:127`–`:133` throw, the just-created session is never released. |
| L5 | **Sandbox death / Vercel function timeout while session open** | broker exits on `browser.on('disconnected')` (`managed-browser.ts:110`) with **no `REQUEST_RELEASE`**; `keepAlive:true` (`:23`). Sandbox is a 20-min microVM (`secure-computer.ts:567`); function cap 300 s. | When the microVM or function dies mid-run, CDP drops but the Browserbase session (keepAlive) survives to timeout. |

## §0.2 Session timeout / keepAlive passed today, and recommendation

**Today:** `managedSessionConfig` returns `{ …, timeout:1200, keepAlive:true, … }`
(`managed-browser.ts:23`) for **every** session — normal reads and handoffs alike.
`timeout:1200` is 20 min (Browserbase `timeout` is seconds), yet the dashboard
shows **1-hour** sessions, so either our `timeout` is not being honored (field/shape
mismatch — to verify) or the leaked sessions hit the project/plan max. Combined
with `keepAlive:true`, a disconnected session is **designed to stay alive**, which
is wrong for normal runs.

**Recommendation (check against the two long-session docs before coding):**
- `platform/browser/long-sessions/timeouts.md` — confirm `timeout` units/seconds and plan max.
- `platform/browser/long-sessions/keep-alive.md` — confirm `keepAlive` semantics on disconnect.
- **Normal runs:** `keepAlive:false` and a short explicit `timeout` (~90–180 s, aligned to `READ_BUDGET_MS=180_000` `secure-computer.ts:28`). With `keepAlive:false`, a CDP disconnect ends the session promptly — defence in depth even if a release is missed.
- **Paused handoffs:** `keepAlive:true` with a bounded explicit `timeout` (~600–900 s, matching the 300 s function cap + human think-time, not 1 h), **plus** an explicit `REQUEST_RELEASE` when the human returns/cancels or the run resolves.

## §0.3 Can a leaked session still hold a context while a new session opens on it?

Yes, when state is lost. `resolveManagedSession` only releases-before-reuse when it
*knows* about the prior session via `state.session` (`managed-browser.ts:63-77`),
and `state` is loaded from `managed-browser.json` **inside the sandbox**
(`:39`, store `:117-124`). If the sandbox died (the common leak case), the new
sandbox has no `state.session`/`state.contexts` record, so the broker opens a
**new** session; if `GOGO_BROWSER_CONTEXT_IMPORTS` pins the same context id
(`:51-59`), that new session targets the **same context the leaked session still
holds** — the exact "multiple sessions on one Context" the docs warn against.

## §0.4 How many contexts per user per domain over time? Is any ever deleted?

Because the context→id map lives only in `managed-browser.json` inside the
ephemeral sandbox (`managed-browser.ts:10, 119-123`) and the owner key is the
deterministic sandbox name `gogo-browser-v3-<sha256(userId)[:24]>`
(`secure-browser-bootstrap.ts:43-46`): **without `GOGO_BROWSER_CONTEXT_IMPORTS`,
each new sandbox lifecycle mints a brand-new context per (user, domain)** at
`managed-browser.ts:79-84` — unbounded growth, and the previously-persisted login
is abandoned (fresh/guest). **With** imports set, the pinned context is reused for
that scope (bounded), but other scopes still mint new ones. **No context is ever
deleted** — there is no `DELETE /v1/contexts` call anywhere in the codebase. So
contexts accumulate indefinitely, and (combined with §0.1) orphaned *sessions*
accumulate until timeout.

## §0.5 PR-0 plan — guaranteed release + explicit timeouts + orphan sweep

**Files touched (hotfix, minimal):**
- `lib/agent/managed-browser.ts` — wrap post-create (`:125-139`) in `try/finally` so `release()` runs on any failure; split `managedSessionConfig` into `normal` (`keepAlive:false`, short `timeout`) vs `handoff` (`keepAlive:true`, bounded `timeout`); add `releaseManagedSessionById(sessionId)` that sends `REQUEST_RELEASE` by id (so handoff teardown can release without the original closure).
- `lib/agent/secure-computer.ts` — move managed `release` into a `finally` that covers **all** returns incl. the `blocked` ones (`:935,1034,1041,1100,1103,1108`); for `keepAlive`, record `managedSessionId` into the run metadata/handoff so teardown can release it.
- `lib/agent/browser-handoff.ts` / `provider-browser-handoff.ts` / `secondary-auth-handoff.ts` — persist `managedSessionId` alongside `handoff`; on `/release`, `/return`, `cancelProviderBrowserHandoff`, and `releaseRunAuthHandoff`, call `releaseManagedSessionById` **in addition to** closing CDP.
- `lib/agent/browser-session-sweeper.ts` (new) + `app/api/cron/browser-session-sweep/route.ts` (new) + `vercel.json` cron entry — a **release sweep**: list `RUNNING` sessions for the project via `GET /v1/sessions?status=RUNNING`, and `REQUEST_RELEASE` any whose age exceeds a threshold AND that are **not** referenced by a live handoff (check `browserHandoffIsLive`, `browser-handoff-health.ts:4`) or an in-flight run.
- Verify: `scripts/verify-browser-session-release.mts` (wired into `package.json` test chain) — asserts (a) normal-run finally releases on success/blocked/throw via a fake fetcher, (b) handoff teardown issues `REQUEST_RELEASE` by id, (c) sweeper spares sessions backed by a live handoff and releases aged orphans.

**Risks:** releasing a session a human is mid-takeover on → sweeper MUST gate on
`browserHandoffIsLive` + an age floor; a release/resume race → release by id is
idempotent (`REQUEST_RELEASE` on an ended session is a no-op) and resume re-opens a
fresh session on the same context; changing `keepAlive`/`timeout` must not shorten
legitimate handoffs (hence the separate handoff config). PR-0 is **behaviour-safe
when the allowlist is unset** (see §B/(h)) because it only *adds* releases and
timeouts; it does not change who gets managed mode.

**Read-only orphan-listing script plan (one-off, deletes nothing):**
`scripts/list-orphaned-browserbase.mts` (not wired into tests) — `GET /v1/sessions`
(filter `status=RUNNING`, definitely listable) and, to enumerate contexts, verify
whether a project-scoped **`GET /v1/contexts` list endpoint** exists (today's code
only uses `GET /v1/contexts/{id}` `managed-browser.ts:56` and `POST`/none for list);
if no list endpoint, derive the context set from `created`/`userMetadata` on the
sessions instead. Output a table of `sessionId, contextId, age, userMetadata.owner,
status` and flag sessions with age > 1 min and no live handoff. **Prints only; never
calls `REQUEST_RELEASE` or `DELETE`.** Run manually to size the backlog before
enabling the sweeper.

---

# §A — Target design (points 1–8, with owner amendments)

1. **One context per (telegram_id, canonical-domain)**; store only `provider`,
   `external_identity_id` (the Browserbase context id), `status`, `last_verified_at`
   in a **new provider-neutral table** `vault_browser_identities` (§C). Never store
   cookies. (Replaces the sandbox-local `managed-browser.json` map.)
2. **Every managed session uses `context { id, persist:true }` — including reads.**
   *(Amendment (a): PR-C dropped.)* Sites rotate cookies on reads; `persist:false`
   would discard refreshed logins. Concurrency safety comes from the PR-G lock, not
   from `persist:false`.
3. Region `ap-southeast-1`; built-in proxy `geolocation.country:'IN'`; stable
   per-user settings across runs; **per-domain proxy routing** via `domainPattern`
   so `irctc.co.in`/bank domains can use `type:'none'`. Timezone Asia/Kolkata only
   as the techniques doc supports *(amendment (e))*.
4. **Owner-lock keyed on `external_identity_id`** (durable, cross-sandbox): never two
   live sessions on one context; honour the mandated post-`persist:true` sync wait.
5. **Positive logged-in check at the start of every run** per domain (amazon.in,
   flipkart.com, swiggy.com first). If logged out: pause, send **one** short-lived
   single-use reconnect link, save the login with `persist:true` on the **same**
   context, resume. **Never continue as guest for account actions.**
6. **Post-action verification** for state-changing steps (re-read cart count/line
   item after add-to-cart) before any success message.
7. **Disconnect:** user disconnects a site → `DELETE /v1/contexts/<id>` + delete the
   DB row.
8. **Staged flag:** Preview → per-user allowlist → all; Vercel Sandbox path stays as
   fallback. See the production-safety rule in (h).

---

# §B — PR roadmap (amended order)

> **Amendment (b) order.** PR-C is dropped. PR-F and PR-H are **mandatory before any
> non-owner user is on the allowlist.** PR-0 implemented only after its plan is
> approved.

| PR | Scope | Key files | Risk | Verify script (→ `npm test`) |
|----|-------|-----------|------|------------------------------|
| **PR-0** | Leak hotfix (above) | `managed-browser.ts`, `secure-computer.ts`, handoff trio, new sweeper + cron | med (teardown correctness) | `verify-browser-session-release.mts` |
| **PR-1 = PR-I + PR-A** (additive, shipped dark) | Rollout resolver `managedBrowserEnabledFor` + identity store + migration + canonical site-key map; **not called from any runtime path yet** | `managed-browser.ts`, new `lib/vault/browser-identity-store.ts`, new migration | low | `verify-managed-rollout-flag.mts`, `verify-browser-identity-store.mts` |
| **PR-B** | Persist context id to `vault_browser_identities` (replace the sandbox-file map + remove reliance on `GOGO_BROWSER_CONTEXT_IMPORTS`) | `managed-browser.ts` store (`:117-124`) | med (identity source change; keystone) | `verify-managed-context-persistence.mts` |
| **PR-D** | Positive logged-in gate + one-tap reconnect + resume (never guest) — **mockup gate, see (f)** | new `lib/agent/browser-signed-in.ts`, `secure-computer.ts`, `browser-command.ts` | med (fail-closed → more pauses) | `verify-signed-in-gate.mts` |
| **PR-E** | Post-action account-scoped re-read before success | `secure-computer.ts` (`localExecutionConfirmation` `:843-890`) | med | `verify-post-action-account-state.mts` |
| **PR-G** | Durable lock keyed on `external_identity_id` + post-close sync wait | new `lib/agent/browser-context-lock.ts`, `managed-browser.ts` | med | `verify-browser-context-lock.mts` |
| **PR-F** *(mandatory pre-multi-user)* | Per-domain proxy routing (`domainPattern:none` for irctc/banks) + stable fingerprint + Asia/Kolkata timezone per docs | `managed-browser.ts` `managedSessionConfig` | low | `verify-managed-proxy-routing.mts` |
| **PR-H** *(mandatory pre-multi-user)* | Disconnect → `DELETE /v1/contexts` + delete row | `managed-browser.ts`, new `app/api/dashboard/vault/[...]/disconnect/route.ts` | low | `verify-browser-disconnect.mts` |

Dependency spine: **PR-0 → PR-1 → PR-B → PR-D → PR-E → PR-G**, with **PR-F & PR-H
before the allowlist grows beyond the owner.**

---

# §C — DB migration SQL (project `qenhjcooyecmatwducpu`; write, do not run)

**Amendment (c):** `telegram_id` is **`text`**, matching `vault_sessions.telegram_id`
(`supabase/migrations/20260921171000_session_vault_v1.sql`) — WhatsApp users have
**negative** numeric ids stored as text (e.g. `'-1001234567890'`).

```sql
-- Provider-neutral durable browser identity (Browserbase contextId today, Steel profileId later).
-- Stores ONLY a pointer to provider-held session state. Cookies/localStorage are NEVER stored here.
create table if not exists public.vault_browser_identities (
  id                   uuid primary key default gen_random_uuid(),
  telegram_id          text not null,                       -- SAME type as vault_sessions.telegram_id; negative ids ok
  domain               text not null,                       -- canonical site key (see §D), NOT raw host
  provider             text not null default 'browserbase'
                         check (provider in ('browserbase','steel')),
  external_identity_id text not null,                        -- Browserbase contextId / Steel profileId
  status               text not null default 'active'
                         check (status in ('active','needs_reauth','expired','revoked')),
  last_verified_at     timestamptz,                          -- last positive signed-in confirmation
  lease_until          timestamptz,                          -- durable per-identity lock (PR-G)
  lease_owner          text,                                 -- run/worker token holding the lease
  metadata_json        jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (telegram_id, domain, provider)
);

create index if not exists vault_browser_identities_lookup
  on public.vault_browser_identities (telegram_id, domain, status);

alter table public.vault_browser_identities enable row level security;
-- Service-role only (no anon/authenticated policies), matching vault_sessions / vault_credentials.

comment on table public.vault_browser_identities is
  'Durable pointer to a provider-held browser session (Browserbase Context / Steel Profile). No cookies stored.';
```

---

# §D — Canonical site-key map (amendment (d))

`domain` is a **canonical site key**, not the raw host. A small explicit map in
code (no new library); unknown hosts fall back to the `www.`-stripped host.

```
amazon.in     ← www.amazon.in, amazon.in, m.amazon.in, (amazon.in sign-in paths)
flipkart.com  ← www.flipkart.com, flipkart.com, m.flipkart.com
swiggy.com    ← www.swiggy.com, swiggy.com (Instamart lives under swiggy.com)
irctc.co.in   ← www.irctc.co.in, irctc.co.in
*             ← fallback: host with a leading "www." removed
```

This keeps `www.`/`m.`/login-subpath variants on **one** context per site, so a
login saved on `www.amazon.in` is reused for `amazon.in/m.amazon.in`. Lives beside
`normalizeVaultDomain` (`lib/vault/domain-policy.ts:1`) and the current `managedScope`
www-strip (`managed-browser.ts:16-20`).

---

# §E — Acceptance test (PR-B merge, end-to-end)

1. **Login once:** connect amazon.in → a `browserbase` session with
   `context{id,persist:true}` saves the login → row
   `(telegram_id,'amazon.in','browserbase',<contextId>,status='active',last_verified_at=now)`;
   **no cookies in our DB.**
2. **Hours later** (original sandbox gone): *"Add Sony WH-1000XM5 to my Amazon cart.
   Don't buy."* → resolves the stored `contextId`, opens a `persist:true` session,
   **logged-in gate passes** (account visible; `last_verified_at` refreshed), adds to
   cart, **re-reads cart = +1 that item** before replying success.
3. **User's own Amazon app:** the item is in their real cart (same persisted context).
4. **Next day:** *"Check my last 3 Amazon orders"* runs **with no re-login**; if Amazon
   expired it, the user gets **exactly one** reconnect link, never a silent guest read.

Pass = steps 2–4 green, zero guest fallbacks, `tsc` clean, segmented `npm test` green
incl. new verifiers.

---

# §F — Switching provider to Steel later

Confined to **session creation + the stored `provider` value**. A sibling of
`resolveManagedSession` (`managed-browser.ts:34-91`) calls Steel's Sessions API with
`persistProfile:true` + `profileId` (Steel's equivalent of `context{id,persist}`) and
connects over Steel's CDP/websocket URL; `external_identity_id` then holds the Steel
`profileId`, `provider='steel'`. Everything provider-neutral is unchanged — the
`vault_browser_identities` schema, the logged-in gate (PR-D), the identity-keyed lock
(PR-G, locks on `external_identity_id` regardless of provider), post-action
verification (PR-E), disconnect (PR-H swaps `DELETE /v1/contexts` for Steel's
delete-profile), and the rollout flag (PR-I). A swap is a runtime/config choice plus
one creation function — **no data migration**, because the pointer column was
provider-neutral from day one.

---

# §G — `GOGO_BROWSER_CONTEXT_IMPORTS`: what it does and its production risk (amendment (i))

**References:** `managed-browser.ts:51` (guard) and `:52` (parse); test usage
`scripts/verify-managed-browser.mts:50,54`.

**Behaviour:** a JSON env of shape `{ [owner]: { [scope]: contextId } }`, where
`owner` is the **sandbox owner string** passed to `ensureManagedBrowser`
(`secure-computer.ts:574` / `provider-browser-handoff.ts:69` pass the sandbox
`name` = `gogo-browser-v3-<sha256(userId)>`) and `scope` is the www-stripped host.
When a sandbox has **no local context** for a scope (`!state.contexts[scope]`), and
imports provide a binding, the code validates the referenced context belongs to the
project (`GET /v1/contexts/{id}`, `managed-browser.ts:56-57`) and adopts it
(`:58`). It is the **explicit server-side import** that stops a new user inheriting a
demo login (comment `:49-50`).

**Why it matters today:** because the context map otherwise lives only in the
sandbox file and dies with the microVM, **`GOGO_BROWSER_CONTEXT_IMPORTS` is currently
the *only* mechanism by which a Browserbase context survives sandbox death.** It is
set in Production and Preview.

**Production risk:** it is a **manually-maintained static plaintext map of context
ids**. Risks: (1) a mis-keyed/duplicated entry can bind **two users' sandboxes to the
same context id → cross-account session sharing** (a logged-in session leaking
between users); (2) it does not scale (one hand-edited entry per user×site);
(3) it pins contexts that are **never deleted** (§0.4). **PR-B replaces it** with the
per-user `vault_browser_identities` table and PR-H adds deletion; once PR-B ships,
`GOGO_BROWSER_CONTEXT_IMPORTS` should be retired to remove the cross-account hazard.

---

# §H — `VAULT_MASTER_KEY_V1`: which paths need it; what breaks on Preview (amendment (i))

**Used by:** `lib/security/vault-crypto.ts:8` (`keyBytes()` → base64, must decode to
32 bytes `:11`). `encryptVaultValue`/`decryptVaultValue` depend on it, and are called
from `lib/vault/credential-store.ts` (`saveVaultCredential` `:71-72` encrypt;
`resolveVaultCredentialForDomain` `:160-161` decrypt). A `hasVaultMasterKey()` guard
exists (`vault-crypto.ts:16`).

**On Preview without `VAULT_MASTER_KEY_V1` (it is Production-only):**
- Saving a vault **credential** throws `vault_master_key_missing` → the Vault
  add/save flow fails on Preview.
- Resolving a saved credential for auto-login (`resolveVaultCredentialForBrowser` →
  `attemptVaultLogin`, `secure-computer.ts:950,964`) throws → the password
  auto-login path is unavailable, so Preview **falls back to human takeover** for
  logins.
- **The Browserbase Context persistence path does NOT need `VAULT_MASTER_KEY_V1`** —
  it stores no secrets — so a *previously-persisted* context still works on Preview;
  only the credential-vault (username/password) surface is broken there.

**Implication for PR-D on Preview:** the "vault OTP form" reconnect branch cannot
save credentials on Preview; the **live-view** reconnect branch (no stored secret)
must be the Preview path. Set `VAULT_MASTER_KEY_V1` for Preview if credential-vault
reconnect is to be tested there.

---

# §I — Rollout-flag production-safety rule (amendment (h))

`managedBrowserEnabledFor(telegramId, env)` replaces `managedBrowserEnabled()`
(`managed-browser.ts:8`) with this exact contract:

- **`GOGO_BROWSER_MANAGED_ALLOWLIST` UNSET → behaviour is byte-for-byte today's:**
  `GOGO_BROWSER_RUNTIME==='browserbase'` → managed mode for **everyone**; otherwise
  sandbox. **No PR may change production behaviour while the allowlist is unset.**
- **Allowlist SET → managed mode only for the listed `telegram_id`s** (negative ids
  parsed correctly); plus, when `VERCEL_ENV==='preview'`, managed mode may
  additionally be enabled for all Preview traffic.
- Sandbox path always remains the fallback.

---

# §J — Reconnect / live-view link security + mockup gate (amendment (f))

PR-D reconnect and live-view links must be **short-lived, single-use, bound to the
`telegram_id`**, and **never logged or stored in plain text** (extends the existing
`buildVaultAddLink` no-token rule, `connect-link.ts:16-22`). **GATE:** a clickable
**375 px mobile mockup** of the reconnect page must be owner-approved **before PR-D is
implemented.**

---

# §K — Harness debt (amendment (g); not part of these PRs)

`npm test` is a single ~10 KB `&&` chain (`package.json:11`) that **exceeds the
Windows `cmd.exe` 8191-char limit** (truncates mid-filename). Replace it with a small
`node` runner that reads the list and executes each verifier sequentially, so
`npm test` works on Windows. Until then, the **valid Windows gate is the
segment-by-segment run** (each `&&` segment executed separately). Tracked as debt,
not blocking these PRs.

---

*Plan only. No source files changed on this branch. PR-0 and all PRs are proposals;
PR-0 is implemented only after its plan is approved; PR-D requires the §J mockup gate.*
