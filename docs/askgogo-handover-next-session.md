# AskGogo — Handover to a new chat
**Written:** 19 September 2026
**Repo (app):** `C:\Users\gover\gogo-memory-os` — GitHub `askgogo84/gogo-memory-os`, branch `main`, head `3f38a21`
**Repo (site):** the marketing site `askgogo.in` lives in a SEPARATE repo — confirm the local path before touching it; it is not `gogo-memory-os`
**Supabase:** `qenhjcooyecmatwducpu` (note: `yazpphublutdodahfwvr` is a different, near-identical project — do not confuse them)
**Production:** app.askgogo.in on Vercel, region bom1
**Local test loop:** `. .\scripts\load-env.ps1` then `npm test`

---

## 0. THREE THINGS THE USER WANTS NEXT

1. **End-to-end testing of every feature** — currently the suite is logic-only; nothing touches Supabase, Twilio, Google, Razorpay or the sandbox.
2. **Build and push the new dashboard** — the mockup is approved and committed; nothing is built.
3. **Change askgogo.in** — add a waitlist opt-in gate as the first screen (Muse/Instinct style), and remove all pricing from the public site.

A screenshot of the desired waitlist screen will be attached in the new chat.

---

## 1. STANDING RULES — these are the user's own, follow them exactly

**Mock before docs.** For anything with a UI: build a clickable HTML mockup FIRST, get it approved, THEN write the six docs, THEN build. His own diagnosis: "this is the mistake we do and after everything it doesn't turn out to be like I expected."

**Six docs before building any new app/feature:** PRD, TRD, App Flow, UI/UX Brief, Backend Schema, Implementation Plan. Build phase by phase, never in one shot.

**Every commit is gated on a green suite.** Pattern that must be used:
```
npm test 2>&1 | Select-Object -Last 3
if ($LASTEXITCODE -eq 0) { git add ...; git commit ...; git push } else { Write-Host "RED - not committing" }
```
`prebuild` runs `npm test` on Vercel, so a red commit fails the build and production stays on the previous commit.

**Formatting rules for the assistant:**
- Anything he might copy goes in a code block — commands, prompts, URLs, file paths, WhatsApp test messages, form values. No exceptions. This has been restated four times.
- Combine sequential commands into ONE block, not several.
- Always label where a command runs: **PowerShell**, **Claude Code**, **Supabase SQL editor** (name the project ref), **Vercel dashboard**, or **his phone**.
- Always give full file paths and full clickable URLs.
- When he adds to a prompt already given, re-issue the COMPLETE assembled prompt, never a delta.
- Python scripts delivered as a downloadable .py file, not pasted in chat.
- Files land in `C:\Users\gover\Downloads` — always include the Move-Item plus a Get-ChildItem verification.

**Design constraints, non-negotiable:**
- Light/cream only. Never dark backgrounds.
- Mobile-first, tested at 375px minimum.
- ZERO italics anywhere. Emphasis by weight, size or colour.
- Fonts: Fraunces (display) + Karla (body).
- Palette: cream `#fbf6ef`, orange `#F18219` / deep `#D67528` / tint `#fdf0e2`, plum `#714C77` / deep `#4D2A50` / tint `#f0eaf1`, ink `#3E2312` / `#6b4a34` / `#9a8778` / `#b8a797`, sand `#E4A97D`.

---

## 2. WHERE THE PRODUCT STANDS

### The agent runtime works end to end

```
WhatsApp webhook (Twilio, app.askgogo.in)
  -> enqueue: agent_runs row, status 'queued', reply in <2s
  -> /api/cron/autonomous-runs (every minute, maxDuration 300)
       -> claim with optimistic lock
       -> resume per-user sandbox (gogo-browser-v3-<digest>)
       -> Chromium with --disable-http2, 45s nav timeout
       -> read page, run block detectors
            +-- provider_access_limited  -> DEVICE handoff (link for the user's own browser)
            +-- human_auth_required      -> CLOUD takeover (live browser, port 3001, detached:true)
            +-- clean read               -> extract, push result to WhatsApp
  -> user replies CONTINUE -> resume reads handoff state -> push result
```

Verified live 18 Sep. Both handoff modes work.

### The provider reality, established by testing

