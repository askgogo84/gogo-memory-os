# AskGogo Autonomous Launch Master

## North-star promise
AskGogo remembers, understands, anticipates and acts — across WhatsApp, web and native mobile — with the same identity and memory, visible work, least privilege, deterministic approvals for consequential actions, and reliable recovery when execution fails.

## Current execution status
- Native rebuild branch: `mobile/native-app-v2-current-main`
- Base: current production `main`
- Native app subtree and Android preview workflow transplanted from legacy `mobile/native-app-v1`
- Next gate: compile/build verification, API-contract reconciliation, same-brain auth/session, then Agent Hub/Activity/Goals/Approvals/Permissions.

## P0 — Same brain, one user, one state
- [ ] One canonical user identity across WhatsApp, web and native app
- [ ] Shared memory, preferences, reminders, lists, goals, calendar context and life events
- [ ] Thread/context continuity across surfaces
- [ ] Mobile session/link flow tied to the existing WhatsApp/web user
- [ ] No mobile-only memory silo
- [ ] Deep links from notification/activity/approval to the exact object

## P0 — Autonomous brain
- [ ] Goal capture from natural language
- [ ] Goal decomposition into plans, checkpoints and dependencies
- [ ] Compound multi-step execution
- [ ] Background continuation after the user leaves
- [ ] Retry with idempotency and leases
- [ ] Pause/resume/cancel
- [ ] Failure recovery and alternate-route planning
- [ ] Sentinel to detect stalled, looping or contradictory runs
- [ ] Same-brain context carryover between runs
- [ ] Learning from accepted/rejected suggestions and user corrections
- [ ] Proactive Ideas for You ranked by usefulness
- [ ] Autonomous next-step suggestion after task completion

## P0 — Permission and safety model
- [ ] Per-capability Read / Draft / Execute-with-approval / Safe auto-execute permissions
- [ ] Server-side approval enforcement for sends, submits, deletes, bookings, payments and publishing
- [ ] Narrow scoped auto-permissions only when explicitly enabled
- [ ] Cost guard / rate guard / runaway loop guard
- [ ] Full activity and audit trail
- [ ] Credential isolation; never expose secrets to model output/logs
- [ ] Device handoff for provider blocks, OTP, biometric or human-only steps

## P0 — Agent activity centre
- [ ] Running now
- [ ] Waiting for approval
- [ ] Watching in background
- [ ] Completed
- [ ] Failed / retryable
- [ ] Why Gogo did this
- [ ] Source/context used
- [ ] Next action / retry / cancel controls
- [ ] Home card: Gogo is working

## P0 — Approvals
- [ ] One approval-card pattern for email/message send
- [ ] Calendar create/update/delete
- [ ] Form submission
- [ ] Travel booking/check-in
- [ ] Purchase/payment
- [ ] Publish/share
- [ ] States: draft → review → approved/rejected → executing → completed/failed
- [ ] Approval timeout and revalidation before execution

## P0 — Watchers / proactive background Gogo
- [ ] Price/fare thresholds
- [ ] Deadline approaching
- [ ] Calendar conflict/change
- [ ] Email/reply awaited
- [ ] Web-page availability/change
- [ ] Application status/deadline
- [ ] Travel disruption/check-in window
- [ ] Booking/life-event change watcher
- [ ] Meaningful-change detector
- [ ] Deduped notifications
- [ ] Pause/delete controls
- [ ] Every check recorded in activity log

## P0 — Life events
- [x] BookMyShow link routing
- [x] Browser/provider retry handling
- [x] Cloudflare/device handoff
- [x] Ticket screenshot completion
- [x] Booking detail extraction and credential attachment
- [ ] Generic flight/train/hotel/event/ticket ingestion
- [ ] Gmail/provider confirmation reconciliation
- [ ] Calendar + reminder creation policy
- [ ] Change/cancellation monitoring
- [ ] Travel-day / event-day proactive actions

