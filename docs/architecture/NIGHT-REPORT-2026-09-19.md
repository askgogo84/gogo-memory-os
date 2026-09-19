# Night report — 19 September 2026

Overnight hardening queue. Base commit `0007897` (`main` at start), addendum committed to
`claude/askgogo-capability-audit-lomml5`, all subsequent work on
**`claude/overnight-hardening-2026-09-19`**.

`main` was never checked out, modified, merged or pushed. `vercel.json`, `.env*`, every cron
schedule and `scripts.prebuild` are untouched.

## Test gate

`npm test` was red on first run in this container for an environment reason, not a code one:
`lib/data/supabase-admin.ts:3` constructs a Supabase client at module load, and several verify
scripts import it transitively without setting the dummy env that `verify-calendar-routing.mts:13`
sets for itself. The same is true of `lib/bot/services/nutrition-analyzer.ts:14` (OpenAI client at
import).

Resolved **without touching any file**, by exporting dummy values in the shell for the test run
only: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `ASSEMBLYAI_API_KEY`, `TAVILY_API_KEY`,
`CRON_SECRET`, `NEXT_PUBLIC_APP_URL`. All are dummies; no real secret was used or written.

With those set, the suite is **green (exit 0)** at the base commit, and was re-run green before
every commit below.

*Worth a decision in the morning: a fresh clone cannot run `npm test` without this knowledge.
A committed `.env.test.example`, or the dummy-env guard that `verify-calendar-routing.mts`
already uses applied to the other entry points, would fix it. Not done tonight — it touches
files outside the queue.*

## Task log

| Task | Status | Commit | Why |
|---|---|---|---|
| 0 — finish the addendum, branch | **DONE** | `69367aa` (audit branch), branch `claude/overnight-hardening-2026-09-19` cut from it | Section 8 committed and pushed to `claude/askgogo-capability-audit-lomml5`; all later work on the new branch |
| 1 — wire the orphaned verify scripts | **DONE** | `1937b7e` | All four ran individually first and **all four passed**, so all four are wired in. Suite 58 → 62 checks |
| 2 — policy-gate coverage test | **DONE** | `6411cc0` | **No ungated executor exists.** All five consequential executors are authorization-gated; the script proves it and enumerates them |
| 3 — webhook signature verification | **DONE**, needs a decision to enable | `45965ff` | Twilio is the live path (evidence below). Written, wired, log-only, 12 checks. Flag stays OFF |
| 4 — RLS policy SQL | **DONE**, needs a decision to apply | `2a5e0c7` | 10 tables, policy + rollback written to `supabase/migrations/`. **Not applied.** Nothing was run against a database |
| 5 — correct the launch master | **DONE** | `8e3aa50` | Nine audited P0 items ticked across 12 checklist lines, each citing file + verify script. 12 lines changed, 12 replaced, nothing else touched |
| 6 — Instinct teardown | **DONE**, with a stated evidence limit | `d38ff09` | `docs/architecture/02-instinct-teardown.md`. OBSERVED tier is empty and no source page could be opened — see below |
| 7 — this report | **DONE** | this commit | — |

## Details that need you

### NEEDS-DECISION 1 — carried over from the audit: four schema drifts that may be live bugs

Not part of the queue, but found in section 8.3 of the addendum last night and **more urgent than
anything in the queue**. Four writes target status values the repository's own CHECK constraints do
not permit. Either production has diverged from these migrations, or these writes are failing now:

| Drift | Write | Constraint | If production matches the repo |
|---|---|---|---|
| D1 | `agent_goals.status = 'blocked'` (`goal-engine.ts:83`) | `active/paused/completed/cancelled` (`agent-os-v1.sql:13`) | `goal-engine.ts:84` **throws**. Every goal-worker pass over a goal with a blocked step fails, on the `*/15` cron |
| D2 | `agent_watchers.type` = `'web_search'` / `'goal_review'` (`watchers.ts:95`, `goal-engine.ts:100`) | seven types, including `web_change` but **not** `web_search` (`agent-os-v1.sql:120`) | every web watcher and every goal watcher fails to create |
| D3 | `cadence_minutes` floor of 15 (`watchers.ts:58`) | `>= 60` (`agent-os-v1.sql:122`) | watchers created at the adaptive floor are rejected |
| D4 | `life_events.lifecycle_state = 'needs_attention'` (`life-event-worker.ts:256`, `life-event-execution.ts:140`) | eight states, not including it (`life-events-v1.sql:18`) | fails **silently** — neither call site checks the error — on the safety path that stops an uncertain airline check-in being retried |

