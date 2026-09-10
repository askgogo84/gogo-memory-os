# Gogo — 90% Muse-Parity Roadmap for India

Status: master product / engineering roadmap
Owner brand: AskGogo (`askgogo.in`)
Product: **Gogo**

## Target

The target is **~90% of Muse's user-visible personal-agent capabilities that matter for an India launch**, not 90% of Meta's total ecosystem advantage.

Meta-only distribution/assets such as native Facebook/Instagram graph access and AI glasses are not required to call the India product competitive. The launch target is that a normal user can give Gogo an outcome and experience the same core loop:

**Tell Gogo → Gogo remembers → plans → acts → asks only where necessary → keeps working in the background → returns proactively → remembers the result.**

## Product architecture

Gogo is the orchestration and relationship layer. Specialist products/services are capabilities behind Gogo.

- **Gogo Brain** — identity, memory, planning, context, permissions, run state
- **Gogo Agent** — immediate multi-tool missions
- **Background Gogo** — durable watchers and long-running goals
- **Gogo Secure Computer** — per-user browser computer for websites without first-class APIs
- **Gogo Sentinel / Safe Mode** — independent execution policy and approvals
- **CreditIQ Travel Intelligence** — live flights, hotels, award/redemption economics and booking handoff
- **First-class connectors** — Gmail, Calendar, Contacts, Drive and other scoped APIs
- **WhatsApp / Web / Mobile / Voice** — surfaces over the same Gogo identity and state

Prefer first-class APIs over browser automation. Use Gogo Secure Computer only where an API/connector is unavailable or insufficient.

---

# P0 — India launch core

## P0.1 One Gogo everywhere — GREEN / continue verification

Required:
- shared canonical user identity across dashboard and WhatsApp
- Talk to Gogo and Gogo Agent use the same routing hierarchy
- Tasks, Lists, Reminders, Calendar and Memory are views of shared state
- same approvals/activity regardless of starting surface
- no duplicate active missions from browser retries/double-clicks

Acceptance:
- start a mission on web, inspect the same state on WhatsApp, approve exact action, verify one shared Activity trail

## P0.2 Persistent Memory — GREEN / deepen controls

Required:
- documents, tickets, notes, images, meetings and saved facts
- relevant-memory retrieval into missions
- private/sensitive field masking
- source provenance
- user correction / forget / edit flows
- preference memory and recurring personal context

Acceptance:
- sensitive document can inform a mission without revealing protected identifiers
- user correction changes future answers

## P0.3 Multi-tool missions — GREEN beta

Required:
- bounded planner
- deterministic tool adapters
- Tasks / Lists / Reminders / Calendar / research / artifacts
- exact approval boundary
- durable resume after approval
- run/step audit trail

Passed reference mission:
Bengaluru → Mumbai work trip: research + packing list + tasks + reminder + Trip Brief + Calendar approval + real Google Calendar event.

## P0.4 CreditIQ-powered travel — PRIORITY NOW

### Principle
Do **not** rebuild travel inventory inside Gogo. CreditIQ is Gogo's specialist travel/rewards intelligence service.

### CreditIQ capabilities to expose to Gogo

Flights:
- Skyscanner Flights Live Prices
- Amadeus Flight Offers fallback
- Kiwi official Flight Search MCP / Tequila fallback
- Travelpayouts discovery fallback with freshness/coverage labels
- exact route/date/cabin results
- bookable/provider links where supplied

Hotels:
- Booking.com Demand API
- Skyscanner Hotels Live Prices
- HBX / Hotelbeds availability fallback
- destination/date/rooms/adults
- pageable provider inventory
- provider booking/redirect paths where available

Rewards / redemption:
- award availability / award guides
- transfer partners and ratios
- user's verified point balances when CreditIQ account is linked
- cash vs points vs blended economics
- surcharges / remaining cash
- redemption path and warnings
- best-value recommendation with provenance

### Integration contract

Gogo sends a structured request:

```json
{
  "userLinkId": "optional linked CreditIQ identity",
  "type": "flight|hotel|trip",
  "origin": "BLR",
  "destination": "BOM",
  "departDate": "2026-09-15",
  "returnDate": "2026-09-17",
  "cabin": "economy",
  "adults": 1,
  "rooms": 1,
  "preferences": {}
}
```

CreditIQ returns structured inventory/intelligence, never prose-only search snippets.

Gogo remains responsible for:
- user intent/context
- itinerary planning
- Tasks / Lists / Reminders / Calendar
- approval before consequential booking action
- Activity / Artifact / Memory

CreditIQ remains responsible for:
- live provider calls
- coverage/freshness labels
- fare/hotel normalization
- rewards/transfer math
- booking/deep-link data

