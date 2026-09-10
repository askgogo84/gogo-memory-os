# AskGogo India Personal Agent Architecture

Status: launch contract for India beta (September 2026)

## Product contract

AskGogo is one persistent personal agent, not a collection of unrelated pages.

The same user outcome must resolve through one shared brain whether it starts in:

- Gogo Agent on the dashboard
- Talk to Gogo
- WhatsApp
- native mobile surfaces

Core loop:

**Outcome → private context → plan → safe execution → approval boundary → artifact/result → background follow-up → memory**

Screens such as Tasks, Memory, Calendar and Lists are views into that shared state. They are not separate assistants.

## Mission routing

Order matters.

1. Explicit background-watch commands
2. Explicit secure-browser URL work
3. Deterministic specialist cross-feature plans
4. General multi-tool mission planner
5. Simple current travel research
6. Single-feature/same-brain fallback

The general planner owns genuine multi-part outcomes before simple keyword fallbacks. This prevents a request such as “plan my trip, create tasks, remind me and prepare my calendar” from collapsing into a one-step flight search.

The planner is bounded to 10 steps and an allowlisted tool set. It receives the current user request, never a raw dump of stored memory or credentials. Generated steps are re-classified by deterministic server policy before execution.

## Private context and memory

Supabase is the durable source of truth for identity, memory, runs, approvals, goals, watchers, tasks, lists and other private state.

Current production database: the existing AskGogo Supabase project in ap-northeast-1. Do not migrate production data during the India beta stabilization window without a rehearsed migration, backups, validation and rollback plan.

The planner may request relevant memory through the memory capability, but secret-shaped fields and sensitive identity data remain behind the Asset Memory privacy/reveal rules. The planning model does not receive raw credentials.

## Agent control plane

India beta compute region: **Mumbai / bom1**.

Vercel hosts the Next.js control plane and server-side agent routes. The production project is configured with `regions: ["bom1"]`.

Responsibilities:

- authenticate the user/surface
- resolve the canonical user identity
- classify and plan work
- enforce Safe Mode permissions
- create runs/steps/approvals/artifacts
- dispatch API-backed work
- create/stop goals and watchers
- wake the Secure Computer only for browser work

## Gogo Secure Computer

Canonical browser computer for India beta:

- provider: Vercel Sandbox
- isolation: per-user persistent microVM
- region: Mumbai (`bom1`), environment-overridable for later countries
- browser: Chromium
- automation: Playwright
- profile: persistent browser profile inside that user's sandbox
- sandbox name: one-way hash of the AskGogo user id
- network: deny-by-default style custom allowlist; target site family is allowed for the active job
- action vocabulary: goto, click, fill, select, check, wait, submit
- max planned browser actions per execution: bounded

The LLM proposes only allowlisted browser actions. A fixed server-controlled browser script executes them.

### Browser modes

**read** — inspect a page; no mutation.

**draft** — navigate and fill safe fields but physically skip final submit controls.

**execute** — consequential submission/booking/purchase only after explicit approval and Sentinel validation.

## Authentication and human takeover

OAuth/API connectors are the preferred route for services that support them (for example Google Calendar/Gmail). AskGogo should not use browser automation when a first-class scoped API connection is available.

For arbitrary websites that present password, OTP, CAPTCHA, passkey, payment-authentication or other human-only login gates:

1. Gogo may navigate/read up to the gate.
2. Gogo must not invent or request a password in an agent prompt.
3. Gogo must not persist typed credentials in Activity, run metadata, artifacts or model context.
4. Until interactive Secure Computer takeover ships, the run pauses as `human_auth_required` and tells the user that manual sign-in is required.
5. After interactive takeover is added, the user will interact directly with the existing per-user Secure Computer session. The agent resumes only after the user explicitly hands control back.

Do not claim Muse-style credential isolation for AskGogo until the interactive credential broker/takeover layer has been independently verified.

## Safe Mode / Sentinel

Every capability has an explicit permission level such as off, read, draft, ask or auto.

The planning model cannot increase its own permissions.

Consequential actions remain approval-gated even when the surrounding mission contains safe automatic work. Current consequential families include:

- sending email
- modifying calendar
- submitting browser forms
- bookings
- purchases/payments

One approval is scoped to the exact pending action/step. Approval does not authorize later unrelated steps.

## Background Gogo

Background Gogo is server-driven; it does not depend on the dashboard being open.