**One query settles all four**, and it is the first thing worth running in the morning:

```sql
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid::regclass::text in ('agent_goals','agent_watchers','life_events')
   and contype = 'c';
```

If production allows these values, the repo's migrations are stale and should be corrected to match.
If it does not, D1 and D2 mean background goals and web watchers are not working right now. I did
not touch either path — diagnosing it needs the live schema, which this session cannot reach.

### NEEDS-DECISION 2 — flip `WEBHOOK_SIGNATURE_ENFORCE` (task 3)

**Which path is live: Twilio, not Meta.** Evidence:

- `app/api/webhooks/whatsapp/route.ts` POST parses `req.formData()` and reads Twilio field names —
  `From`, `ProfileName`, `NumMedia`, `MessageSid`, `SmsMessageSid`, `Body`, `MediaUrl0`,
  `MediaContentType0`, `ButtonPayload`. Meta's Cloud API posts JSON under
  `entry[].changes[].value.messages[]` and would match none of them.
- That route logs the inbound body under the literal key `RAW_TWILIO:` (`route.ts:264`).
- Every response is TwiML with `Content-Type: text/xml`, which is Twilio's contract. Meta expects a
  bare 200.
- Outbound goes through the twilio SDK, and `TWILIO_AUTH_TOKEN` appears in 25 places.
- The GET handler at `route.ts:244` does implement Meta's `hub.challenge` handshake — but there is
  no JSON POST path anywhere in the codebase, so **the Meta Cloud API path is vestigial** for
  inbound messages. Only Twilio is verified.

**What to do:** grep production logs for `WEBHOOK_SIGNATURE_AUDIT`. Every line carries
`outcome`, `wouldReject`, and `matchedUrl`. When `outcome` is `valid` for 100% of real traffic over
a representative window, set `WEBHOOK_SIGNATURE_ENFORCE=1`.

Two things to expect before flipping:

- If `matchedUrl` is consistently a specific host, pin it with `TWILIO_WHATSAPP_WEBHOOK_URL` to
  remove the guessing entirely — the `twilio-status` route already uses that pattern.
- `outcome: 'unverifiable'` means misconfiguration (no token, no header), not forgery. Enforcement
  never rejects it. If you see it in volume, fix that first — enforcing would not help.

Nothing changes until you set the variable. `shouldRejectRequest()` returns false for every verdict
in log-only mode, and `verify-webhook-signature.mts` asserts exactly that.

### NEEDS-DECISION 3 — apply the RLS policies (task 4)

**Written, not applied:** `supabase/migrations/20260919000000_agent_rls_owner_policies.sql` and
`…rollback.sql`.

**Tables covered (10)** — all have RLS enabled and zero policies today:
`agent_goals`, `agent_runs`, `agent_activity`, `agent_permissions`, `agent_approvals`,
`agent_ideas`, `agent_artifacts`, `agent_watchers` (`agent-os-v1.sql:137-144`), plus `life_events`
and `life_event_actions` (`life-events-v1.sql:143-144`).

**Excluded:** `agent_steps` and `agent_threads`. Written by 15+ modules, but neither has a
`CREATE TABLE` anywhere in this repo, so their RLS state is unknown and enabling RLS blind could
take the agent offline. They need a live schema dump first.

