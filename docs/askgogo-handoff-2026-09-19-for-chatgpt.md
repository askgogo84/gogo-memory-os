# AskGogo — session handoff, 19 Sep 2026 (for ChatGPT)

**Purpose.** Everything achieved in the 19 Sep session, the exact state of each workstream, what is proven versus assumed, and what is open. Written so another assistant can fold it into one AskGogo master status and testing plan without re-deriving anything.

**Evidence rule used throughout.** A claim marked **PROVEN** was observed working in production or verified in code at the stated commit. **CODE** means read in source at `file:line`. **UNVERIFIED** means believed but not tested. Do not upgrade a tag without new evidence.

---

## 1. Environment facts (read first)

| Thing | Value |
|---|---|
| App repo (bot + dashboard + APIs) | `askgogo84/gogo-memory-os`, local `C:\Users\gover\gogo-memory-os`, serves **app.askgogo.in** |
| Marketing site repo | `askgogo84/askgogo-main`, local `C:\Users\gover\askgogo-main`, serves **askgogo.in** |
| Vercel team | `goverdhanmd-9559s-projects`. Both projects **auto-deploy on push to `main`** (confirmed for the app repo on 19 Sep via the Vercel API) |
| Supabase (AskGogo) | project `qenhjcooyecmatwducpu` |
| Stack (app) | Next.js 16.2.4 App Router, React 19, TypeScript with `strict: false`, `next.config.ts` has `ignoreBuildErrors: true` |
| Test gate | `npm test` = a chain of ~70 verify scripts. Vercel runs it via `prebuild` on every deploy. Locally it needs `. .\scripts\load-env.ps1` first |
| `tsc --noEmit` | Has **51 pre-existing errors** in untouched files. Gate for new work is "no new errors from files you touched", not zero |
| Narrowing gotcha | Because `strict: false`, TypeScript cannot narrow unions on `ok: true/false`. Use `'field' in result` narrowing. This is the cause of most of the 51 existing errors |
| WhatsApp user ids | WhatsApp users are stored with a **NEGATIVE** `telegram_id` by design (`lib/bot/resolve-user.ts:20` `generateNegativeTelegramId`). Any code that validates ids with `> 0` / `<= 0` silently excludes every WhatsApp user |
| Repo visibility | **Both repos are public on GitHub.** `docs/architecture/NIGHT-REPORT-2026-09-19.md` (security findings, unflipped webhook enforcement) is on `main`. Recommended: make the app repo private |
| Vercel billing | Invoice was overdue on 19 Sep; **paid the same day** (Sep 2026 invoice $23.60, now $0 due) |
| Claude Code | Ran out of API credit mid-task. Work since then has been done by writing files in chat and Gogo running them in PowerShell |

---

## 2. What shipped on 19 Sep (all on `main`, all deployed)

| Commit | What | Status |
|---|---|---|
| `3f38a21` | Overnight hardening merge: test wiring, policy-gate coverage test, webhook signature verification in **log-only** mode, RLS policy SQL prepared (not applied), launch-master corrections, Instinct teardown v1 | Merged |
| `8ee10cf` | `docs/askgogo-handover-next-session.md` | Merged |
| `98b1864` (+`947a27e`) | **Run 2 + Run 3 of the five-run plan.** `docs/architecture/02-instinct-teardown-observed.md` (evidence record), OBSERVED tier merged into `02-instinct-teardown.md`, `03-target-product-model.md` "FROZEN v1 — 19 Sep 2026" with COPY / ADAPT / IGNORE / DIFFERENTIATE verdicts per capability. Correction commit removed an unsupported "Instinct used a chat Yes as consent" claim — the account-creation **offer** is observed, the consent step is **not** | Merged |
| `b258eb7` | Waitlist six-doc set: `docs/waitlist/01-PRD.md` … `06-IMPLEMENTATION-PLAN.md` | Merged |
| `6615ae8` (+`b704a5e`) | **Waitlist backend**: `app/api/waitlist/route.ts`, `lib/waitlist/validate.ts`, `scripts/verify-waitlist-validate.mts` (21 cases, wired into `npm test`), `supabase/waitlist-v1.sql` | Merged, live, tested |
| `8398df4` (+`9dc6a3e`) | **Google connect fix for WhatsApp users** (see §4.2) + regression test | Merged, live, **proven on phone** |

