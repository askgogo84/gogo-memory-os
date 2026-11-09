# AskGogo 100-user release gate

Created 9 Nov 2026. This is the launch ledger: **no public onboarding until every REQUIRED gate is `pass` with dated
evidence**. A gate is `pass` only when its automated CHECK exits 0 on the release SHA *and* its LIVE check was done by
a person on production and recorded below. Agent reports, PR descriptions and "tests pass" claims are not evidence on
their own.

Scope: the use cases AskGogo actually ships for launch. Cases from `docs/daily-use-case-acceptance.md` marked **Gap**
(Spotify, xpub, podcasts, video editing, avatars, IVR calls, Shopify/Stripe, Notion) are **out of scope** and must not
be advertised.

How to run every automated check at once (Claude Code, repo root):

```
NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co SUPABASE_SERVICE_ROLE_KEY=fixture ANTHROPIC_API_KEY=test OPENAI_API_KEY=test npm test
```

Note: `scripts/verify-hybrid-recall-nov9.mts` and `scripts/verify-setup-known-nov9.mts` land with PRs #1396 and #1395.

Status legend: `unverified` (default) · `pass <date> <who> <evidence>` · `fail <date> <what happened>` · `waived <reason, by owner>`.

## A. Safety and isolation (all REQUIRED)

| # | Gate | Automated CHECK | LIVE check | Status |
|---|---|---|---|---|
| A1 | Every privileged/cron route rejects unauthenticated calls | `scripts/verify-privileged-route-auth.mts`, `scripts/verify-cron-followups-security.mts` | Vercel logs show 401 for any unauthenticated cron hit in the last 24 h, no 200 | unverified |
| A2 | No anon/authenticated grants on private tables | `scripts/verify-sql-table-grants.mts` | Supabase SQL (qenhjcooyecmatwducpu): §E query (browser-role grants on tables without RLS) returns 0 rows | unverified |
| A3 | Owner ids kept exact (no `Number()` before auth) | `scripts/verify-billing-owner-isolation-nov7.mts`, `scripts/verify-plan-checkout-owner-isolation-literal.cjs`, `scripts/verify-link-vault-owner-isolation.mts` | Second number (8310441698) cannot see the first account's reminders, memories, expenses or Spaces in chat or dashboard | unverified |
| A4 | Payments bound to the paying WhatsApp owner | `scripts/verify-plan-checkout-owner-isolation-literal.cjs` | Owner taps a plan on the second number; Razorpay checkout shows that number's plan and nothing is charged without the owner completing payment | unverified |
| A5 | Consequential actions need an unexpired, bound approval | `scripts/verify-approval-card-v2.mts`, `scripts/verify-approval-ttl-disambiguation.mts`, `scripts/verify-expired-approval-card-nov9.mts`, `scripts/verify-procedures-runtime-nov9.mts` | An approval older than its expiry shows "Expired, nothing was done" with no buttons | unverified |
| A6 | Gmail send only after explicit consent and approval | `scripts/verify-gmail-consent-boundary.mts`, `scripts/verify-gmail-send-flow.mts`, `scripts/verify-gmail-connect-consent.mjs` | Ask "reply to Nithin's last mail saying I'll send it Monday": draft appears, nothing sent until tap | unverified |
| A7 | Forget everything clears memory and the semantic graph | `scripts/verify-memory-export-nov8.mts`, `scripts/verify-semantic-spine-nov9.mts` | On the second number: save a note, send `forget everything`, then ask about it: Gogo has no record; §E graph query returns 0 current rows for that owner | unverified |
| A8 | No sensitive inference into unrelated answers | `scripts/verify-hybrid-recall-nov9.mts` | With hybrid recall on: tell Gogo a health detail, later ask for breakfast ideas — the health detail is not mentioned | unverified |
| A9 | No claim of done without provider evidence | `scripts/verify-claim-guard-ticket-reminder-nov9.mts`, `scripts/verify-booking-closure.mts` | Ask for a booking that cannot complete: reply says not booked, never "booked" | unverified |
| A10 | Quiet WhatsApp: no unsolicited messages beyond the agreed nudge | `scripts/verify-quiet-whatsapp.mts`, `scripts/verify-proactive-email.mts` | 48 h on the second number with no activity: at most the one re-engagement nudge | unverified |

## B. Core use cases (REQUIRED)