**Also RLS-enabled with no policy, outside the agent scope you gave me** (listed so it is visible,
not actioned): the six `split_*` tables, `split_receipts`, `mobile_link_requests`,
`mobile_sessions`, `dashboard_otp_challenges`, `user_experience_preferences`, `learning_progress`,
`lifecycle_email_log`, `daily_brief_email_log`. Only `skin_check_reports` has a policy.

**Routes affected if service-role usage were later reduced** — these 15 read the agent tables and
would need `set_config('app.telegram_id', …, true)` on their connection:

```
app/api/agent/approvals/[id]      app/api/agent/artifacts/[id]     app/api/agent/goals
app/api/agent/goals/[id]          app/api/agent/goals/[id]/resume  app/api/agent/live
app/api/agent/permissions         app/api/agent/run                app/api/agent/runs/[id]/execute
app/api/agent/snapshot            app/api/agent/threads            app/api/agent/threads/[id]
app/api/agent/watchers            app/api/agent/watchers/[id]      app/api/cron/autonomous-runs
```

Applying the migration on its own changes nothing, because the service role bypasses RLS. It is the
precondition for moving those reads off the service role, one route at a time.

**SELECT only, deliberately.** Granting owner writes would let a compromised client set its own
`agent_approvals` row to `approved` — the single transition the whole safety model rests on.

### NEEDS-DECISION 4 — the test suite cannot run from a clean clone

Described under **Test gate** above. A committed `.env.test.example`, or extending the dummy-env
guard `verify-calendar-routing.mts:13` already uses to the other entry points, would fix it. Not
done tonight: it touches files outside the queue and I would rather you choose the shape.

## Task 2's finding, since it is good news worth stating

The audit named "nothing asserts that agent executors call the policy gate" as the highest-value
missing test. Having written it: **every consequential executor is gated.** The gate is enforced at
the orchestration layer, not per-executor, through four mechanisms — which is why a naive "every
executor imports policy.ts" test would have failed against a correct codebase:

```
executeApprovedBookingCalendar        APPROVAL      asserts an approved agent_approvals row
executeApprovedTravelCalendarPlan     APPROVAL      + calendarEnabled() permission check
executeApprovedWorkspaceMeetingPlan   APPROVAL
createOrConfirmCalendarInvite         MODULE-ENTRY  private helper behind the above
executeVerifiedMissionCalendar        CALLER        general-planner.ts gates before dispatch
secure-browser submit                 GATE          both execute-mode drivers call the gate
```

`appointment-followup.ts` writes `mode:'execute'` but only into run metadata behind a *pending*
approval, so it is correctly not an executor. Verified by negative control: adding an ungated
mutating fetch to `lib/agent/actor.ts` makes the test exit 1 naming file:line. Reverted.

## Task 6's evidence limit, stated because it changes how much the document is worth

`02-instinct-teardown.md` is tagged throughout, but two things constrain it:

1. **The OBSERVED tier is empty.** No demo video was supplied and the product is invite-only.
2. **No source page could be opened.** The egress proxy blocked `instinct.com`, `techcrunch.com`,
   `forbes.com` and `vellum.ai`. Every REPORTED claim came through search-result summaries.

Treat it as a research map, not citable fact, until the sources are re-read directly. Its central
claim about Instinct — that no permission model is described publicly — is an inference **from
absence**, and the document says so and asks for it to be falsified first.

## Summary

**Commits tonight: 7** — one on `claude/askgogo-capability-audit-lomml5` (`69367aa`) and six on
`claude/overnight-hardening-2026-09-19`.

**Branch to review:** `claude/overnight-hardening-2026-09-19`, based on the audit branch.

`npm test` was run before every commit and was green (exit 0) every time. `main` was never checked
out, modified, merged or pushed. `vercel.json`, `.env*`, cron schedules and `scripts.prebuild` are
untouched.

### Safe to merge as-is

- **Task 1** (`1937b7e`) — four passing tests added to the suite. No production code.
- **Task 2** (`6411cc0`) — new test + one line in `package.json`. No production code.
- **Task 5** (`8e3aa50`) — documentation only.
- **Task 6** (`d38ff09`) — new document only.
- **Task 3** (`45965ff`) — touches the live webhook, but is behaviour-neutral by construction and
  the test asserts the default cannot reject. Merging it starts the log collection you need in
  order to decide. It is the only production-code change tonight.