### Booking phases

1. **P0:** live search + compare + CreditIQ recommendation + provider/deep-link handoff
2. **P0/P1:** signed service-to-service API + linked CreditIQ identity for points-aware results
3. **P1:** Gogo prepares booking in Secure Computer / provider API, then approval
4. **P1:** approved booking execution where provider terms/API permit

Never call cached/search-engine snippets "live inventory".

## P0.5 Background Gogo — YELLOW, current acceptance testing

Required:
- watcher persists in DB
- 15-minute worker cadence
- dashboard may be closed
- first run establishes baseline
- subsequent material change creates Idea + Activity
- WhatsApp notification when configured
- stop watcher control

Acceptance:
- close browser before first worker pass, confirm `last_checked_at`, baseline fingerprint and next check move server-side
- trigger a controlled material change and verify WhatsApp notification

## P0.6 Goals — YELLOW

Required:
- long-running durable goal plan
- periodic goal review worker
- safe private actions
- artifacts
- blockers / human review
- resume after review
- proactive WhatsApp/app notification

Acceptance:
- create goal, close app, confirm worker advances it and surfaces blocker/next action

## P0.7 Proactive Ideas — YELLOW

Sources:
- watcher material change
- goal blocker/next action
- reminder/briefing
- calendar conflict
- connected-source change

Rules:
- evidence/source references required
- no generic AI spam
- user-level proactivity controls

## P0.8 Gmail + Calendar + Contacts + Drive — P0

Calendar:
- read schedule/free-busy
- create/update only through approval
- passed basic mission calendar write

Gmail:
- find/read relevant mail
- draft automatically when permitted
- send only after approval
- preserve thread and recipients

Contacts:
- resolve people for email/calendar
- never guess ambiguous recipients

Drive:
- find/read project docs
- produce/update artifacts where allowed
- prefer Drive API over browser

Acceptance mission:
"Find Rahul's latest email about the meeting, use the attached brief, find a free 30-minute slot next week, draft the reply and proposed invite; do not send or schedule without approval."

## P0.9 Gogo Secure Computer — YELLOW

Current:
- Vercel persistent per-user Sandbox
- Mumbai `bom1`
- Chromium + Playwright
- allowlisted browser actions
- Safe Mode/Sentinel
- pause at password / OTP / CAPTCHA / passkey / payment-auth gates

Must add for near-Muse parity:
- secure interactive human takeover
- short-lived signed takeover session
- user types credentials directly into isolated browser
- credential values never enter model prompts/activity/artifacts
- hand-control-back action
- session expiry / revoke

Do not market credential isolation parity until this is independently verified.

## P0.10 Workspaces / Projects — YELLOW

Required:
- side workspace/topic contexts
- shared Gogo identity/memory boundaries
- scoped runs, artifacts, tasks and research
- continuity across multiple sessions

Acceptance:
- create "AskGogo India Launch" workspace, run two missions on different days and verify scoped continuity without contaminating unrelated workspace context.

---

# P1 — Transactional breadth / Muse-like execution

## P1.1 Browser form workflows

- research and navigate
- fill draft fields
- upload permitted files
- stop before consequential submit
- approval card shows exact action and destination
- submit only after approval
- retain audit trail + result artifact

## P1.2 Shopping and checkout

India-first phases:
- product discovery / comparison
- basket preparation
- merchant handoff
- approval before purchase
- approved checkout through a supported tokenized payment provider

Do not store raw card details in Gogo.

Explore India-compatible tokenized wallet / payment-agent paths (Razorpay, network-token/UPI/provider options) and international Link/Shop Pay where available and contractually permitted.

## P1.3 Bills / subscriptions / negotiation

- detect recurring bills/subscriptions from user-authorized sources
- identify increases / unused subscriptions
- prepare cancellation or negotiation
- browser/email execution with approvals
- savings artifact

## P1.4 Travel booking execution

After CreditIQ search/handoff is production-stable:
- select user-approved itinerary
- reprice before booking
- compare cash vs points immediately before action
- show total/fare rules/cancellation/baggage
- approval
- book via provider API or Secure Computer only where permitted
- save confirmation to Memory
- automatically create trip tasks/reminders/calendar
- watch disruption/price/change where useful

---

# P1 — Voice, multimodal and India differentiation

## P1.5 Real-time Gogo Voice

- natural duplex conversation
- interruptions
- voice notes
- spoken approvals with confirmation for consequential actions
- English + Hindi + Kannada first, expand Indian languages
- meeting audio / transcription / action extraction

## P1.6 Multimodal Gogo