## P0 — Secure browser / computer use
- [x] Isolated browser foundation
- [x] Mobile browser context for providers
- [ ] Read/search/navigate/extract structured data
- [ ] Download documents
- [ ] Prepare form answers
- [ ] Draft-fill forms without submitting
- [ ] Approval-gated submit
- [ ] Booking/check-out preparation
- [ ] Controlled execution after approval
- [ ] Audit evidence for action completion
- [ ] Provider block / auth / OTP / CAPTCHA handoff paths

## P0 — Google workspace and communications
- [ ] Gmail read/search
- [ ] Gmail draft
- [ ] Gmail send with approval
- [ ] Reply-awaited watcher
- [ ] Calendar read
- [ ] Calendar create with confirmation
- [ ] Calendar update/delete approval
- [ ] Meeting preparation and follow-up
- [ ] Drive contextual retrieval where approved
- [ ] OAuth scope verification for every production scope

## P0 — Travel autonomy
- [ ] Flight/hotel research artifact
- [ ] Compare options using user preferences
- [ ] Fare monitoring
- [ ] Booking-prep workflow
- [ ] Check-in-window watcher
- [ ] Never retry stale/irreversible check-in steps
- [ ] Require terminal evidence before declaring check-in complete
- [ ] Delay/cancellation/disruption watcher
- [ ] Calendar sync
- [ ] Boarding pass/ticket credential storage
- [ ] Airport/lounges/benefits context
- [ ] CreditIQ points-vs-cash intelligence before payment

## P0 — Native mobile app
- [~] Reconcile legacy mobile app with current main using `mobile/native-app-v2-current-main`
- [ ] Shared TypeScript agent models
- [ ] Authenticated agent API client
- [ ] Agent Hub
- [ ] Activity cards
- [ ] Goals
- [ ] Ideas for You
- [ ] Approval cards
- [ ] Permissions / Safe Mode
- [ ] Artifacts
- [ ] Home Gogo-is-working card
- [ ] WhatsApp account link / OTP flow
- [ ] Push notifications
- [ ] Deep links
- [ ] Share sheet: Send to Gogo
- [ ] Camera/document scan
- [ ] Background voice capture
- [ ] Android notification actions
- [ ] Biometric lock
- [ ] Home-screen widgets
- [ ] iOS Siri/App Intents where useful
- [ ] Offline/poor-network states

## P1 — Memory and personal intelligence
- [ ] Durable episodic memory
- [ ] Semantic memory and retrieval by meaning
- [ ] People/relationship context
- [ ] Preference learning
- [ ] Personal routines and recurring patterns
- [ ] Memory provenance and confidence
- [ ] User-correctable memory
- [ ] Sensitive memory reveal gates
- [ ] Cross-surface memory consistency tests

## P1 — Durable artifacts
- [ ] Trip itinerary
- [ ] Accelerator/application tracker
- [ ] Meeting brief
- [ ] Shopping comparison
- [ ] Goal plan
- [ ] Expense/reward summary
- [ ] Research brief
- [ ] Life-event credential card
- [ ] Versioning and source references
- [ ] Mobile renderer and web renderer

## P1 — Voice and multimodal
- [ ] Voice command → same autonomous brain
- [ ] Mixed-language speech
- [ ] Background capture / quick note
- [ ] Image/document understanding
- [ ] Screenshot-to-action continuation
- [ ] Audio/video transcription pipeline
- [ ] Voice response where useful

## P1 — India depth
- [ ] Hindi
- [ ] Kannada
- [ ] Tamil
- [ ] Telugu
- [ ] Mixed-language commands
- [ ] Indian travel/services flows
- [ ] Utility workflows
- [ ] Government/public-service workflows where permitted
- [ ] UPI handoff without exposing payment credentials