- **Task 4** (`2a5e0c7`) — SQL files only; merging does not apply them.

### Needs a decision

1. The four schema drifts — run the `pg_constraint` query above (**most urgent**).
2. `WEBHOOK_SIGNATURE_ENFORCE` — after reading `WEBHOOK_SIGNATURE_AUDIT` logs.
3. Applying the RLS migration, and whether to extend it to the 14 non-agent tables.
4. How to make the suite runnable from a clean clone.

### The three things to read first

1. **`NEEDS-DECISION 1` above — the four schema drifts.** This is the only item tonight that might
   mean something is broken in production right now: if the constraints match the repo, background
   goals and every web watcher are failing to persist. One query settles it.
2. **Section 8.3 of `01-askgogo-capability-audit.md`** — the durable table map those drifts came
   from, plus the two tables (`agent_steps`, `agent_threads`) that 15 modules write and no migration
   defines. The repo is not currently the source of truth for the schema, and that is the root cause
   under all six findings.
3. **Sections 9 and 11 of `02-instinct-teardown.md`** — what Instinct does not appear to have, and
   the seven axes scored. Read section 0 first so you know what the evidence is worth. The strategic
   read: the market is paying for reach, not restraint, and AskGogo's advantage is narrower than it
   looks — but all four of Instinct's first-week failures are authorization and data-boundary
   failures, which is the one class AskGogo is architected to prevent.

---

# LIVE BUG — 19 Sep 10:05–10:08, browser routing divergence

Read-only investigation. **No code was changed.** Every claim below is cited to `file:line` at
commit `6ed02fc` (branch `claude/overnight-hardening-2026-09-19`).

Where a claim is proven from source it is marked **[CODE]**. Where it is the most probable cause
but needs a production log line to confirm, it is marked **[PROBABLE]** and names the exact log key
that settles it. Nothing here was verified against production logs — this session cannot reach them.

## Summary

The two messages did **not** route differently. They are byte-for-byte equivalent to every matcher
in the dispatch chain, and both were claimed by the same handler. **[CODE]**

What differs is what happened *inside* that handler, and the two failures are unrelated:

- **Message A** — the browser leg succeeded. The reply it produced was **too long for one WhatsApp
  message**, `sendWhatsApp` splits and sends chunks in a loop, a later chunk's send threw, and the
  webhook's outer catch emitted the "temporarily unavailable" copy *after the first chunk had
  already been delivered*. **[CODE]** for the mechanism, **[PROBABLE]** for which chunk failed.
- **Message B** — the browser leg **threw**. `routeFeatureIntent`'s catch-all converts any exception
  from the agent bridge into `return null`, which is indistinguishable from "no specialist wanted
  this". The message then fell through to the plain-LLM path, and the model — which has no browser
  tool — truthfully described *itself* as unable to browse. **[CODE]** for the swallow-and-fall-
  through, **[PROBABLE]** for the throw's origin.

**The most important finding is not either bug. It is that a browser failure and a browser
non-match are the same event to this codebase**, so an infrastructure fault silently degrades into
a confident false denial of a shipped capability.

## 1. Which handler claims A, which claims B

**Both are claimed by `tryRunBrowserCommand` (`lib/agent/whatsapp-bridge.ts:239`), hop G11 of the
specialist chain.** Proof that the two messages are equivalent to every gate above it:

`parseBrowserCommand` (`lib/agent/browser-command.ts:34-55`) needs two things:

1. a URL — `extractUrl` (`:19-23`), regex `/https?:\/\/[^\s<>)\]}]+/i`. Both match.
2. an action signal — `:37`, `/\b(open|browse|browser|website|site|page|form|fill|apply|submit|book|checkout|buy|purchase|reserve|navigate|go to|visit|inspect|check)\b/`
   tested against the message **with URLs stripped** (`actionTextWithoutUrls`, `:25-27`).