| # | Use case | Automated CHECK | LIVE check (send exactly, on WhatsApp unless noted) | Expected | Status |
|---|---|---|---|---|---|
| B1 | Reminders | `scripts/verify-reminder-dedup.mts`, `scripts/verify-reminder-completion.mts`, `scripts/verify-reminder-list-p0.mts` | `remind me to call Divya tomorrow at 9:15 am` then `show my reminders` | One reminder at 9:15 IST, listed once; fires on time | unverified |
| B2 | Memory save and recall | `scripts/verify-connected-memory-oct29b.mts`, `scripts/verify-context-brain.mts` | `remember Nithin prefers calls after 4 pm` then next day `when should I call Nithin?` | "after 4 pm", attributed to what you said | unverified |
| B3 | Calendar read and conflicts | `scripts/verify-calendar-account.mts`, `scripts/verify-agent-travel-calendar.mts` | `what's on my calendar tomorrow?` | Matches Google Calendar exactly, IST times | unverified |
| B4 | Meeting prep | `scripts/verify-meeting-prep.mts`, `scripts/verify-meeting-prep-constraints.mts` | `prepare me for my next meeting` | Attendees, recent mail, open items, and says what it could not check | unverified |
| B5 | Mail attention | `scripts/verify-attention-briefing-content.mts`, `scripts/verify-acceptance-mail-briefing-routing.mts` | `anything important in my mail?` | Real threads only; no welcome/askgogo.in automation mail | unverified |
| B6 | Flights and tickets | `scripts/verify-ticket-upcoming-nov8.mts`, `scripts/verify-ticket-qr-retrieval.mts`, `scripts/verify-dashboard-flight-specialist-oct26.mts` | `show my next ticket` | The next upcoming ticket, not an old one | unverified |
| B7 | Live flight status | `scripts/verify-context-graph-nov9.mts` | `has my flight landed?` (on a travel day) | Live provider status, or says it cannot read live status — never an old note | unverified |
| B8 | Bookings (movie/restaurant) prepare → approve | `scripts/verify-booking-closure.mts`, `scripts/verify-booking-context-isolation.mts` | `book 2 tickets for Ramayana this Saturday evening near Rajajinagar` | Options with exact show/time; approval card; no "booked" without confirmation | unverified |
| B9 | Briefing on demand | `scripts/verify-topic-brief-nov9.mts` | Dashboard chat: `brief me` | Brief card with items and topic chips | unverified |
| B10 | Lists and checklists | `scripts/verify-checklist-batch1.mts`, `scripts/verify-checklist-batch2.mts` | `add milk and eggs to my grocery list` then `show grocery list` | Both items, once each | unverified |
| B11 | Expenses | `scripts/verify-expense-period-acceptance.mts`, `scripts/verify-expense-delete-oct21.mts` | `spent 450 on lunch` then `how much did I spend this week?` | Includes 450, correct week boundary | unverified |
| B12 | Watches | `scripts/verify-agent-watchers.mts`, `scripts/verify-agent-web-watch.mts`, `scripts/verify-watcher-pause-nov9.mts` | Dashboard → Radar: pause then resume a watch | Pause stops checks; resume checks right away | unverified |
| B13 | Spaces | `scripts/verify-spaces-render-nov8.mts`, `scripts/verify-space-from-chat-nov9.mts` | Dashboard chat: `build me a page for the Goa trip` | A Space page with the trip's real items | unverified |
| B14 | Voice in, Listen out | `scripts/verify-listen-nov9.mts`, `scripts/verify-acceptance-recall-flight-voice.mts` | WhatsApp voice note "remind me to pay rent on the 1st"; dashboard: tap Listen on a reply | Same reminder as text; audio plays | unverified |
| B15 | Onboarding | `scripts/verify-onboarding-examples.mjs`, `scripts/verify-setup-known-nov9.mts` | New number sends `hi` | Intro once; dashboard empty chat shows "Gogo already knows your setup" | unverified |

## C. Operations (REQUIRED)

| # | Gate | Evidence needed | Status |
|---|---|---|---|
| C1 | Production error log clean for 24 h | Vercel runtime errors: only known/accepted entries (list them) | unverified |
| C2 | Known mailbox scope error resolved | goverdhan@tipplr.in reconnected with Gmail read scope, or the account removed | unverified |
| C3 | Cost per active user within plan | `scripts/verify-usage-limits-margin.mts` + one day of real usage cost / active users ≤ plan margin | unverified |
| C4 | Rollback rehearsed | Vercel: promote previous deployment and back, both < 2 min | unverified |
| C5 | Open security PR backlog triaged | Every open P0/P1 PR merged, superseded or explicitly waived by the owner in #274 | unverified |
| C6 | Kill switches documented and tested | `docs/launch/kill-switches.md`: each switch flipped once on production | unverified |

## D. Not required for launch (flags stay as listed)

| Feature | Flag | Launch state |
|---|---|---|
| Semantic graph sync | `GOGO_SEMANTIC_OWNERS` | owner only |
| Decision context | `GOGO_CONTEXT_GRAPH` | shadow, owner only |
| Hybrid recall | `GOGO_HYBRID_RECALL` | off (shadow owner-only once #1396 is deployed) |
| Procedures | `GOGO_PROCEDURES_OWNERS` | off |
| Nav v2 | `GOGO_NAV_V2_OWNERS` | owner only |
| Spaces | `GOGO_SPACES_OWNERS` | owner only |
| Obscura browser | — | off; needs independent sandbox, supply-chain and privacy review |
| Memorilla runtime | — | not deployed (see `docs/architecture/same-brain-3/memorilla-evaluation.md`) |

## E. SQL checks (Supabase SQL editor, project qenhjcooyecmatwducpu)

A2 — tables the browser roles can reach that have **no** row-level security (expected: 0 rows):

```sql
select distinct g.table_name, g.grantee
from information_schema.role_table_grants g
join pg_class c on c.relname = g.table_name
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where g.table_schema = 'public' and g.grantee in ('anon','authenticated') and c.relkind = 'r' and not c.relrowsecurity
order by 1;
```

A7 — current semantic rows for an owner after `forget everything` (expected: 0):

```sql
select count(*) from public.semantic_assertions where scope_id = '<owner telegram id>' and assertion_status = 'current';
```

## Sign-off

| Date | Release SHA | Required gates passed | Signed off by |
|---|---|---|---|
| | | 0 / 31 | |
