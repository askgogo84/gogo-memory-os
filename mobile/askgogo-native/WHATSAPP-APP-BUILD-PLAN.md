# AskGogo — WhatsApp + Native App Build Plan

## Product rule

AskGogo has two primary product surfaces:

1. **WhatsApp** — acquisition, capture, quick actions, proactive messages.
2. **Native app (Android + iOS)** — visual second brain, agent activity, approvals, artifacts and deeper workflows.

They use the **same Gogo, same user, same memory, same reminders, same calendar, same lists, same permissions and same agent activity**.

Telegram is not a product surface in this roadmap. Existing `telegram_id` fields may remain temporarily as legacy compatibility keys inside the current backend; no new mobile or agent feature should depend on Telegram as a user experience.

---

## Phase 1 — Native foundation + Agent OS — IN PROGRESS

Already on `mobile/native-app-v1`:
- [x] Expo / React Native app shell
- [x] Home / Today / Memory / Organise / You navigation
- [x] Floating Gogo entry point
- [x] Agent Hub preview
- [x] Shared mobile agent models
- [x] Agent API client scaffold
- [x] Agent goals persistence + authenticated API
- [x] Agent snapshot/activity read API
- [x] Agent approvals API
- [x] Agent permissions API
- [x] Deterministic server-side execution safety policy
- [x] Agent OS database migration (branch-only; not production-applied yet)
- [x] Android APK preview CI

Remaining:
- [ ] WhatsApp-native account linking
- [ ] mobile bearer session stored in secure device storage
- [ ] make agent APIs accept mobile sessions as well as web sessions
- [ ] replace preview Agent Hub data with live user data

Exit criteria: the same WhatsApp user opens the native app and sees live Agent Hub state with no second account.

---

## Phase 2 — Same-brain action runtime

- [ ] unified Gogo run endpoint for WhatsApp + Android + iOS
- [ ] visible run/step activity trail
- [ ] Memory tools: search, retrieve, save
- [ ] Reminder tools: create, move, snooze, resolve/cancel
- [ ] List/task tools: create, add, complete, show
- [ ] Calendar tools: read, find free time, create, move/cancel through approval policy
- [ ] context-aware suggestions by native screen
- [ ] confirmation cards + one-shot approvals
- [ ] reversible action / Undo contract where supported
- [ ] deep link from WhatsApp to a native run/artifact

Exit criteria: `Find my passport and remind me six months before expiry` can start on either WhatsApp or the app, use the same data, and produce one shared activity record.

---

## Phase 3 — Make the whole existing AskGogo product native

- [ ] live Today / Daily Brief
- [ ] semantic Memory
- [ ] Tasks
- [ ] Lists
- [ ] Google Calendar
- [ ] Meetings + transcription/action items
- [ ] Travel tickets + alerts
- [ ] Documents/images/PDFs
- [ ] Search/research
- [ ] Learn with Gogo native lesson player
- [ ] Personalise Gogo
- [ ] Circle / people reminders / shared lists
- [ ] Usage + Free/Lite/Pro/Power entitlement state
- [ ] CreditIQ connection

Exit criteria: every core feature a user can use on WhatsApp has an appropriate native visual surface without creating duplicate logic.

---

## Phase 4 — Native superpowers

- [ ] voice input + background voice capture where platform permits
- [ ] camera / document scanner
- [ ] iOS + Android share-to-AskGogo extension
- [ ] file/photo/link intake
- [ ] push notifications
- [ ] Android notification actions
- [ ] deep links
- [ ] biometric app lock
- [ ] widgets
- [ ] Siri / App Intents and Android shortcuts where useful

Exit criteria: content from any phone app can be sent to the same Gogo in a few taps.

---

## Phase 5 — Background and proactive Gogo

Watchers:
- [ ] deadline approaching
- [ ] calendar conflict/change
- [ ] reply awaited
- [ ] web/page availability change
- [ ] application status/deadline
- [ ] fare/price threshold
- [ ] travel disruption/check-in window

Rules:
- no notification when nothing meaningful changed
- dedupe WhatsApp and push delivery
- all checks recorded in agent activity
- user can pause/delete every watcher
- user chooses WhatsApp, app push, both, or neither per notification class

---

## Phase 6 — Browser/action executor

Read-only first:
- [ ] search/navigate/extract/compare
- [ ] prepare form answers
- [ ] download documents

Draft next:
- [ ] fill forms without submitting
- [ ] draft emails/messages
- [ ] prepare booking/checkout

Execute only behind policy/approval:
- [ ] submit forms
- [ ] send email/message
- [ ] destructive calendar changes
- [ ] bookings
- [ ] purchases/payments

Credentials never enter model prompts or activity logs.

---

## Phase 7 — India differentiation + CreditIQ intelligence

- [ ] Hindi action layer
- [ ] Kannada action layer
- [ ] Tamil action layer
- [ ] Telugu action layer
- [ ] mixed-language voice/text
- [ ] preferred-language confirmations
- [ ] best-card recommendation before eligible commerce/travel actions
- [ ] points-vs-cash and reward-value intelligence
- [ ] transfer irreversibility warnings
- [ ] India service/API integrations where permitted

---

## Phase 8 — Store readiness

Android:
- [ ] signed release AAB
- [ ] Play Console internal testing
- [ ] closed testing
- [ ] production listing

Apple:
- [ ] bundle/signing/App Store Connect
- [ ] TestFlight
- [ ] privacy manifest/disclosures
- [ ] App Review submission

Both:
- [ ] store screenshots
- [ ] metadata
- [ ] privacy policy/data safety labels
- [ ] crash/analytics monitoring
- [ ] release rollback plan

No store submission happens until the user approves the final native UX and QA results.

---

## Definition of done for every agent feature

1. Same canonical AskGogo user as WhatsApp.
2. Same underlying memory/data — no mobile silo.
3. Permission enforced server-side.
4. Consequential action approval enforced server-side.
5. Visible activity/audit event.
6. Failure + retry path.
7. Android + iOS states designed/tested.
8. WhatsApp equivalent/continuation considered.
9. Automated regression coverage.
10. No secret/credential written to model context or activity logs.