- **IRCTC** serves an Akamai "Access Denied" to datacenter IPs. Confirmed twice — from the agent, and by loading the human takeover page, which showed the same block. **Instinct AI hit the identical wall** on 19 Sep and fell back to device handoff, exactly as AskGogo does.
- **BookMyShow** — Cloudflare 403, found 1 Sep.
- **Flipkart** — the sandbox reached it successfully on 19 Sep. Not blocked.
- **Amazon.in** — untested; the one attempt failed for an unrelated internal reason (see §3).

**The rule this produced:** cloud takeover solves human-presence walls (CAPTCHA, login, OTP). It cannot solve IP reputation, because the takeover browser runs in the same sandbox. IP-blocked providers get a device handoff instead.

### What exists vs what is built

| Surface | State |
|---|---|
| Activity feed data (`agent_runs` + `agent_steps` with ordinals) | Written. **No UI.** |
| Paused runs + handoff metadata | Written. **No UI.** |
| Agent browser + takeover | Working. **Not in the dashboard.** |
| Dashboard mockup (Activity, Task Detail, Agent Browser) | Approved, committed `0007897`, at `docs/dashboard-design/AskGogo-Activity-TaskDetail-AgentBrowser.dc.html` |
| Goals | **`agent_goals` table has ZERO rows.** See §4. |
| Library / artifacts | Specced, no surface. |

---

## 3. OPEN BUGS — diagnosed to file:line, not fixed

All three are documented in `docs/architecture/NIGHT-REPORT-2026-09-19.md` (section "LIVE BUG").

**B1 — a specialist that throws is indistinguishable from one that declined.**
`lib/feature-intents.ts:361` returns `null` on any exception — the same value the bridge returns when nothing matched (`whatsapp-bridge.ts:260`). So an infrastructure fault silently downgrades the message to the plain-LLM path, which then **denies the product has a browser**. Observed live: "I cannot open the Amazon.in URL, as I'm an AI assistant without the ability to browse websites." That text is model output, not in the codebase.

**B2 — WhatsApp reply chunking has no error handling.**
`browser-command.ts:145` builds a reply up to ~1800 chars against `WA_MAX_CHARS = 1550` (`lib/whatsapp.ts:46`). `sendWhatsApp` splits and sends in a loop with no try/catch inside the loop (`whatsapp.ts:93-110`). A later chunk throwing produces "temporarily unavailable" AFTER the first chunk was delivered.

**B3 — fail-closed is trains-only.**
The rule lives in `lib/agent/train-research.ts:170-174`. **Six other paths can still state unverified prices, availability or inventory**, and the general planner inherits all of them via `dispatchThroughSameBrain` -> `same-brain.ts:141`. This is the most strategically important of the three: the rule needs to be an invariant, not a local patch.

**B4 (latent) — `sony wh-1000xm5` parses as flight "XM 5".**
`watch-command.ts:183-192`; reachable via the pending-flight-watch follow-up path at `:271-278`. Seventh instance of the shallow-matcher family (previous six: weather `rain` matching "trains" in two matchers, nutrition, list, split, classifyCheckVerb).

**Schema drifts — real but LATENT, confirmed against production 19 Sep:**
- `agent_goals.status = 'blocked'` is not in the CHECK constraint. Would throw — but the table has zero rows, so it has never fired.
- `life_events.lifecycle_state = 'needs_attention'` is not in the constraint. Fails **silently** (neither call site checks the error) on the safety path that stops an uncertain airline check-in being retried. One row in that table.
- Production ALLOWS `agent_watchers.type = 'web_search'` and `cadence_minutes >= 15`, which the repo's migrations forbid. **The repo is not the source of truth for the schema.** `agent_steps` and `agent_threads` are written by 15+ modules and have no CREATE TABLE anywhere in the repo.

---

## 4. THE QUESTION TO ANSWER BEFORE DESIGNING GOALS

`agent_goals` has **never had a row written to it.** The user wants a Goals surface and a goal-driven personalised feed in the dashboard. Before designing either, establish whether anything creates a goal at all:

```powershell
cd C:\Users\gover\gogo-memory-os
Get-ChildItem -Recurse -File -Include *.ts |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.next\\|\\dist\\' } |
  Select-String -SimpleMatch "from('agent_goals')" |
  ForEach-Object { "{0}:{1}: {2}" -f ($_.Path -replace [regex]::Escape($PWD.Path + '\'), ''), $_.LineNumber, $_.Line.Trim().Substring(0,[Math]::Min(120,$_.Line.Trim().Length)) }
```

If there is no reachable creation path from WhatsApp, Goals is a feature to build on the conversational side first — not a dashboard job.