### Five-run plan status

| Run | Status |
|---|---|
| 1 — capability audit | Done earlier (`docs/architecture/01-askgogo-capability-audit.md`) |
| 2 — Instinct teardown | **Done** (OBSERVED tier populated) |
| 3 — frozen target product model | **Done** (`03-target-product-model.md`) |
| 4 — E2E acceptance matrix | **Not started.** Gmail items from §4 and bugs from §5 must be added to it |
| 5 — dashboard | **Not started.** Blocked on decision OD-1 (5-tab ceiling at 375px vs adding Activity / Goals / Library) |

---

## 3. askgogo.in waitlist

### 3.1 Decisions made by Gogo

- **Site-first, no gate on arrival.** Visitors browse; the waitlist form opens as a **bottom sheet** (centred modal at ≥768px) only when they tap **"Join Gogo"**. (Gogo reversed his earlier gate-first idea.)
- Form captures **WhatsApp number (+91 default, +971) and email**, both required. WhatsApp opt-in checkbox is **unticked by default**; nobody is messaged on WhatsApp without ticking it. No OTP at waitlist stage.
- **All pricing removed from the public site**, no replacement line. App-side pricing (`/pay`, `/upgrade`, dashboard usage) stays — existing users need it.
- Hero voice modelled on Instinct's plain-statement style: bold first paragraph + two calm paragraphs.
- Approved mockup: https://claude.ai/artifact/HQaGjw9gB8gfg3jjU3XXPF
- Sheet styling follows the **live site** (fonts Newsreader + Onest, primary teal `#157A6E`, cream background), not the mockup's placeholder fonts. No italic type anywhere.

### 3.2 Approved copy (email deliberately excluded — see §4.4)

> **AskGogo is a personal assistant that understands what is on your plate and what matters to you. It connects to what you already use: WhatsApp, your calendar and your documents.**
>
> There is nothing new to learn and nothing to install. It lives in WhatsApp, and you talk to it the way you would text a friend.
>
> It is built for the small, personal details that fill a day: reminding you before a bill is due, briefing you every morning, keeping your tickets and receipts where you can find them, tracking what you spend, and making sure the things you meant to do actually get done.

Instinct claims AskGogo cannot yet back (calling you, screen/audio/location, booking rides) were intentionally left out.

### 3.3 Backend — PROVEN live

- `POST https://app.askgogo.in/api/waitlist`, CORS allowlist exactly `https://askgogo.in` and `https://www.askgogo.in`, `OPTIONS` preflight handled.
- Body: `{ country: 'IN'|'AE', phone, email, whatsapp_opt_in: boolean, source: '<cta-id>', company: '' }` — `company` is the honeypot.
- Validation server-side: India 10 digits starting 6–9, UAE 9 digits starting 5, stored E.164; email trimmed/lowercased/≤254; `source` must match `^[a-z0-9-]{1,32}$` and is stored as `askgogo.in:<id>`; `consent_version` fixed server-side to `2026-09-19`.
- Duplicate number → updates email + opt-in only, **same success response** (never reveals membership). Never returns `ok:true` if the DB write failed. Bodies >2 KB rejected. No phone/email in logs.
- Table `public.waitlist` in `qenhjcooyecmatwducpu`: RLS on, zero policies, no IP stored.
- **Live test results (19 Sep):** valid IN/AE → 200 and stored; bad phone/email → 400 with inline messages; honeypot → 200 and nothing stored; duplicate → 200 and row updated in place; disallowed-origin preflight gets no allow header. Test rows deleted; table empty.

### 3.4 Remaining phases

| Phase | Repo | What | Status |
|---|---|---|---|
| P3 | askgogo-main | Sheet + rewire every CTA and every direct-WhatsApp link to open it + new copy band | **Waiting on Gogo's "go"** |
| P4 | askgogo-main | Remove pricing chapter #13, its menu entry and plan data; 301 legacy pages to `/`; sitemap | Waiting |
| P5 | gogo-memory-os | `app/page.tsx:5-33` wa.me CTA on app.askgogo.in root → repoint to https://askgogo.in | Waiting |
| P6 | both | Manual test matrix at 375px and desktop | Waiting |