Durable state lives in Supabase. Vercel cron wakes workers in Mumbai.

Current schedules:

- reminders: every minute
- agent watchers: every 15 minutes
- agent goal reviews: every 15 minutes
- daily briefing scan: every 15 minutes
- follow-ups/lifecycle jobs: scheduled separately

### Watchers

Use watchers for a condition that should be checked repeatedly: price changes, deadlines, public-web changes, availability signals, etc.

A watcher stores its condition, cadence, last state and next-check time. The worker establishes a baseline, checks again on schedule, and surfaces only meaningful changes through Ideas/push/WhatsApp according to the watcher configuration.

### Goals

Use goals for longer outcomes rather than a single immediate transaction. Goal state, plan, progress, next action and blockers are durable. Goal-review watchers periodically reconsider progress and can surface proactive updates.

### Immediate missions vs background goals

An immediate mission executes safe bounded steps in the request lifecycle and pauses durably at approval boundaries. Work that must span hours/days should be represented as a Goal or Watcher so it survives client closure and server restarts.

For post-beta scale, migrate arbitrary long-running mission orchestration to Vercel Workflow while preserving the same `agent_runs` / `agent_steps` / approval contract. Do not replace the working beta control plane immediately before launch.

## Proactive behavior

Proactivity must be evidence-driven, not chat spam.

A proactive Idea/notification should be created only when:

- a watcher detects a meaningful state change
- a goal review finds a useful next action or blocker
- a scheduled reminder/brief is due
- a connected source materially changes something the user asked Gogo to care about

Every proactive item must retain source/run references so the user can see why Gogo surfaced it.

## Workspaces / side chats

Threads/workspaces scope a sequence of Agent runs to a project or topic while retaining the same user identity, permission model and memory boundaries.

A workspace is context, not a second agent.

## Artifacts

Artifacts are private structured outputs tied to an Agent run, for example:

- trip brief
- research brief
- comparison
- meeting brief
- application tracker
- goal plan
- reward summary

For a mission requesting a final deliverable, artifact creation is the last safe step after preceding results are available. If the mission pauses for approval before a later artifact step, the artifact is produced only after the approved run resumes and reaches that step.

## India beta data/compute placement

Current:

- Vercel application/control plane: Mumbai `bom1`
- per-user Gogo Secure Computer: Mumbai `bom1`
- Supabase production database: existing Tokyo `ap-northeast-1` project

Do not move the production database casually. Measure India latency during beta. If database latency becomes material, rehearse a migration to an India region with backup, integrity checks, planned cutover and rollback.

## What is launch-ready now

- shared identity across dashboard and WhatsApp
- persistent private memory
- tasks/lists/reminders
- calendar integration
- Talk to Gogo private-day routing
- multi-step Agent runs
- deterministic approvals
- Safe Mode/Sentinel permissions
- goals
- background watchers
- proactive Ideas/push foundations
- workspaces/threads
- artifacts
- per-user persistent Secure Computer
- Playwright Chromium browser
- India-first control plane and browser region

## Known beta boundary

The remaining major Muse-class gap is arbitrary authenticated-site human takeover/credential brokering. Until that exists, AskGogo must pause safely at human authentication gates rather than claiming it can complete those sites unattended.

Shopping/payment automation also stays approval-gated and should not be marketed as autonomous spending.

## Launch acceptance missions

Before public India beta, run these as real production tests:

1. **Personal day** — private reminders/calendar answer, no web fallback.
2. **Multi-tool trip** — context + research + packing list + tasks + reminder + calendar approval + trip artifact.
3. **Approval** — reject once, confirm no mutation; rerun, approve exact step, confirm only that step executes.
4. **Background watch** — create a public-web watcher, close the app, verify a later check and meaningful-change notification.
5. **Goal** — create a multi-day goal, close the app, verify background review/progress/blocker behavior.
6. **Workspace continuity** — create a workspace, perform multiple runs, verify scoped history/context.
7. **Secure browser read/draft** — inspect a public site, prepare a form and confirm draft mode does not submit.
8. **Authentication gate** — encounter password/OTP and verify Gogo pauses without logging secret values.
9. **Cross-surface** — start on dashboard, inspect/approve on WhatsApp, verify one shared run/activity state.
10. **Memory privacy** — use a sensitive document in a mission without leaking protected identifiers.

Only after these pass should AskGogo be described as a persistent personal agent rather than a dashboard with agent features.