---

## 5. THE FIVE-RUN PLAN — where it stands

Agreed 19 Sep. **Rule: no new features until Run 3 reconciles Runs 1 and 2.**

| Run | What | State |
|---|---|---|
| 1 | Read-only capability audit of the repo | **DONE** — `docs/architecture/01-askgogo-capability-audit.md`, merged |
| 2 | Instinct teardown, every claim tagged Observed / Reported / Inferred | **PARTIAL** — `docs/architecture/02-instinct-teardown.md` merged, but its OBSERVED tier is EMPTY and no source page could be opened. Real Observed material exists (see §6) and must be merged in |
| 3 | Merge into a frozen target functional product model; COPY / ADAPT / IGNORE / DIFFERENTIATE per capability | **NOT STARTED** — this is the next real step |
| 4 | E2E acceptance matrix + small-PR backlog | Not started. **This is where the user's "end-to-end testing of all features" belongs** |
| 5 | Dashboard requirements, with the approved mockup as a hard constraint | Not started |

Benchmarks: **Meta Muse** for the dashboard/control plane, **Instinct AI** for the WhatsApp/conversational side.

---

## 6. INSTINCT — the Observed material that must be merged into the teardown

The user captured live WhatsApp screenshots of Instinct on 19 Sep, 09:16–10:00 IST, running the SAME Bangalore→Mysore train task. A full Observed-tier writeup exists at:

```
C:\Users\gover\Downloads\02-instinct-teardown-observed.md
```

**If that file is missing, the key observations are:**

- **Quoted-reply threading, bidirectional.** Every agent reply quotes the originating user message. The user also quote-replies to specific agent questions. This is how one linear chat holds three concurrent tasks. **Highest-value cheap copy.**
- **Connector-on-demand** — "I don't have an email account connected yet" + inline Connect card + an Outlook alternative. No dead ends.
- **Email triage shape** — three numbered things that matter, each naming the person and what's blocked, then "the rest is mostly newsletters", then an offered next action.
- **Slot-filling that tracks state** — "Got the names and ages. I still need two things", and it disambiguates between two matching trains rather than guessing.
- **Credential boundary** — "send your IRCTC username. Don't send the password here. If it's needed, I'll give you a secure link for it." Plus an **Instinct vault** at app.instinct.com for setting the password out of chat.
- **Initiative on delegation** — "U choose" produced "I'll try goverdhanmd first and use a close variation if it's taken."
- **It offered to create an IRCTC account in the user's name**, with his real email and WhatsApp number. Flagged as a DIFFERENTIATE candidate — for AskGogo that is identity creation and would need DPDP-grade explicit consent, not a chat "Yes".
- **It hit the same Akamai block** and fell back to: "Please create and activate the account yourself in the official IRCTC site or app… Tell me when it's active and I'll pick up the 10:05 Vande Bharat booking from there."
- **UNRESOLVED:** it produced six trains with times three minutes after the request, with no visible source, no browser step and no citation. Whether that was a live read or model knowledge is untested. If it is model knowledge, AskGogo's verified-or-refuse behaviour is a real differentiator. **Ask Instinct directly before recording a conclusion.**

---

## 7. TASK A — END-TO-END TESTING

**Current state:** `npm test` is 62 logic-only checks. Genuinely good at the router and pure-function layer. Nothing touches Supabase, Twilio, Google, Razorpay or the sandbox. There is **no CI workflow** running `npm test` on a PR.

**Also open (NEEDS-DECISION 4 from the night report):** the suite cannot run from a clean clone. `lib/data/supabase-admin.ts:3` constructs a Supabase client at module load and several verify scripts import it transitively without dummy env. `verify-calendar-routing.mts:13` already has the guard pattern; extending it, or committing a `.env.test.example`, would fix it.

**What E2E should be, per the five-run plan (Run 4):** for every feature — user prompt, expected router, specialist owner, persistent objects created, steps, browser usage, handoff behaviour, approval, allowed side effects, FORBIDDEN side effects, verification source, fail-closed response, expected WhatsApp reply, expected dashboard state, idempotency test, retry test, pass/fail criteria.

Cover at minimum: reminders, lists/tasks, calendar, memory, documents, receipts, meeting notes, Gmail/workspace, train, flight, hotel, bus, appointments, cinema/events, shopping, food, goals, watchers, Life Events, trusted-person actions, booking changes, cancellations, refunds, delivery tracking.