## P1 — CreditIQ inside Gogo
- [ ] Best card before payment
- [ ] Effective reward value
- [ ] Points vs cash recommendation
- [ ] Transfer ratios and duration
- [ ] Irreversibility warnings
- [ ] Lounge/benefit relevance
- [ ] Corporate/HNI travel optimization hooks

## P1 — Dashboard/web
- [ ] Today
- [ ] Memory
- [ ] Calendar
- [ ] Lists
- [ ] Tasks/reminders
- [ ] Agent activity
- [ ] Goals
- [ ] Watchers
- [ ] Approvals
- [ ] Artifacts
- [ ] Permissions
- [ ] Usage/cost visibility
- [ ] Mobile-responsive QA

## P1 — Reliability / observability
- [ ] Structured run logs
- [ ] Trace ID per autonomous run
- [ ] Idempotency key per consequential action
- [ ] Durable queue / lease ownership
- [ ] Dead-letter and retry policy
- [ ] Production alerts for failed workers
- [ ] Cron health monitoring
- [ ] Cost telemetry
- [ ] Latency SLOs
- [ ] Provider failure dashboards
- [ ] Regression suite for every autonomous sequence

## P1 — Security / privacy
- [ ] RLS/policy audit on agent tables
- [ ] Least-privilege service roles
- [ ] Encrypt sensitive artifacts/credentials
- [ ] Retention/deletion policy
- [ ] Account deletion flow
- [ ] Export-my-data flow
- [ ] Privacy policy and Terms
- [ ] Mobile permission disclosure
- [ ] Security review before store launch

## P0 — Full autonomous acceptance matrix
- [ ] Same-brain memory → reminder
- [ ] Reminder → follow-up → completion
- [ ] Approval → calendar execution
- [ ] Watcher → meaningful change → notification
- [ ] Email read → draft → approval → send
- [ ] Browser research → artifact
- [ ] Browser draft form → approval → submit
- [ ] Booking link → life event → credential → reminder/calendar
- [ ] Flight/travel event → watch → disruption/check-in action
- [ ] Goal → plan → background steps → blocker → user approval → completion
- [ ] Cross-surface continuation: WhatsApp → web → mobile → WhatsApp
- [ ] Failure injection: provider down, OAuth expired, duplicate webhook, network timeout, stale action, missing permission
- [ ] No duplicate external action under retry

## P0 — Mobile store launch
- [~] Fresh app branch based on current main
- [ ] Production API base URL and environment separation
- [ ] Android release signing
- [ ] Android AAB
- [ ] Play Console internal testing
- [ ] Crash/analytics monitoring
- [ ] Store privacy/data-safety form
- [ ] Store screenshots, icon, splash, description, support URL
- [ ] Account deletion URL/flow
- [ ] Closed beta acceptance
- [ ] Production rollout
- [ ] iOS archive/signing
- [ ] App Store Connect/TestFlight
- [ ] Apple privacy manifests/disclosures
- [ ] TestFlight acceptance
- [ ] App Store production submission

## Launch blockers
1. Legacy `mobile/native-app-v1` must not be shipped directly because it is heavily diverged.
2. `mobile/native-app-v2-current-main` must pass native compile/build and API-contract reconciliation before merge.
3. Production OAuth scopes must be verified before broad Gmail/Drive execution.
4. Full autonomous acceptance matrix must be green before broad auto-execution.

## Execution order
1. Finish native v2 compile/build and API-contract reconciliation.
2. Same-brain/mobile auth/session.
3. Activity + Goals + Approvals + Permissions.
4. Watchers + push.
5. Travel/check-in safety gates.
6. Full autonomous matrix and failure injection.
7. Security/RLS/observability.
8. Android internal-test build and closed beta.
9. Beta fixes.
10. Android production, then iOS/TestFlight/App Store.

## Definition of done
An autonomous feature is complete only when it is authenticated end-to-end, uses the same user/memory across surfaces, enforces permissions and approval server-side, records an audit event, has idempotent failure/retry behavior, handles Android+iOS UI states, and has automated regression coverage.
