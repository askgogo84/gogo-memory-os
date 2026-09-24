# Same Brain v2 engineering handoff — 24 September 2026

This is an implementation and validation record, not a claim that live production acceptance is complete. Authenticated provider tests and real historical improvement measurements still need an operator session.

## Changes

- PR #250: isolate rejected learning hints from Jev; enforce classified approval requirements and contextual precedence; reject invalid confidence.
- PR #251: outcome-based confidence using the 95% Wilson lower bound, at least 20 identified decisions, sparse/conflicting evidence held in shadow mode, sanitized administrator reporting.
- PR #252: exact previous-turn correction binding and cross-domain actual-handler capture.
- PR #253: fix existing TypeScript/runtime defects; make typecheck required; add production build with fixture credentials to CI.
- PR #254: exact-message Gmail verification reads, no send retry or task-completion side effect; canonical Attention categories; retain legitimate one-shot watcher alerts; defer negative routing evidence until a different handler handles a correction.
- PR #255: preserve provider proof against generic completion; allowlist safe learned handlers; record planner SDK usage against runs; share prepared plans across persistent/general execution; include planning time and pre-window history; skip Jev for deterministic status reads.
- Final send-safety change: atomically claim approved Gmail execution; block running/unknown/completed replay; retain the expected thread in send receipts; connect the authenticated web execute endpoint to the Gmail specialist.

Learning changes never grant permission. Approval binding and typed identity remain deterministic. Generic completion is unverified success. A later unknown/failure/correction can supersede earlier verification. Replacements express a route preference, not proof of provider completion.

## Automated regression coverage

Run `npm test`, `npm run typecheck`, and `npm run build` in the full repository. CI uses fixture credentials. No tests should send real email, buy, pay, or book.

| Area | Regression programs / evidence |
| --- | --- |
| Gmail exact search, selection and draft identity | `verify-jev-email-routing.mts`, `verify-gmail-send-flow.mts`, existing typed-context contracts |
| Gmail approval and send execution | `verify-gmail-send-execution.ts`: real executor with mocked database/provider, approval/hash rejection, concurrent requests produce one POST, missing SENT/wrong thread/transport uncertainty never retry |
| Gmail verification reads | `verify-provider-readback-attention.ts`: exact persisted IDs, unavailable evidence, no mutation or retry, connection-query isolation |
| Calendar | `verify-calendar-routing.mts`, `verify-agent-travel-calendar.mts`, `verify-agent-general-plan.mts`, `verify-workspace-meeting-approval.mts` |
| Reminder identity and dedupe | `verify-reminder-dedup.mts`, `verify-reminder-list-p0.mts`, `verify-autonomous-brain-matrix.mts` |
| Watchers and product truth | `verify-agent-watchers.mts`, `verify-product-stock-evidence.mts`, `verify-watcher-stale-ideas.mts`, new canonical Attention fixtures |
| Travel continuation and evidence | `verify-agent-travel-research.mts`, `verify-agent-same-brain.mts`, `verify-booking-context-isolation.mts`, `verify-persistent-general-plan.mts` |
| Browser persistence and safety | `verify-agent-secure-browser.mts`, `verify-browser-auth-gate.mts`, `verify-exact-approval-binding.mts`, `verify-policy-gate-coverage.mts` |
| Attention/open loops | `verify-open-loops-attention.mts`, `verify-provider-readback-attention.ts` |
| Learning and calibration | `verify-guarded-learning.ts`, `verify-decision-evidence.ts`, `verify-decision-feedback.ts` |
| Usage/accounting | `verify-task-metrics.ts`, planner fallback regression, required TypeScript checks |

Existing coverage includes source-contract assertions as well as behavioral tests. Passing it is not equivalent to live provider end-to-end acceptance. The new fixtures execute learning, reporting, verification and send logic against controlled inputs.

## Observability and measurement limits

Authenticated administrator endpoint:

`GET https://app.askgogo.in/api/admin/shadow-brain?hours=168`

The `sameBrainV2` payload includes decision rates, confidence buckets, patterns, negative/correction evidence, verified outcomes, allowed/shadow hint counts, recent sanitized learning events, Jev attempts/tokens/latency, and linked task measurements. Counts are bounded samples; truncation is exposed.