**Four calls awaiting Gogo's confirmation before P3** (all recommended):
1. New copy goes in a **new short band after the hero**; the animated hero is untouched (lower risk).
2. Header "Talk to Gogo", hero "Meet Gogo" and the menu entry → relabelled **"Join Gogo"**, open the sheet.
3. Unlinked legacy pages (`Home.dc.html`, `Home-v2.dc.html`, `Pricing.dc.html`, `Try for Free`, `AI Magic*`, `Channel*`, `start/`) → **301 to `/`**.
4. Pricing **actually removed** from page source (not CSS-hidden, which leaves ₹ prices readable by anyone and by search engines).

**Site survey facts (askgogo-main):** live page is a loader (`index.html`) that fetches HTML fragments and boots a Claude Design runtime (`support-v2.js`, marked do-not-edit) with vendored React. Safe edits are **additive** (inject sheet script/CSS via the existing `html.replace('</body>', …)` pattern). Shipping a raw Claude Design package broke production once before. Every direct-WhatsApp link resolves from `links.whatsapp` in `stage-07.htmlfrag:2` (phone 17605483659). Live plans on the site were Free / Essential ₹249 / Plus ₹499 / Pro ₹999.

### 3.5 Open strategic decision

**The WhatsApp number is public.** Anyone can message the bot directly regardless of the website. Should the bot reply fully to numbers not on the list / not invited? If yes, the waitlist filters only website visitors. Recommendation on record: ship the site waitlist now, handle bot-side gating as a separate feature with its own docs (it touches message routing, the most fragile area).

---

## 4. Google Workspace / Gmail — now a first-class use case

### 4.1 Status — PROVEN end to end on 19 Sep

Phone flow observed: "Check my inbox" → connect link → Google consent → **"Google Workspace is ready"** page (connected account shown) → "Check my inbox" → **real Gmail results** listed. Sensitive-detail redaction visibly worked ("[sensitive detail withheld]" in a BSE alert).

### 4.2 Root cause fixed today (commit `9dc6a3e`)

Before the fix, **no WhatsApp user could ever get a Gmail or Calendar connect link.** `buildGmailConnectUrl` / `buildCalendarConnectUrl` and both state decoders rejected ids `<= 0` (`lib/services/google-gmail.ts:66,76`, `lib/services/google-calendar.ts:31,38`), but WhatsApp users have negative ids. The bot fell back to "Google Workspace connection is temporarily unavailable" (`lib/agent/same-brain.ts:29`). Fix: reject only `0`. `scripts/verify-google-workspace-oauth.mts` now round-trips a negative WhatsApp-style id for Gmail and Calendar; negative control confirmed the test fails on the old code. The signing secret was never the issue (`CRON_SECRET` exists; `GMAIL_OAUTH_STATE_SECRET` does not and is not needed).

**Implication:** Calendar connect was broken for WhatsApp users by the same bug. Calendar read after a fresh connect is **UNVERIFIED** on phone.

### 4.3 Facts the verification submission must start from (CODE, commit `8398df4`)