For both messages the stripped text is `"open and tell me the first three results with their
prices"`. Both hit `open`. Neither hits a purchase/booking/submit/fill word, so both resolve to
`mode:'read'`, `risk:'low'` (`:47`, `:52`). **The parse result is identical.** **[CODE]**

### Every candidate you listed, eliminated

| Candidate | Verdict | Evidence |
|---|---|---|
| **Host allowlist** | **Eliminated.** There is no static allowlist. `allowedHosts` (`lib/agent/secure-computer.ts:42-48`) *derives* the policy from the requested URL: `{[hostname]:[], ['*.'+hostname]:[]}`. `amazon.in` and `flipkart.com` are treated identically | `secure-computer.ts:47` |
| **URL pattern matching** | **Eliminated.** One regex, no host logic | `browser-command.ts:20` |
| **Booking/link-preview handler claiming amazon.in first** | **Eliminated.** `BOOKING_HOSTS` is `bmsurl.co, bookmyshow.com, in.bookmyshow.com, district.in, paytm.com, insider.in`. Neither host is in it, and the keyword fallback needs cinema/ticket words | `lib/services/whatsapp-preview-routing.ts:16-30` |
| **WhatsApp link-preview card changing the body** | **Not the cause.** A preview card sets `numMedia>0` with an image thumbnail and diverts to the media branch at `app/api/webhooks/whatsapp/route.ts:424` — that branch never reaches `routeFeatureIntent`, so B could not have produced a planner-style reply through it | `route.ts:420-424`, `whatsapp-preview-routing.ts:32-37` |
| **Web-watch handler (runs at G10, *before* the browser)** | **Eliminated.** `parseWebWatchCommand` requires `^watch\|monitor\|track …` | `lib/agent/watch-command.ts:17-20` |
| **Flight-watch handler (G3)** | **Eliminated for these messages**, but see the latent risk below | `watch-command.ts:282` requires `parseFlightWatchRequest` |

### Latent risk found while eliminating the flight path

`parseFlightIdentifier` (`lib/agent/watch-command.ts:183-192`) matches
`/\b([A-Z0-9]{2,3})\s*-?\s*(\d{1,4}[A-Z]?)\b/i`. Against `sony wh-1000xm5` this matches the
substring `xm5` as **code `XM`, number `5`** — flight "XM 5". `XM` is not in `FLIGHT_CODE_STOPWORDS`
(`:172-174`, which holds only English two-letter words). It did not fire here because `:282` gates
it behind `parseFlightWatchRequest`, **but `:271-278` reaches it by a second route**: if a
`pending_flight_watch` follow-up state is less than 30 minutes old and the new message does not
`looksLikeIndependentCommand`, the identifier is parsed directly. A user mid-flight-watch who sends
a product model number can have it captured as a flight number. Not today's bug; same family as the
six. **[CODE]**

### So why did B fail and A not

Because `routeFeatureIntent` cannot tell a crash from a decline:

```
lib/feature-intents.ts:352   const agent = await tryRunWhatsAppAgent({ user, text })
lib/feature-intents.ts:353   if (agent?.text) return agent.text
…
lib/feature-intents.ts:359 } catch (err: any) {
lib/feature-intents.ts:360   console.error('WHATSAPP_AGENT_BRIDGE_FAILED:', err?.message || err)
lib/feature-intents.ts:361   return null
lib/feature-intents.ts:362 }
```

`return null` is the same value the bridge returns when no specialist matched
(`whatsapp-bridge.ts:260`). The webhook treats null as "nobody handled it" and continues to
`processIncomingMessage` (`app/api/webhooks/whatsapp/route.ts:1272`). **[CODE]**

`executeBrowser` re-throws every failure after recording it (`browser-command.ts:146-151`,
`throw err` at `:151`), and `withWhatsAppBrowserBudget` uses `Promise.race`
(`whatsapp-bridge.ts:87`), which propagates a rejection rather than swallowing it. So **any**
browser exception reaches that catch. **[CODE]**

