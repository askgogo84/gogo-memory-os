# Claude/main change inventory

Baseline 07e8aa95 (19 Oct handoff) → b563a57 (#734). Inventory of all 68 commits and changed paths; review status is in always-on-implementation-ledger.md. This is not a live acceptance report.

### 597a6ec fix: route original currency queries to dated reference estimates (rebased #663) (#665)

app/api/dashboard/chat/route.ts
lib/bot/handlers/reference-fx.ts
lib/bot/process-message.ts
package.json
scripts/verify-content-workflows.mts
scripts/verify-reference-fx-chat-routing.mts
scripts/verify-reminder-appointment-lead-time.mts
scripts/verify-shopping-friend-routing.mts
### 230d02b fix: gold purity boundaries, live acceptance defects, and Muse/Wajo task lifecycle (19 Oct batch) (#666)

app/api/agent/approvals/[id]/route.ts
app/api/dashboard/chat/route.ts
app/api/expenses/route.ts
app/api/webhooks/whatsapp/route.ts
lib/agent/approval-guard.ts
lib/agent/approval-ttl.ts
lib/agent/attention-state.ts
lib/agent/autonomous-runtime.ts
lib/agent/autonomy-pulse.ts
lib/agent/persistent-general-plan.ts
lib/agent/run-cancel.ts
lib/agent/run-notify.ts
lib/agent/stale-runs.ts
lib/agent/task-lifecycle.ts
lib/agent/task-status.ts
lib/agent/typed-time-routing.ts
lib/agent/whatsapp-bridge.ts
lib/bot/handlers/gold-quotes.ts
lib/bot/handlers/morning-briefing.ts
lib/bot/process-message.ts
lib/bot/services/expense-storage.ts
package.json
scripts/verify-approval-ttl-disambiguation.mts
scripts/verify-approx-location.mts
scripts/verify-calendar-presentation.ts
scripts/verify-content-workflows.mts
scripts/verify-gold-quote-provenance.cjs
scripts/verify-jev-dashboard-guard.mts
scripts/verify-live-acceptance-oct19.mts
scripts/verify-run-cancel.mts
scripts/verify-run-outcome-notice.mts
scripts/verify-task-status-query.mts
scripts/verify-travel-background-flow.mts
### 9b19085 fix: Toit reservations, no contentless reminders, false-receipt guard, gold alerts (19 Oct round 2) (#667)

app/api/dashboard/chat/route.ts
app/api/webhooks/whatsapp/route.ts
lib/agent/approval-ttl.ts
lib/agent/autonomy-status.ts
lib/agent/context-brain.ts
lib/agent/gold-rate-rule.ts
lib/agent/gold-watch.ts
lib/agent/restaurant-reservation.ts
lib/agent/task-status.ts
lib/agent/watch-command.ts
lib/agent/watchers.ts
lib/agent/whatsapp-bridge.ts
lib/bot/action-claim-guard.ts
lib/bot/detect-intent.ts
lib/bot/handlers/gold-quotes.ts
lib/bot/handlers/reminders.ts
lib/bot/process-message.ts
package.json
scripts/verify-content-workflows.mts
scripts/verify-gold-quote-provenance.cjs
scripts/verify-gold-rate-watch.mts
scripts/verify-live-acceptance-oct19b.mts
scripts/verify-persistent-watch-handoff.mts
scripts/verify-scorecard-oct17.mts
scripts/verify-shopping-friend-routing.mts
scripts/verify-upcoming-trip-context.mts
### ae50bc2 Web search: Tavily → Serper → Anthropic chain with 30-min quota backoff (#670)

lib/web-search.ts
package.json
scripts/verify-search-quota-backoff.mts
### 947dc66 Concise answers: one gold rate per purity, brief web answers, recent-only news (#671)

lib/bot/handlers/gold-quotes.ts
lib/services/claude.ts
lib/web-search.ts
package.json
scripts/verify-concise-web-answers.mts
scripts/verify-gold-quote-provenance.cjs
scripts/verify-scorecard-oct17.mts
### d939add Concise Fo-style task status replies (#672)

lib/agent/attention-state.ts
lib/agent/autonomy-status.ts
lib/agent/task-status.ts
package.json
scripts/verify-concise-status-replies.mts
scripts/verify-open-loops-attention.mts
scripts/verify-task-status-query.mts
### da59571 fix: gold alert place parsing + short confirmation; comparisons reuse the owner's watched iPhone size (#673)

lib/agent/gold-rate-rule.ts
lib/agent/gold-watch.ts
lib/commerce/price-comparison.ts
package.json
scripts/verify-gold-rate-watch.mts
scripts/verify-oct19-instinct-parity.mts
### a782cf5 fix: Toit reservations read the first-party ReserveGo widget and reply Instinct-style (#674)

app/api/webhooks/whatsapp/route.ts
lib/agent/restaurant-reservation-worker.ts
lib/agent/restaurant-reservation.ts
lib/agent/whatsapp-bridge.ts
package.json
scripts/verify-reservation-first-party.mts
scripts/verify-shopping-friend-routing.mts
### b8e4c7b fix: read Toit's ReserveGo times from the widget's public feed instead of timing out in a browser (#675)

lib/agent/reservego.ts
lib/agent/restaurant-reservation.ts
package.json
scripts/verify-reservego-feed.mts
### 2a2242a fix: Toit name step no longer dead-ends on an incomplete Calendar read (#677)

lib/agent/restaurant-reservation.ts
scripts/verify-reservation-first-party.mts
### cf0bffb feat: event/train reminders carry venue, screen, seats, booking ID and a leave-by time (Wajo parity) (#676)

app/api/webhooks/whatsapp/route.ts
lib/services/pdf-reader.ts
lib/services/travel-tickets.ts
package.json
scripts/verify-rich-event-reminders.mts
### b2636fb fix: Toit live-slot approval is not refused by a weeks-long calendar block; real overlaps are shown (#678)

lib/agent/restaurant-reservation.ts
scripts/verify-reservation-first-party.mts
### 0ede916 feat: pending-question registry — short replies resume the question Gogo asked (understand-first PR 1) (#668)

app/api/agent/run/route.ts
app/api/cron/autonomous-runs/route.ts
app/api/dashboard/chat/route.ts
app/api/webhooks/whatsapp/route.ts
docs/architecture/05-understand-first-router.md
lib/agent/reservation-guest-name.ts
lib/agent/restaurant-reservation.ts
lib/bot/detect-intent.ts
lib/bot/handlers/deterministic.ts
lib/bot/handlers/followup-state.ts
lib/bot/handlers/reminders.ts
lib/bot/pending-followup.ts
lib/bot/pending-question-resolver.ts
lib/bot/pending-questions.ts
lib/bot/process-message.ts
lib/bot/reminder-command.ts
package.json
scripts/verify-content-workflows.mts
scripts/verify-open-loops-attention.mts
scripts/verify-pending-question-registry.mts
scripts/verify-reminder-appointment-lead-time.mts
scripts/verify-reservation-exact-time.mts
scripts/verify-reservation-first-party.mts
scripts/verify-shopping-friend-routing.mts
### 87807e1 Fix 19 Oct incident: no false 'Booking confirmed', bare APPROVE/1 bind correctly, Toit arms, ticket QR, local times (#681)

app/api/webhooks/whatsapp/route.ts
lib/agent/approval-ttl.ts
lib/agent/context-brain.ts
lib/agent/reservation-dining-context.ts
lib/agent/restaurant-reservation-worker.ts
lib/agent/restaurant-reservation.ts
lib/agent/whatsapp-bridge.ts
lib/bot/completion-claim-guard.ts
lib/bot/process-message.ts
lib/services/asset-memory.ts
lib/services/claude.ts
package.json
scripts/verify-approve-flow-oct19.mts
scripts/verify-c1-context-authority.mts
scripts/verify-ticket-qr-retrieval.mts
### d96c12b feat: understand-first — one contextual reading per message, shadow record + safe live dispatch (#680)

app/api/admin/shadow-brain/route.ts
app/api/dashboard/chat/route.ts
app/api/webhooks/whatsapp/route.ts
docs/architecture/06-understand-first-shadow.md
lib/agent/reminder-read.ts
lib/agent/understand-first.ts
lib/agent/understanding-context.ts
lib/agent/understanding-report.ts
lib/agent/understanding.ts
lib/bot/handlers/flight-status.ts
lib/bot/process-message.ts
lib/typesafe/systemone.ts
package.json
scripts/fixtures/understanding-golden.json
scripts/verify-understanding-golden.mts
### 24f657b fix: 'What are you working on?' answers fast and leads with current items (#682)

lib/agent/autonomy-status.ts
package.json
scripts/verify-status-fresh-fast.mts
### 1473467 docs: memory scopes, provenance and enterprise isolation plan (QM-derived) (#683)

docs/architecture/07-memory-scopes.md
### bae66d7 fix: dashboard ticket/QR retrieval and past-event "my bookings" (20 Oct live) (#684)

app/api/dashboard/chat/route.ts
lib/agent/my-bookings.ts
lib/agent/understand-first.ts
lib/bot/process-message.ts
lib/services/asset-memory.ts
lib/services/claude.ts
package.json
scripts/verify-content-workflows.mts
scripts/verify-dashboard-ticket-past-events-oct20.mts
### 15256d4 fix: lookup + 'add it to my calendar' no longer reads today's calendar; friendly cancel titles (#685)

lib/agent/autonomy-status.ts
lib/agent/lookup-then-calendar.ts
lib/agent/run-cancel.ts
lib/agent/task-title.ts
lib/bot/handlers/calendar-actions.ts
lib/bot/process-message.ts
package.json
scripts/verify-concise-status-replies.mts
scripts/verify-reminder-appointment-lead-time.mts
scripts/verify-status-fresh-fast.mts
scripts/verify-uc3-lookup-calendar-oct20.mts
### cc9f53a fix: ticket retrieval shows the ticket, not the save confirmation; ticketed bookings aren't 'waiting for approval' (#686)

lib/agent/my-bookings.ts
lib/services/asset-memory.ts
package.json
scripts/verify-x1-x2-polish-oct20.mts
### d3341e8 fix: no calendar offer when the looked-up event already happened (#688)

lib/agent/lookup-then-calendar.ts
lib/bot/process-message.ts
scripts/verify-uc3-lookup-calendar-oct20.mts
### f38b387 fix: drop 'Based on the search results' lead-in from web answers (#687)

lib/services/claude.ts
package.json
scripts/verify-web-preamble-oct20.mts
### 9d0234a fix: never suggest today's date for a release; show the ticket name once (#689)

lib/agent/lookup-then-calendar.ts
lib/services/asset-memory.ts
scripts/verify-uc3-lookup-calendar-oct20.mts
scripts/verify-x1-x2-polish-oct20.mts
### e6f6f9b feat: Mercury (Inception Labs) as fast web-answer model, Claude fallback (#690)

lib/services/claude.ts
lib/services/mercury.ts
package.json
scripts/verify-mercury-web-answers.mts
### 387c85e wip: Serper-first search order + SEARCH timing logs (not merged; awaiting go-ahead) (#691)

lib/web-search.ts
scripts/verify-search-quota-backoff.mts
scripts/verify-serper-first.mts
### 228b943 perf: TIMING logs for slow steps (dashboard + processIncomingMessage) (#692)

app/api/dashboard/chat/route.ts
lib/bot/process-message.ts
package.json
### 09a8ee3 perf: time general-plan and feature-router steps; log steps >=120ms (#693)

app/api/dashboard/chat/route.ts
lib/bot/process-message.ts
### 543214c perf: run chat-reply context reads and shadow-brain reads in parallel (#694)

lib/agent/shadow-brain.ts
lib/bot/process-message.ts
scripts/verify-scorecard-oct17.mts
### 1a35771 perf: TIMING marks inside the feature routers (#695)

lib/feature-intents-legacy.ts
lib/feature-intents.ts
### 76b3cca feat: long chat memory — Mercury folds older messages into a running summary (#696)

lib/agent/conversation-summary.ts
lib/bot/process-message.ts
package.json
scripts/verify-chat-summary.mts
### 4f62ac1 perf: plain information questions skip the duplicated agent chain and general planner (#697)

app/api/dashboard/chat/route.ts
lib/agent/plain-question.ts
lib/feature-intents.ts
package.json
scripts/verify-jev-dashboard-guard.mts
scripts/verify-plain-question-gate.mts
scripts/verify-task-status-query.mts
### 7377217 perf: plain questions go straight to the web answer; parallel usage bookkeeping (#698)

lib/bot/process-message.ts
lib/data/limits.ts
scripts/verify-plain-question-gate.mts
scripts/verify-reminder-appointment-lead-time.mts
scripts/verify-shopping-friend-routing.mts
### 16eaa56 fix: clock/weather questions keep their own answer; readable links in web answers (#699)

lib/agent/plain-question.ts
lib/bot/process-message.ts
lib/services/claude.ts
scripts/verify-plain-question-gate.mts
scripts/verify-web-preamble-oct20.mts
### 4f2e93e fix: calendar shows a long-span series once; release still 'expected' is not 'already out' (#700)

lib/agent/calendar-read.ts
lib/agent/lookup-then-calendar.ts
package.json
scripts/verify-calendar-spans-oct20.mts
### 8265e7d fix: reservation keeps a venue named after the date/time ('…Saturday 8pm at District 6') (#701)

lib/agent/restaurant-reservation.ts
package.json
scripts/verify-reservation-venue-oct20.mts
### 811c58b feat: booking engine P1 — connect-once for signed-in booking apps, background on dashboard, bookings recorded (#702)

app/api/dashboard/chat/route.ts
docs/architecture/08-booking-engine.md
lib/agent/booking-engine.ts
lib/agent/restaurant-reservation-worker.ts
lib/agent/restaurant-reservation.ts
package.json
scripts/verify-booking-engine.mts
scripts/verify-reservation-first-party.mts
scripts/verify-restaurant-reservation.mts
### 7476199 feat: booking engine P2 — a sign-in wall marks the saved connection for reconnect (#703)

lib/agent/restaurant-reservation.ts
scripts/verify-booking-engine.mts
### 18d4e6e fix: phone-code booking apps need a signed-in session, not a saved number; timeout asks to connect (#704)

lib/agent/booking-engine.ts
lib/agent/restaurant-reservation.ts
scripts/verify-booking-engine.mts
### 13a29aa fix: a booking-app timeout marks the saved sign-in for reconnect; log connection state (#705)

lib/agent/restaurant-reservation.ts
scripts/verify-booking-engine.mts
### c0b8173 feat: booking compare across apps ranked by offer + one-tap sign-in (#706)

components/dashboard/settings-view.tsx
lib/agent/booking-engine.ts
lib/agent/restaurant-reservation.ts
scripts/verify-booking-engine.mts
### 12b1df6 feat: booking compare reads offers from each app's public listing page (#707)

lib/agent/booking-engine.ts
lib/agent/restaurant-reservation.ts
scripts/verify-booking-engine.mts
### 18b4560 fix: Settings sign-in opens at once; browser page shows Opening… until ready (#708)

app/api/dashboard/connections/route.ts
app/dashboard/(app)/activity/[runId]/browser/page.tsx
components/dashboard/sign-in-opening.tsx
lib/dashboard/site-sessions.ts
scripts/verify-settings-connections.mts
### 140e444 fix: gold answer no longer narrates dropped candidate quotes (#709)

lib/bot/handlers/gold-quotes.ts
scripts/verify-gold-quote-provenance.cjs
### 29bdcaa fix(calendar): collapse broken multi-week invites on every calendar surface (#710)

lib/agent/calendar-read.ts
lib/agent/read-only-schedule.ts
lib/bot/process-message.ts
lib/calendar-intervals.ts
lib/dashboard/day-chat.ts
package.json
scripts/verify-calendar-collapse-surfaces-oct20.mts
scripts/verify-calendar-read-uncertainty.mts
### 4123947 feat(commerce): order on Swiggy Instamart from chat (#711)

app/api/dashboard/chat/route.ts
app/api/webhooks/whatsapp/route.ts
lib/commerce/instamart-chat.ts
lib/commerce/swiggy-read.ts
lib/commerce/task.ts
package.json
scripts/verify-instamart-chat.mts
### 1c47a51 fix: round 4 live failures (routing, answers, reminders/memory) (#712)

app/api/dashboard/chat/route.ts
app/api/expenses/route.ts
lib/agent/autonomy-status.ts
lib/agent/booking-closure.ts
lib/agent/compound-planner.ts
lib/agent/context-brain.ts
lib/agent/gmail-send.ts
lib/agent/mission-tools.ts
lib/agent/plain-question.ts
lib/agent/task-lifecycle.ts
lib/agent/task-status.ts
lib/agent/train-research.ts
lib/agent/travel-research.ts
lib/agent/understand-first.ts
lib/agent/watch-command.ts
lib/agent/workspace-meeting-plan.ts
lib/agent/yearless-date.ts
lib/bot/detect-intent.ts
lib/bot/handlers/edit-reminder.ts
lib/bot/handlers/natural-command-routing.ts
lib/bot/process-message.ts
lib/bot/reminder-dedup.ts
lib/bot/services/expense-analyzer.ts
lib/services/claude.ts
lib/services/google-gmail.ts
lib/services/translator.ts
lib/web-search.ts
package.json
scripts/verify-mercury-web-answers.mts
scripts/verify-plain-question-gate.mts
scripts/verify-r4-answers-oct20.mts
scripts/verify-r4-memory-oct20.mts
scripts/verify-r4-routing-oct20.mts
scripts/verify-reminder-list-p0.mts
scripts/verify-shopping-friend-routing.mts
### cbe1f51 fix: recurring reminders of a different task are not merged; email recipient prefers people you wrote to; plainer inbox reply (#713)

lib/agent/gmail-send.ts
lib/bot/handlers/gmail-read.ts
lib/bot/process-message.ts
lib/bot/reminder-dedup.ts
scripts/verify-r4-routing-oct20.mts
scripts/verify-reminder-dedup.mts
### fd76f60 fix: exact reminder title wins on cancel; a received-only email address is suggested, not filled in (#714)

lib/agent/gmail-send.ts
lib/bot/handlers/edit-reminder.ts
scripts/verify-r4-memory-oct20.mts
scripts/verify-r4-routing-oct20.mts
### 7daecf1 feat: delete an expense from chat; never remark on repeated asks (#715)

app/api/expenses/route.ts
lib/bot/services/expense-storage.ts
lib/feature-intents-legacy.ts
lib/services/claude.ts
package.json
scripts/verify-expense-delete-oct21.mts
### ed6891a fix: remove a list item from chat deterministically; exact item wins (#716)

lib/bot/process-message.ts
lib/data/lists-core.ts
lib/data/lists.ts
package.json
scripts/verify-list-remove-oct21.mts
### 06fd5ed chore: CI guard - new SQL tables must grant service_role (Supabase 30 Oct change) (#717)

package.json
scripts/verify-sql-table-grants.mts
### e2863af feat: phone calls via Bolna + Plivo with an explicit call plan (#718)

app/api/cron/autonomous-runs/route.ts
app/api/dashboard/chat/route.ts
app/api/webhooks/whatsapp/route.ts
lib/agent/voice-call.ts
package.json
scripts/verify-voice-call.mts
### 5635716 fix: call intro says 'AI assistant from AskGogo'; booking name settable; venue parsed correctly (#719)

lib/agent/voice-call.ts
scripts/verify-voice-call.mts
### fedc6d7 fix: a plain 'yes' to a call plan places the call; chat can never claim it is calling (#720)

app/api/dashboard/chat/route.ts
app/api/webhooks/whatsapp/route.ts
lib/agent/voice-call.ts
lib/bot/action-claim-guard.ts
scripts/verify-voice-call.mts
### c4a14b1 fix: sturdier venue phone lookup (3 searches, trusted listings first, last plan fallback) (#721)

lib/agent/voice-call.ts
scripts/verify-voice-call.mts
### a4edb67 fix: call outcome read by Claude Haiku (Mercury returned empty); rehearsal number not part of venue (#722)

lib/agent/voice-call.ts
scripts/verify-voice-call.mts
### 1526ed1 feat: phone bookings saved to My bookings with a 2h reminder; comparison offers a call; no repeated confirmation line (#723)

lib/agent/booking-engine.ts
lib/agent/voice-call.ts
scripts/verify-voice-call.mts
### b3a0c2e feat: admin console v1 — waitlist gate with approve/block, admin password, usage and cost per user, Tools and APIs, health, Archify, audit log (#724)

app/admin/(console)/access/page.tsx
app/admin/(console)/architecture/page.tsx
app/admin/(console)/costs/page.tsx
app/admin/(console)/health/page.tsx
app/admin/(console)/layout.tsx
app/admin/(console)/page.tsx
app/admin/(console)/tasks/page.tsx
app/admin/(console)/tools/page.tsx
app/admin/(console)/users/[id]/page.tsx
app/admin/(console)/users/page.tsx
app/admin/(console)/waitlist/page.tsx
app/admin/layout.tsx
app/admin/page.tsx
app/admin/unlock/page.tsx
app/admin/users/page.tsx
app/admin/waitlist/page.tsx
app/api/admin/console/action/route.ts
app/api/admin/console/archify/route.ts
app/api/admin/console/lock/route.ts
app/api/admin/console/unlock/route.ts
app/api/dashboard/chat/route.ts
app/api/webhooks/whatsapp/route.ts
components/admin/access-forms.tsx
components/admin/admin-client.tsx
components/admin/admin-css.ts
components/admin/admin-nav.tsx
components/admin/plan-form.tsx
components/admin/rate-table.tsx
components/admin/tool-cost-form.tsx
components/admin/ui.tsx
components/admin/unlock-form.tsx
components/admin/waitlist-table.tsx
docs/admin-console/README.md
instrumentation.ts
lib/access/gate.ts
lib/admin/actions.ts
lib/admin/archify-html.ts
lib/admin/console-auth.ts
lib/admin/console-data.ts
lib/admin/vendor-billing.ts
lib/dashboard/session.ts
lib/dashboard/whatsapp-otp.ts
lib/metering/core.ts
lib/metering/fetch-meter.ts
lib/metering/record.ts
lib/whatsapp.ts
package.json
proxy.ts
scripts/verify-access-gate.mts
scripts/verify-admin-console.mts
scripts/verify-admin-waitlist.mts
scripts/verify-content-workflows.mts
scripts/verify-delivery-reliability.cjs
scripts/verify-flight-choice-buttons.mts
scripts/verify-open-loops-attention.mts
scripts/verify-shopping-friend-routing.mts
supabase/migrations/20261021150000_admin_console_v1.sql
### 34d391e fix: keep the function alive until metering writes finish, so the last model call before a reply is recorded (#725)

lib/metering/fetch-meter.ts
lib/metering/record.ts
### e3ffa01 feat: new welcome (full intro for new users, welcome back for existing), refreshed help menu, and a 'you're in' WhatsApp message when an admin approves a waitlist number (#726)

app/admin/(console)/waitlist/page.tsx
app/api/webhooks/whatsapp/route.ts
lib/admin/actions.ts
lib/bot/handlers/onboarding.ts
lib/bot/handlers/welcome.ts
lib/bot/handlers/whatsapp-direct-premium.ts
lib/whatsapp.ts
scripts/verify-admin-console.mts
scripts/verify-legacy-handoff-reason.mts
### 43615aa docs: Gogo character system (15 action states) for all dashboard work (#727)

docs/design/gogo-character/Gogo Character System.html
docs/design/gogo-character/Gogo Panels.dc.html
docs/design/gogo-character/Gogo States.dc.html
docs/design/gogo-character/Gogo.dc.html
docs/design/gogo-character/README.md
docs/design/gogo-character/shots/01-states2.jpg
docs/design/gogo-character/shots/02-states2.jpg
docs/design/gogo-character/shots/states.jpg
docs/design/gogo-character/support.js
### b6ae5da Dashboard: Muse+Wajo shell with Gogo character per action (#728)

app/dashboard-light.css
app/dashboard/(app)/home/page.tsx
app/dashboard/(app)/layout.tsx
app/dashboard/(app)/tasks/page.tsx
app/globals.css
components/dashboard/dashboard-nav.tsx
components/dashboard/feed-list.tsx
components/dashboard/gogo-live.tsx
components/dashboard/gogo-panel.tsx
components/dashboard/home-gogo-card.tsx
components/dashboard/mobile-nav.tsx
components/dashboard/rail-cards.tsx
components/dashboard/side-rail.tsx
components/gogo/gogo-agent.tsx
lib/dashboard/light-palette.mjs
lib/dashboard/shell-data.ts
lib/dashboard/task-feed.ts
lib/gogo/agent-states.ts
package.json
scripts/verify-dashboard-design-refresh.mts
scripts/verify-gogo-agent-states.mts
scripts/verify-live-usecases-oct15b.mts
scripts/verify-service-notice-surface.mts
scripts/verify-watch-dashboard-counts.mts
### 2542731 Dashboard: small list Gogos hold their pose so long task lists stay smooth on phones (#729)

app/globals.css
components/gogo/gogo-agent.tsx
scripts/verify-gogo-agent-states.mts
### 61ed0e7 Round 6 → 7 use-case fixes (#730)

app/api/dashboard/chat/route.ts
lib/agent/attention-state.ts
lib/agent/autonomy-status.ts
lib/agent/plain-question.ts
lib/agent/understand-first.ts
lib/agent/voice-call.ts
lib/bot/action-claim-guard.ts
lib/bot/detect-intent.ts
lib/bot/format-response.ts
lib/bot/handlers/edit-reminder.ts
lib/bot/handlers/reminders.ts
lib/bot/handlers/whatsapp-direct-premium.ts
lib/bot/pending-summary.ts
lib/bot/process-message.ts
lib/services/asset-memory.ts
package.json
scripts/verify-chat-action-guard.mts
scripts/verify-round7-usecases.mts
### ce87410 Tasks and What's pending: friendly task titles (Croma, not Browser · www.croma.com) (#731)

lib/dashboard/task-feed.ts
scripts/verify-service-notice-surface.mts
scripts/verify-watch-dashboard-counts.mts
### 950986a Dashboard: Wajo layout — chat-first Home, retractable sides, full width (#732)

app/dashboard-light.css
app/dashboard/(app)/home/page.tsx
app/dashboard/(app)/layout.tsx
components/dashboard/gogo-live.tsx
components/dashboard/gogo-panel.tsx
components/dashboard/home-ask.tsx
components/dashboard/home-gogo-card.tsx
components/dashboard/mobile-nav.tsx
components/dashboard/side-rail.tsx
scripts/verify-dashboard-design-refresh.mts
### 6f4b1e9 Gogo panel, Home Gogo and Recent: friendly task titles (#733)

components/dashboard/gogo-live.tsx
### b563a57 app.askgogo.in root opens the dashboard (Home when signed in, sign-in page otherwise) (#734)

app/page.tsx