| Item | Current state | Verification concern |
|---|---|---|
| Scopes requested | `openid`, `email`, `profile`, `gmail.readonly`, `contacts.readonly`, `drive.readonly` (`GOOGLE_WORKSPACE_READ_SCOPES`, `lib/services/google-gmail.ts:24-31`), with `access_type=offline`, `prompt=consent`, `include_granted_scopes=true` | `gmail.readonly` and `drive.readonly` are **restricted**; `contacts.readonly` is **sensitive**. Restricted scopes need verification **plus a CASA security assessment**; Google estimates restricted-scope review at ~6 weeks, not guaranteed |
| Calendar | Separate flow, scope `calendar.events` (`google-calendar.ts:57`). Gogo reports Calendar was verified previously | Keep it; do not let the Gmail submission jeopardise it |
| Consent screen today | Shows **"Google hasn't verified this app"** (developer `goverdhan.md@gmail.com`) for the Workspace bundle | Every new user must tap Advanced → unsafe. **Lifetime cap of 100 new users** for unapproved sensitive/restricted scopes, cannot be reset. Check usage: Google Cloud Console → Google Auth Platform → Audience (older UI: OAuth consent screen) → OAuth user cap |
| Token storage | Refresh token written to `users.gmail_refresh_token` (plus `gmail_connected`, `gmail_connected_at`, `gmail_email`) in `app/api/gmail/callback/route.ts` | **UNVERIFIED whether encrypted at rest.** A security assessment will ask. Calendar uses `users.google_refresh_token` |
| Disconnect / revoke | **No Gmail disconnect or token-revoke route found** (searched `revoke`/`disconnect` across `app/api` and `lib`) | Needed: user-initiated disconnect that calls Google's revoke endpoint and deletes stored tokens and cached mail data |
| Privacy policy | https://askgogo.in/privacy/ already states Google API Services User Data Policy incl. **Limited Use**, no ads, no sale, no human reading except with permission; lists Anthropic and OpenAI as reply-generation providers; data fiduciary **CIQ AI Solutions Private Limited** | Mentions Calendar and Gmail only — **Contacts and Drive are not named**. No explicit statement found about Google data **not being used to train generalized AI models** — verify against Google's current Workspace API policy and add if required. Confirm the OAuth app's publisher/brand matches the legal entity |
| Mail content path | Gmail snippets are sent into WhatsApp and to LLM providers | Must be disclosed and consistent with Limited Use |
| OTP / reset-link filtering | Snippets pass through `redactSecretShapedText` (`lib/agent/google-workspace-read.ts:18`) | **UNVERIFIED** that it catches one-time codes, password-reset links and magic-login links. Muse's email connector filters exactly these with deterministic filters plus a classifier, because an inbox can reset every other account. AskGogo should match this before public launch |

### 4.4 Website decision

Do **not** make email a headline promise while every new user hits the unverified-app screen and the 100-user cap. Copy uses "WhatsApp, your calendar and your documents". Add email back as a major public use case once verification is approved.

### 4.5 Workstream (launch-critical)

```
GOOGLE WORKSPACE / GMAIL

P0 — Product flow
✓ Gmail connect works (fixed 19 Sep, 9dc6a3e — WhatsApp negative-id bug)
✓ Inbox read works
✓ Real emails returned
✓ Sensitive-detail redaction visibly works (coverage of OTP/reset links UNVERIFIED)

P0 — OAuth / launch readiness
→ Confirm scopes in code match the consent-screen configuration in Cloud Console
→ Scope audit: keep only what shipped features use (Drive and Contacts reads exist in
  code — searchWorkspaceDrive / searchWorkspaceContacts — but confirm they are real
  user-facing features before verifying them; each restricted scope adds review cost)
→ Consider splitting: verify Gmail read first; defer Drive if it is not launch-critical
→ Build Gmail disconnect + Google token revoke + data deletion
→ Confirm refresh tokens are encrypted at rest (security assessment will ask)
→ Add OTP / password-reset / magic-link filtering to mail reads
→ Update privacy policy: name Contacts + Drive, AI-training statement, retention of mail data
→ Confirm OAuth user-cap usage (lifetime 100, cannot reset)
→ Keep production and testing OAuth projects separated
→ Submit restricted-scope verification; prepare CASA security assessment

P1 — Gmail UX
→ Fix "check my mails" routing hijack (§5.1)
→ Decode HTML entities in snippets (didn&#39;t → didn't)
→ Clean semantic truncation instead of mid-sentence clipping
→ Thread-aware summaries
→ "What needs my attention?"
→ "Draft a reply" (behind the approval boundary)
→ "Remind me if they don't reply"
→ Email → calendar / task / document / watcher
```

### 4.6 Proactive Gmail use cases (Muse-style)

"Check my inbox and tell me what actually needs my attention." · "Find the hotel confirmation for my New York trip." · "Did Christopher Ward reply about the watch?" · "Find the invoice from Samsonite and save it with my documents." · "Look through my travel emails and build my itinerary." · "If this person doesn't reply by Friday, remind me." · "Find all subscriptions I am paying for from my email." · "Find my upcoming bills and tell me what's due this week." · "Take this meeting request from email and find a free slot." · "Summarise everything related to the GoKhana transaction." · "Find my flight confirmation, add it to my trip, and watch for changes."

Framing: email becomes one of Gogo's sensory inputs; calendar, browser, memory, documents and watchers are the action layer.

---

## 5. Open bugs (add all to the Run 4 E2E matrix)

### 5.1 Live product bugs

