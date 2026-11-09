# AskGogo agent parity and enterprise governance — 7 November 2026

## Scope and evidence

Inspected AskGogo main ab5b798e82f6ce17bfaa4fab2b0253b8a3753dc9, coordination issue #274. At inspection the phase-1 synthetic Tipplr pilot PR #1355 was merged, while phase 2–4 PRs #1356–#1358 were open. These are not claims about deployed production or real provider success.

OpenAI Dots: durable goals, connected apps, cloud computer, task continuity, controls and review (https://openai.com/index/introducing-dots/).
Meta Muse: WhatsApp-native personal agent, cloud VM and independent Sentinel, proactive memory, approvals for consequential tasks (https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/).
Meta AI / Muse Spark 1.1: email/calendar research, planning, presentations and daily briefs (https://about.fb.com/news/2026/07/meta-ai-muse-spark-doesnt-just-think-it-acts/).
Meta Muse Wonder, Oct 12: Active Memory, Active Focus, API available for developers (https://about.fb.com/news/2026/10/introducing-muse-wonder-models/).
Meta Muse Spaces, Nov 6: personal, customizable, updateable workspaces (https://about.fb.com/news/2026/11/introducing-spaces-customize-muse-app/).
Meta Muse Voice, Nov 5: real-time interruptible voice and optional avatars (https://about.fb.com/news/2026/11/introducing-muse-ai-voice-expressive-avatars/).
Claude Duet: proactive attention, own virtual browser, background tasks and human approval for sends, payments, signatures and deletion (https://claude.com/resources/articles/claude-duet).
Meta Business Agent and Muse for Small Business: enterprise assistants with connectors, customer support, business briefs and approvals (https://about.fb.com/news/2026/06/meta-business-agent/ and https://about.fb.com/news/2026/09/introducing-muse-small-business/).

Note: screenshot features cross Meta's personal AI, creator, advertising and commerce products. Do not assume one product/API or India rollout.

## What AskGogo already has in code (not necessarily production verified)

Agent goal engine and worker, action record, Sentinel, managed secure browser, contextual travel watchers, open loops, people, watch-cost policy and core permission policy. The existing GOGO-MUSE-90-PARITY-ROADMAP.md describes the product direction; percent-parity claims should depend on reproducible customer outcomes, not file presence. Known acceptance blockers include browser auth/resume reliability, provider receipts, multi-channel continuation and prior desktop/TV voice echo.

## Priority implementation queue

P0 — Reliability and trusted autonomy:
1. Durable run IDs and leases; single task timeline across WhatsApp/dashboard; crash resume and no duplicate execution.
2. Context compiler using consented, source-bound calendar/email/tickets/tasks, expiry, dedupe, source IDs, quiet hours and cost budgets.
3. Enterprise membership, resource isolation, scoped grants, exact approval and idempotency; preserve existing policy.ts + Sentinel + action-record.
4. Browser login/OTP/CAPTCHA handoff without claiming success from a login page; prefer official provider APIs.
5. Verification from provider read-back before verified_success; unknown outcomes never blind-retry; actionable attention inbox.

P1 — User experience:
6. Gogo Spaces: 'My Day', 'Travel', 'Bills', 'Family', 'Work' and 'Merchant Operations' assembled from safe widgets bound to trusted sources. No arbitrary executable generated apps.
7. Real-time voice with echo and interruption fixed before investing in animated avatars.
8. Verified shopping/search/booking, preparation and explicit purchase approval.
9. Compare Muse Wonder API, Claude and other models using accuracy, privacy, recovery, latency, provider-verification and rupees per successful task. No model change based only on marketing.

P2 — Growth:
10. Business marketing drafts and image/video assets, CRM workflows and ad-creative assistance; never spend/publish automatically.
11. Collaborative Spaces, repeatable vertical templates, administrator dashboards, compliance exports.

## Enterprise architecture

Channels -> verified actor + tenant membership -> consented workspace memory -> durable agent plan -> deterministic enterprise authorization + existing policy/Sentinel -> one-shot approval with atomic DB claim -> Tipplr/Flipkart/POS adapters -> provider read-back -> tenant-scoped audit record.

Enterprise needs organizations, teams, outlets, verified roles, DB RLS, SSO lifecycle, keys/tokens, tenant retention/export/deletion, security testing, vendor controls, spend limits, monitoring, SLAs and metered billing. A pure function is not a substitute for these.

## Tipplr/Flipkart rollout

A. Synthetic approval-driven pilot: orders, out-of-stock, breakfast cutoff, digest, invoice draft.
B. Consented read-only rollout to 5–10 outlets; verify real order IDs, restaurant mappings, cancellation reasons and provider statuses against source.
C. Guarded writes to one outlet, then controlled cohort. Bind approval to exact tenant, actor, outlet, item/order, action and idempotency key; claim approval atomically; verify read-back; halt on unknown outcome or tenant leakage.

Acceptance targets (not achieved metrics): zero cross-tenant access; zero unapproved writes; no duplicate consequential writes; no retry of unknown outcome; 100% source-bound operational recommendations; at least 95% factual accuracy on held-out synthetic merchant questions. Track cancellation-rate change, time saved, action receipts, model and browsing cost per outlet, user override rate and feedback.

## This PR

New lib/enterprise/governance/authorization.ts is a fail-closed pure preflight for orders, menu, invoices and ops. It denies unverified/inactive membership, cross-tenant resource and actor, disabled capability, inadequate role, unknown action, wrong operation, missing/expired/used/mismatched approval and missing idempotency key. Invoice filing requires a distinct approving actor. A 24-case deterministic test script is included.

**Not wired into production.** No changes to Tipplr pilot files, API endpoints, databases, RLS, authentication, application runtime or live provider calls. Before integration, source actor roles/approvals from trusted DB queries; enforce atomic approval consumption; validate read-back through action-record; conduct security review, CI/typecheck/build, shadow tests and explicitly approved human acceptance.

Coordination: https://github.com/askgogo84/gogo-memory-os/issues/274