---

## 8. TASK B — THE DASHBOARD

**The mockup is approved and committed:**
```
C:\Users\gover\gogo-memory-os\docs\dashboard-design\AskGogo-Activity-TaskDetail-AgentBrowser.dc.html
```
Open it before designing anything. It covers three surfaces:
- **Activity** — reverse-chronological run feed, honest about failure, with a paused row and a running row with a step counter
- **Task Detail** — full step lineage left, prose summary right, status badge
- **Agent Browser** — three states: working, taken over by the user (Return control), and blocked by the provider with the device-handoff alternative

**Known gap:** no tab chips showing which sites the agent has open across a run. Muse has these.

**THE UNRESOLVED IA DECISION — settle this before building.** The tab bar was locked at five (today / calendar / lists / usage / you) because five is the ceiling at 375px. Activity, Goals and Library would make eight. Muse solves it with a desktop icon rail, which does not translate to mobile. This needs deciding first.

**Sequence:** mockup (done) -> six docs -> build phase by phase. Do not skip the docs.

---

## 9. TASK C — askgogo.in WAITLIST GATE AND HIDDEN PRICING

**This is a different repo from the app.** Confirm the local path first — do not edit `gogo-memory-os` for this.

**What the user wants:**
1. A waitlist opt-in as the FIRST screen, before the full site is shown — modelled on Muse and Instinct. A screenshot of the target will be attached in the new chat.
2. **Remove all pricing from the public site.** Keep it hidden.

**A pricing inconsistency already exists and is worth resolving as part of this:** three different prices have been live simultaneously — the landing page said "from ₹99/month", `/upgrade` said "₹299/mo", and the meter run-out message said "Lite ₹99 gives you 25 a day". Hiding public pricing removes two of those three; `/upgrade` inside the app must still be rebuilt against `plan_limits` rather than hardcoded copy.

**Questions to settle with the user before building:**
- Does the waitlist gate block the whole site, or is there a "see more" path past it?
- Where do waitlist signups land — Supabase table, email list, or both?
- Does an existing user hitting the site get past the gate automatically?
- Is pricing hidden entirely, or replaced with "contact us" / "pricing at launch"?

Follow mock-before-docs here too: build the gate as a clickable mockup at 375px first.

---

## 10. ALSO OPEN, LOWER PRIORITY

- **`WEBHOOK_SIGNATURE_ENFORCE`** — signature verification is merged and running in LOG-ONLY mode. Collect a day of `WEBHOOK_SIGNATURE_AUDIT` lines in Vercel logs. When `outcome: valid` is 100% of real traffic, set the flag to `1`. `unverifiable` in volume means misconfiguration, not attack.
- **RLS migration** — written at `supabase/migrations/20260919000000_agent_rls_owner_policies.sql` with a rollback beside it. **Not applied.** Covers 10 tables, SELECT only (granting owner writes would let a compromised client approve its own `agent_approvals` row). Applying it changes nothing on its own because the service role bypasses RLS; it is the precondition for moving 15 routes off the service role one at a time.
- **`SANDBOX_WORKDIR`** is declared `/home/vercel-sandbox` but the real cwd is `/vercel`. Works only because `mkdir -p` creates it. Align the constant.
- **Document short-link TTL** — sensitive docs should be 15 minutes, currently 7 days.
- **`app/page.tsx`** is still the default Next.js template; WhatsApp link previews read "Create Next App".
- **`wip/briefing-greeting-tier1c`** — a branch holding recovered stash work, based on a 9 Aug commit. Rebase before using.
- **Tipplr, separate project:** Nithin sent a menu UPDATE endpoint. Two traps — omission marks items OUT OF STOCK (a partial push disables the rest of the menu), and matching is by `kitchen_at_item_code` where a mismatch DUPLICATES rather than updates. See `/areas/tipplr-ops-toolkit.md`.

---

## 11. HOW THE USER WORKS

Vibe coder — directs AI end to end, executes on a Windows PC ("Jarvis", `C:\Users\gover\`), deploys by `git push` to Vercel. Tests on his phone over WhatsApp. Often not at the laptop, in which case: Claude Code cloud sessions work from the phone via the **Code** tab; Remote Control only works if a local session was started before leaving.

He moves fast and starts more than he finishes. The most useful thing an assistant can do is keep the thread of what is open, push back when a step is being skipped, and say plainly when something is not worth doing yet.