| # | Bug | Evidence | Fix direction |
|---|---|---|---|
| B-G1 | **"Check my mails" → Lists** ("I could not find 'my mails' on any of your lists") | Phone, 19 Sep 21:32. `lib/bot/detect-intent.ts:140` `read_gmail` phrase list lacks "check my mail(s)" / "check my email(s)"; falls to `classifyCheckVerb` in `lib/data/lists-core.ts:103-121`, whose "looks like a query" words lack mail/email/inbox | Add natural mail phrasings to `read_gmail`; add `mail|mails|email|emails|inbox` to the query-exclusion regex; add lines to `scripts/verify-list-check-verb.mts` (its header: "every past routing hijack gets a line here") |
| B-G2 | HTML entities in Gmail snippets (`didn&#39;t`) | Phone, 19 Sep 23:20 | Decode entities before redaction/formatting |
| B-G3 | Snippets clipped mid-sentence; long replies split by WhatsApp "Read more" | Same | Semantic truncation; per-email length budget |
| B-S1 | "What can you do?" describes reminders, lists, "content creation", web search — omits briefings, expenses, documents, calendar, email | Phone, 19 Sep 21:09 | Align the bot's self-description with the website copy |
| D1 | `agent_goals.status = 'blocked'` written by `goal-engine.ts:83`; **production CHECK allows only active/paused/completed/cancelled** | Production constraint query, 19 Sep | Widen constraint via migration or change code value — Gogo to decide |
| D4 | `life_events.lifecycle_state = 'needs_attention'` written by `life-event-worker.ts:256`, `life-event-execution.ts:140`; **production CHECK does not allow it**; call sites don't check the error → **fails silently** on the airline check-in safety path | Production constraint query, 19 Sep | Same choice; this one is safety-relevant |
| D2/D3 | Watcher types `web_search`/`goal_review` and cadence ≥15 | **Production allows both** — repo migration is stale, not a live bug | Update the repo migration to match production |
| D5 | `agent_steps`, `agent_threads` exist in production but have no `CREATE TABLE` in the repo | Production query | Add migrations so a fresh DB can be rebuilt |

A read-only diagnosis prompt to map every write against these constraints (and find any **false-success** replies) was written but **never ran** — Claude Code ran out of credit. It should run before D1/D4 fixes.

### 5.2 From the 19 Sep morning investigation (`NIGHT-REPORT-2026-09-19.md`)

- Browser failure and browser non-match are the same event: `lib/feature-intents.ts:359-361` catch returns `null`, so infrastructure faults fall through to the plain LLM, which then falsely says it cannot browse.
- `detect-intent.ts:49,173` routes any message containing `price`/`today`/`latest`/`news` to `web_search`; the refusal filter at `process-message.ts:1039` and `:1234` misses "I cannot open…" wording.
- Fail-closed rule exists only in `lib/agent/train-research.ts:170-174`; paths 1–6 in that report can still present unverified prices.
- Long browser replies exceed WhatsApp's 1,550-char chunk and a later chunk failure triggers the "temporarily unavailable" copy after chunk 1 already sent.
- Latent: `parseFlightIdentifier` can read model numbers like "xm5" as flight "XM 5" during a pending flight-watch follow-up.

### 5.3 Operational decisions still pending

- Flip `WEBHOOK_SIGNATURE_ENFORCE=1` after reviewing `WEBHOOK_SIGNATURE_AUDIT` logs (currently log-only).
- Apply the prepared RLS migration `supabase/migrations/20260919000000_agent_rls_owner_policies.sql` (SELECT-only owner policies; service role unaffected).
- Make `npm test` runnable from a clean clone (currently needs env loaded).
- Vercel flags `CRON_SECRET` and `GOOGLE_CLIENT_SECRET` as "Needs Attention" — believed to be a suggestion to mark them Sensitive; not a cause of any bug.

---

## 6. Benchmarks — what to take from them

### 6.1 Meta Muse (read in full 19 Sep: introducing.muse.ai + the linked safety post)

Confirms the direction and sharpens several AskGogo items:

- **One long conversation, bubbles, interruptible, multiple tasks at once; side chats for big projects.** AskGogo's WhatsApp thread already is this; the dashboard should not fragment it.
- **Proactive messages with a high bar**, user-tunable ("turn it off / dial it down / dial it up"). AskGogo's briefings and watchers need the same bar and a user control.
- **Transparency surfaces:** status line under the avatar, full activity log, approved permissions, editable memory. Maps directly to AskGogo's pending dashboard Activity / Goals / Library decision (OD-1).
- **Goals tab** with plan and progress — AskGogo has `agent_goals` but zero rows in production and D1 is broken.
- **Deterministic UI is non-negotiable** for approvals (structured accept/reject cards) and credentials (secure storage). Human-in-the-loop only for hard-to-undo actions, to avoid approval fatigue.
- **Ideas / onboarding suggestions** to solve "it can do so much people don't know where to start" — relevant to AskGogo's first-message onboarding.
- **Artifacts** (itineraries, trackers, dashboards) instead of long text replies.
- **Security model** (worth mirroring in spirit): agent never sees real credentials (surrogate tokens swapped at the network boundary); a separate policy authority (Sentinel) is the only thing that can approve connector actions and egress; connectors run with per-connector credential allowlists (a calendar worker cannot fetch an email credential); read and write access separated where the provider allows; approvals are scoped capabilities (one-time, session, task, time-bounded, perpetual), delivered in client UI not in the chat; **email connector filters OTPs, password-reset links and magic-login links**; untrusted content labelled as untrusted in context. AskGogo's `lib/agent/policy.ts` boundary and read-only Workspace default are aligned; OTP/reset filtering and token-at-rest handling are the gaps most relevant to Gmail verification.

### 6.2 Instinct (observed 19 Sep, `02-instinct-teardown-observed.md`)

COPY candidates: quoted-reply threading, connector-on-demand with an inline link (never a dead end — today's Gmail bug was exactly a dead end), 👍 acknowledgements, "I still need two things" slot-filling, disambiguate rather than guess, credential-boundary wording. DIFFERENTIATE: identity creation in the user's name needs DPDP-grade durable consent.

**Still UNRESOLVED:** where Instinct's six train timings came from (live read vs model knowledge). The test message must be sent to **Instinct** on WhatsApp — it was twice sent to Claude Code by mistake.

---

## 7. Decisions needed from Gogo

1. "Go" on the four P3 calls (§3.4).
2. Bot-side gating for non-waitlisted numbers — now or later (§3.5).
3. D1 and D4: widen production constraints or change code values (§5.1).
4. Gmail verification scope strategy: verify Gmail + Contacts + Drive together, or Gmail first and defer Drive (§4.5).
5. Make the app repo private.
6. Dashboard OD-1 (tab ceiling vs Activity / Goals / Library).

## 8. Suggested order from here

1. P3 → P4 → P5 → P6 (waitlist live on askgogo.in).
2. B-G1 mail hijack fix (small, test-gated, same pattern as today's Google fix).
3. Run the read-only D1–D4 write diagnosis; then fix D1/D4.
4. Gmail verification prep: scope audit, disconnect + revoke, token-at-rest check, OTP/reset filtering, privacy policy update, then submit.
5. B-G2, B-G3, B-S1.
6. Run 4 E2E matrix (fold in everything above), then Run 5 dashboard.

---

## 9. How Gogo works (follow these when producing anything for him)

- Every command, prompt, URL, path or value he must copy goes in its **own code block**. Never inline-only.
- Label where each block runs: **Claude Code**, **PowerShell**, **Supabase SQL editor** (always name project `qenhjcooyecmatwducpu`), **his phone** (WhatsApp), or **Vercel dashboard**.
- Always give **full file paths** (`C:\Users\gover\...`) and **full URLs**.
- Generated files land in `C:\Users\gover\Downloads`; always include the `Move-Item` + `Get-ChildItem` PowerShell to place them. Use collision-safe download names.
- Combine sequential commands into **one** block. Gate commits on green tests with `if ($LASTEXITCODE -eq 0) { … }`. PowerShell 5.1: use `;` not `&&`.
- When adding to a prompt he has not yet run, re-issue the **complete** prompt, never a delta.
- UI work: **clickable mockup first → six docs → build**, phase by phase. Mobile-first, tested at 375px, light/cream themes, no italic type.
- Plan before coding, limit scope, follow existing patterns, no new libraries, summarise every modified file afterwards.
- Flag uncertainty; never fabricate sources, numbers or quotes.