- screenshots
- photos
- PDFs/documents
- camera input
- screen context
- extract → understand → remember → act

## P1.7 Daily Gogo

Morning/evening proactive brief:
- calendar
- tasks/reminders
- watcher changes
- goal next actions
- important emails
- trip disruptions
- one-tap "handle this" actions

---

# P2 — Advanced agent breadth

## P2.1 Parallel sub-agents

For large outcomes, bounded concurrent specialists under one parent run:
- research
- travel
- email/calendar
- finance
- artifact synthesis

All child runs inherit parent permissions and cannot bypass Sentinel.

## P2.2 Rich negotiation

- bill/merchant/provider negotiation only in supported low-risk domains
- clear user-set limits
- approval for commitment/payment/legal acceptance

## P2.3 Broader connectors

Priority by India/user value:
- Microsoft 365
- Slack
- Notion
- LinkedIn-assisted workflows where terms permit
- additional cloud storage
- finance/account aggregation only through regulated/consented providers
- health/fitness sources with explicit consent and high privacy controls

## P2.4 Social saves / personal context

Where APIs/terms permit:
- Instagram saved content import or user-forwarded links
- YouTube saves
- social/bookmark ingestion
- transform recipe → grocery list, event → calendar, product → watcher, etc.

Do not depend on privileged Meta-only graph access for the core product.

---

# Muse parity scorecard

Use only VERIFIED production acceptance tests to mark green.

| Capability | Gogo status | Priority |
|---|---|---|
| Persistent personal memory | Green | maintain |
| WhatsApp + web shared identity | Green | maintain |
| Tasks / Lists / Reminders | Green | maintain |
| Calendar read/write + approval | Green | maintain |
| Multi-step missions | Green beta | P0 harden |
| Approvals / Activity | Green | maintain |
| Artifacts | Green beta | P0 polish |
| Live flights | CreditIQ exists; bridge pending | P0 |
| Live hotels | CreditIQ exists; bridge pending | P0 |
| Rewards-aware travel | CreditIQ exists; identity bridge pending | P0 |
| Booking handoff | CreditIQ/provider path exists; Gogo bridge pending | P0 |
| Booking execution | Partial / not launch-verified | P1 |
| Background watchers | Yellow / acceptance test underway | P0 |
| Long-running Goals | Yellow | P0 |
| Proactive Ideas | Yellow | P0 |
| Gmail | Yellow | P0 |
| Contacts / Drive | Partial | P0 |
| Workspaces | Yellow | P0 |
| Secure browser public read/draft | Yellow | P0 |
| Human browser takeover | Red | P0/P1 |
| Credential broker | Red | P0/P1 |
| Shopping basket/checkout | Red | P1 |
| Bills/subscriptions negotiation | Red | P1 |
| Real-time voice | Yellow | P1 |
| Multimodal | Yellow | P1 |
| Parallel sub-agents | Red | P2 |
| Meta-native social graph / AI glasses | Out of scope for parity target | — |

## Website rule

Only green/production-verified capabilities may be described as live features.

Yellow capabilities may be shown as beta only after a user-visible beta gate exists.

Red roadmap capabilities must not be marketed as shipped.

Core website story:

1. **Inside your head** — too much to carry
2. **Gogo remembers** — your second brain
3. **Plan. Act. Watch.** — outcome, not commands
4. **Background Gogo** — close the app; Gogo keeps going
5. **Talk naturally** — voice and messaging
6. **One Gogo. Everywhere.** — WhatsApp, web, mobile, voice
7. **You stay in control** — Secure Computer, Safe Mode, Approvals, Activity
8. **Your mind, lighter** — emotional promise

Retain the approved Claude design language. Update product storytelling and live demos; do not redesign the visual system unnecessarily.

## Definition of 90% launch parity

Gogo reaches the India 90% target when the following production acceptance missions pass:

1. Personal-day/private-memory mission
2. Multi-tool mission with verified persisted actions and approval/resume
3. Live CreditIQ-powered flight + hotel + reward comparison mission
4. Background watcher while client is closed + proactive WhatsApp event
5. Long-running Goal advancing while client is closed
6. Gmail + Calendar + Contacts cross-app mission with approval
7. Drive/document context mission
8. Workspace continuity mission
9. Secure Browser public read/draft/form mission
10. Human-auth pause + secure takeover + resume mission
11. Shopping research/basket + approval boundary
12. Cross-surface dashboard ↔ WhatsApp continuity mission
13. Memory correction/privacy mission
14. Voice/multimodal mission

When these pass, the remaining Meta-only ecosystem advantages are not blockers to describing Gogo as a serious persistent personal AI agent for India.