**[PROBABLE] — what threw for amazon.in.** Candidates, all of which produce exactly this outcome:

- `secure_browser_action_failed` — the in-sandbox node command exits non-zero
  (`secure-computer.ts:233`), which is what a hard block or a `page.goto` rejection produces
- `secure_browser_action_empty_output` (`:234`)
- `browser_run_create_failed` / step insert failure (`browser-command.ts:77`, `:85`) — note
  `agent_steps` is one of the two tables with **no migration in this repo** (drift D5), so its
  constraints are unknown
- `browser_permission_failed` on any Supabase read error (`browser-command.ts:59`)

Two things narrow it. First, it threw **fast**: the WhatsApp browser budget is 42s
(`whatsapp-bridge.ts:28`) and the in-sandbox navigation timeout is 45s
(`secure-computer.ts:56`) — a hang would have hit the budget first and returned the "took longer
than WhatsApp's safe response window" message (`whatsapp-bridge.ts:80`), which the user did not
see. Second, a *provider block* would not have thrown at all: `runSecureBrowser` returns
`status:'blocked'` and `executeBrowser` converts that into a polite paused reply
(`browser-command.ts:121-138`). So this was neither a timeout nor a detected block.

**The single log line that settles it:** grep production for `WHATSAPP_AGENT_BRIDGE_FAILED:`
(`feature-intents.ts:360`) at 10:07, and `SECURE_BROWSER_FAILED:` (`secure-computer.ts:248`), which
logs the full stack.

## 2. Source of "I cannot open… I'm a text-based AI assistant"

**It is not in the codebase.** `grep -rniE "cannot open|text-based|ability to browse|unable to
browse|don't have the ability" lib app --include=*.ts` returns **zero matches**. It is not a
hardcoded fallback and not a system prompt. **[CODE]**

It is **model output**, and it did not come from `tryRunGeneralPlan` — that never ran, because the
bridge had already thrown at G11, eight hops before the general planner at
`whatsapp-bridge.ts:251`. **[CODE]**

The path is `processIncomingMessage` → `detectIntent` → **`web_search`**:

```
lib/bot/detect-intent.ts:49    const SEARCH_HINTS = ['latest','news','today','current','score','stock','price']
lib/bot/detect-intent.ts:173   if (SEARCH_HINTS.some((k) => lower.includes(k))) return { type: 'web_search', confidence: 'medium' }
```

Message B contains **"prices"**, which contains the substring `price`. → `web_search`. **[CODE]**

```
lib/bot/process-message.ts:1036  const searchContext = await searchWeb(incomingText)
lib/bot/process-message.ts:1038  try { reply = await askClaudeWithContext(incomingText, searchContext, resolvedUser.name) } …
```

This explains **both halves** of what the user saw: the model refuses (it has no browser tool in
that call), then answers from `searchContext` — which is why USD prices from ZDNET review articles
were offered for an `amazon.in` query. **[CODE]**

### There is already a refusal filter, and it misses this exact wording

```
lib/bot/process-message.ts:1039
  if (!reply || /i apologize|unable to provide|don't have access|couldn't fetch|web search failed/i.test(reply))
    reply = buildDirectWebAnswer(incomingText, searchContext)
```

None of `"I cannot open"`, `"without the ability to browse websites"`, `"I'm a text-based AI
assistant"` or `"I don't have the ability to browse"` matches that alternation, so the refusal
passed straight through to the user. The identical filter with the identical gap exists a second
time at `lib/bot/process-message.ts:1234`. **[CODE]**

**This text is false about the product and must never be emitted** — agreed, and note it is
reachable from any message containing `price`, `today`, `latest`, `news`, `current`, `score` or
`stock` whenever the agent bridge declines or throws. It is not specific to browser failures.

## 3. Is the fail-closed rule trains-only? Yes.

Commit `35e9aed`'s rule lives in one function and is scoped to the train path. The comment states
the exact failure being prevented — the one that just recurred in a different guise:

```
lib/agent/train-research.ts:170-173
  // Fail CLOSED. Throwing here let the caller fall through to the general planner,
  // which answered from the model — the user received invented train numbers and
  // timings after the browser never opened. A failed provider read must report the
  // failure, never hand the question to a path that can fabricate inventory.
```

It returns a `status:'failed'` **result** instead of throwing (`:174`), so the bridge keeps the
turn. **No other specialist does this.** **[CODE]**

The only other anti-fabrication control is `hardenTravelResearchResult`
(`lib/agent/travel-research-sanitize.ts:71`), applied at exactly four call sites, all travel
research: `whatsapp-bridge.ts:231`, `whatsapp-bridge.ts:256`, `app/api/agent/run/route.ts:98`,
`app/api/agent/run/route.ts:138`. It is **not** applied to browser results, general-plan results,
or anything in `process-message.ts`. **[CODE]**

### Every path that can still present unverified prices, availability or inventory

| # | Path | `file:line` | Why it can fabricate |
|---|---|---|---|
| 1 | `web_search` intent | `process-message.ts:1030-1043` | `askClaudeWithContext` over search snippets; no sanitizer; the refusal filter at `:1039` is the only guard and it is incomplete. **This is what answered message B** |
| 2 | `general_chat` → `parsed.type === 'search'` | `process-message.ts:1228-1237` | Same call, same incomplete filter at `:1234` |
| 3 | `general_chat` → `askClaude` | `process-message.ts:1202` | Free-form model answer from memories and history |
| 4 | **General planner's generic step** | `general-planner.ts:312` | Any step whose tool is not `web_search`/`artifact`/`tasks`/`lists`/`reminders`/`memory`/`calendar` falls to `dispatchThroughSameBrain`, which at `same-brain.ts:141` calls `processIncomingMessage` — i.e. it re-enters paths 1–3. The planner inherits every fabrication route above it |
| 5 | Agent-bridge repair path | `feature-intents.ts:356` | On normalised input, `dispatchThroughSameBrain` → same as #4 |
| 6 | Simple workspace read | `feature-intents.ts:347-349` | Same dispatch |
| 7 | Travel research public-web fallback | `travel-research.ts:107` | **Partially mitigated** — it labels itself "fallback sources only, not completed live inventory" and is the one path that is honest about its tier |

Paths 1–6 have no equivalent of the train rule and no sanitizer. Any of them can state a price.

## 4. Message A — what fails between a good page read and the reply

The browser leg **succeeded**, and the observed text proves it. `"Gogo completed the browser
research task."` is generated at `lib/agent/secure-computer.ts:245` on the success branch, and the
page title comes from `:244`. **[CODE]**

The reply is then assembled at:

```
lib/agent/browser-command.ts:145
  text:`${result.summary}\n\n${result.title}\n${safe(result.pageText,1800)}`
```

`result.pageText` is carried out of the sandbox at up to **9,000** characters
(`secure-computer.ts:246`, `safeText(page.text,9000)`) and trimmed to **1,800** here. With summary
and title, the reply routinely exceeds **1,550** — `WA_MAX_CHARS` (`lib/whatsapp.ts:46`). **[CODE]**

The send path then does this:

```
lib/whatsapp.ts:90    const chunks = splitIntoChunks(sanitizeMarkdownForWhatsApp(text || ''))
lib/whatsapp.ts:93    for (let i = 0; i < chunks.length; i++) {
lib/whatsapp.ts:97      const message = await client.messages.create(payload)   // ← no try/catch
lib/whatsapp.ts:109     if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 300))
```

**There is no error handling inside the loop.** If chunk 1 is delivered and chunk 2's
`messages.create` rejects, the user has already received the first part, and the rejection escapes
`sendWhatsApp` → `sendWhatsAppMessage` (`lib/channels/whatsapp.ts:46`) → the webhook. **[CODE]**

The failure point is therefore **after the successful page read and after the first chunk is
delivered — inside the multi-chunk send loop**, not in the browser leg. The rest follows
mechanically:

```
app/api/webhooks/whatsapp/route.ts:991-993   saveConversation(user) ; saveConversation(assistant) ; sendWhatsAppMessage(…)  ← throws here
app/api/webhooks/whatsapp/route.ts:1283      } catch (error: any) {
app/api/webhooks/whatsapp/route.ts:1292        await sendWhatsAppMessage(from, 'Something went wrong — try once more?')
lib/channels/whatsapp.ts:6-10                 sanitizeWhatsAppReply() rewrites that exact string to
                                              "I couldn't finish that request just now because one of my
                                               services was temporarily unavailable…"
```

That rewrite at `lib/channels/whatsapp.ts:8` matches the observed copy **verbatim**, which confirms
the whole chain. Note the conversation rows at `:991-992` were already written, so the transcript
records a reply the user only partially received. **[CODE]**

**[PROBABLE] — why the chunk send failed.** Most likely Twilio rejecting the second chunk: raw
Flipkart search text is dense, and `splitIntoChunks` (`lib/whatsapp.ts:48-75`) splits on `\n\n` then
`\n`; a block with neither yields a hard slice that can produce an oversized or empty body (Twilio
21602/21617), and back-to-back sends 300ms apart can also hit rate limiting. The log line that
settles it is `WHATSAPP_SENT:` (`lib/whatsapp.ts:100`) — count how many chunks logged for the 10:05
message before the error, and read the Twilio error code in the webhook catch at `route.ts:1284`.

## 5. Class: distinct from the six, and in the opposite direction

**The six prior hijacks and this bug are different classes.** Evidence:

| | The six (weather/`trains`×2, nutrition, list, split, `classifyCheckVerb`) | This bug |
|---|---|---|
| Where | **Upstream** of the specialist chain — webhook text gates, `routeFeatureIntent`, the legacy router | **At and below** the specialist, at `whatsapp-bridge.ts:239` and after |
| What went wrong | A matcher claimed a turn it should have declined | The right handler claimed the turn and then **failed** |
| Symptom | Wrong handler, confidently wrong answer | Right handler, then either a truncated reply (A) or a **false denial of capability** (B) |
| Fix shape | Narrow the matcher (word boundaries, shape tests, existence gates) | Stop conflating failure with non-match; stop emitting refusals from a path that has no browser |

The routing layer behaved **correctly** here. `parseBrowserCommand` claimed both messages, which is
exactly right. **[CODE]**

So this is a **new, third class**, and it is worth naming because the mitigation is different:

> **Failure-to-decline conflation.** A specialist that throws is indistinguishable from a
> specialist that declined, so an infrastructure fault is silently downgraded to the least-capable
> path — which then denies, in the product's own voice, that the capability exists.

It is closer to the train incident that produced `35e9aed` than to the six hijacks: same root shape
(a failed provider read handed to a path that answers from the model), different provider, and this
time the fall-through happened one layer higher — at `feature-intents.ts:361` rather than inside a
specialist. The train fix was applied inside `train-research.ts` only, which is precisely why it
did not protect the browser path.

**Both halves of §1's summary share one line of code.** `feature-intents.ts:361`'s bare `return
null` is the reason a browser crash becomes an LLM refusal. The train precedent shows the shape of
the fix (return a `status:'failed'` result that keeps the turn instead of letting it fall through),
but per instruction nothing was changed.

## Diagnostics to pull, in priority order

1. `WHATSAPP_AGENT_BRIDGE_FAILED:` at 10:07 — names B's exception in one line
   (`feature-intents.ts:360`)
2. `SECURE_BROWSER_FAILED:` at 10:07 — the full stack (`secure-computer.ts:248`)
3. `WHATSAPP_SENT:` around 10:05 — how many chunks went out before the failure
   (`lib/whatsapp.ts:100`)
4. The Twilio error code logged by the webhook catch at 10:05 (`route.ts:1284`)
5. `agent_runs` rows for that user between 10:00 and 10:10 — A should be `completed`
   (`browser-command.ts:143`); B's row tells you how far it got before throwing