- First-route accuracy remains null where no explicit correctness judgment exists. Completion alone is not a correctness label.
- Planner calls/tokens/cost cover the instrumented general/persistent planner SDK invocations, including fallback. They do not yet cover every specialist model call or SDK-internal HTTP retry individually.
- Task elapsed time includes planning and approval wait, and is labeled accordingly.
- Completed tasks load historical activity by run identity, even if planning occurred before the report window.
- Missing usage is null, never zero. Cost is null unless `MODEL_TOKEN_RATES_JSON` supplies nonnegative `inputUsdPerMillion` and `outputUsdPerMillion` rates for the model. Cache-specific pricing is not inferred.
- Whole-task model-call/token/cost totals remain incomplete until specialist coverage is extended. Do not present planner-only values as total task costs.
- No production improvement percentages, token savings, or cost savings have been established in this session. The live report returned HTTP 401 without an administrator session.

## Copyable production acceptance commands

Use a dedicated test account. Run each conversational sequence in order and inspect canonical/provider state after each step. These are manual checks; the engineering session did not send messages on your behalf.

### Reminders

```
Remind me tomorrow at 5 PM to review the Same Brain fixture.
Move it to 6 PM.
Show my reminders.
Move the second one to 9 PM.
Move that one to 10 PM.
Show my reminders.
```

For the ordinal steps, first ensure the displayed test list has at least two harmless reminders. Expect stable IDs and counts, with no duplicate creation.

### Calendar

On a test calendar containing an event named `AskGogo Production Calendar Test` tomorrow:

```
What time is AskGogo Production Calendar Test tomorrow?
```

Expect a provider read and no reminder creation. On the same test account:

```
Add AskGogo Same Brain Calendar Fixture tomorrow at 3 PM for 30 minutes.
```

Inspect the approval preview before approving the harmless test event. Then:

```
APPROVE
What time is AskGogo Same Brain Calendar Fixture tomorrow?
Move that event to 4 PM.
```

Expect any required mutation approval and provider verification. Do not approve unrelated pending actions.

### Gmail

Prepare harmless messages to/from your own test account with exact subject `AskGogo Same Brain Fixture`, and ensure a search returns multiple fixture messages.

```
Search Gmail for the exact subject "AskGogo Same Brain Fixture".
Open the first one.
Draft a reply to that exact email saying: This is the harmless Same Brain fixture reply.
Send it.
```

Before approval, verify that no message was sent and the preview identifies your own test recipient and the selected thread. Only then, manually:

```
APPROVE
Did Gmail actually send that message? Give me provider verification.
Check my Gmail send connection.
```

Expect SENT and the expected thread from live readback. The verification query must not send again or mark an unrelated task complete. If the outcome is unknown, stop; do not repeat the send.

### Watchers / Attention

Using a harmless existing test watcher with a unique title, replace `Same Brain Fixture` with that exact title if necessary:

```
Show my active watchers.
Stop Same Brain Fixture watcher.
Show my active watchers.
Restart Same Brain Fixture watcher.
Show my active watchers.
What are you working on right now?
```

Expect the same watcher/configuration restored exactly once, canonical counts, no stopped-watcher ideas, and distinct active/background/queued/pending/dormant sections. Product-stock acceptance additionally requires a controlled exact-product/variant page; no purchase or cart action is needed.

### Travel and browser

```
Research hotels in Bengaluru for 10–12 October 2026 for 2 adults, under ₹8,000 per night, near MG Road. Do not book anything.
Continue that hotel research from where you left off.
What are you working on right now?
Open https://example.com and summarize the page. Do not submit any forms.
Continue that browser research.
```

Expect retained constraints and task identity, explicit provider/public-web distinctions, no invented fares/inventory, and no external mutation. Consequential form/checkout gating remains tested with fixtures; do not complete a live purchase or booking.

## Remaining acceptance blockers and work

1. Administrator authentication is required to inspect real learning samples and establish baseline metrics. Hosting authentication does not grant application-admin access.
2. A connected test account is required for WhatsApp, Gmail, Calendar and browser-provider end-to-end acceptance.
3. Historical real-world samples are required to prove improvement over time; synthetic tests do not establish it.
4. Specialist-wide model usage coverage and explicit first-route quality labels still need expansion before investor-grade whole-task economics can be reported.

CI/deployment links and final merged commit are recorded in the accompanying engineering response. Do not mark the complete Same Brain v2 definition of done satisfied until these limitations are resolved.
