# 05 — Understand-first router (5-PR plan)

## Why

On 19 Oct Gogo asked a restaurant-reservation clarification. The user replied "This Saturday 8pm"
and a reminder titled "This" was created. A keyword rule (weekday + clock → `set_reminder`) claimed a
reply that was obviously the answer to the question Gogo had just asked. Instinct and Wajo read a
short reply in the context of the open question; AskGogo must too.

The direction: understand the message first (what is it, does it answer an open question, what is
missing), then dispatch to the existing executors. Executors, approvals, policy and provider
verification stay exactly as they are. The router only decides which executor reads the message.

## The five PRs

### PR 1 — Pending-question registry (this PR)

- `lib/bot/pending-questions.ts`: `openPendingQuestion`, `listOpenPendingQuestions` (owner-bound,
  fresh only, newest first, fails closed on unreadable timestamps), `closePendingQuestion`. Stored as
  `followup_state` rows (kind `pending_question`) in `memories`; no migration. A newer question of the
  same kind supersedes the older one; different kinds coexist.
- `lib/bot/pending-question-resolver.ts`: `tryResolvePendingQuestion`. A short detail answer (bare
  date/time, party size, or a restaurant name when a restaurant was literally asked) bound to exactly
  one fresh open question closes it and calls that kind's resumer. Two or more candidates (including
  the legacy `pending_reminder`, `pending_calendar`, `reminder_ampm` and friend-time follow-ups) → ask
  which, numbered; a numbered reply resumes the chosen one. Only legacy candidates → `null`, so the
  legacy blocks keep working unchanged.
- Resumer `reservation_slot` re-enters the same reservation entry the surface uses
  (`queueRestaurantReservationResearch` on WhatsApp, `tryRunRestaurantReservation` on the dashboard)
  with the original request and the answer merged. Approvals are created normally by that flow.
- Every reservation clarification (unclear time, missing restaurant, missing party) records a
  question. The time question reads "What time should I book Toit for? (e.g. 8 pm)".
- Wiring: WhatsApp webhook right after approval handling; dashboard chat right after auth; shared
  `process-message` before the legacy pending_reminder/pending_calendar block.
- `detect-intent`: a weekday / tomorrow / clock with no reminder verb and no subject returns
  `bare_time`, never `set_reminder`. With nothing pending, process-message asks what it is for.

### PR 2 — One structured understanding call per message, in shadow

One model call per inbound message, logged next to what the legacy router actually did. It does not
dispatch anything.

Inputs:
- the message text;
- the last 8 turns, in order;
- open pending questions (id, kind, expects, label);
- approval snapshot: pending approval ids and titles only;
- typed context (the last typed objects: flight, trip, booking, email set);
- active runs (id, type, status, title);
- timezone, city and today's date.

Output schema:

| field | meaning |
| --- | --- |
| `capability` | the capability the message is about (reminder, reservation, calendar, search, chat, ...) |
| `slots` | typed slot values extracted from the message |
| `answersPendingQuestionId` | the id of the open question this answers, or null |
| `needsClarification` | true when a required slot is missing or ambiguous |
| `clarificationQuestion` | the question to ask when `needsClarification` |
| `missingSlots` | which slots are missing |
| `targetRef` | a reference to an existing object (run, approval, typed object) when the message points at one |
| `confidence` | 0..1 |
| `safety` | flags: consequential, needs approval, external content present |

Shadow telemetry pairs each understanding with the legacy outcome
(`recordShadowRouterOutcome`), feeding the existing shadow report.

### PR 3 — Canonical renderers and an offline replay harness in CI

- One renderer per capability for clarifications, confirmations and refusals, so the same situation
  reads the same on WhatsApp and the dashboard.
- An offline replay harness in CI built from the Instinct comparison prompts and every live failure
  (starting with "This Saturday 8pm"). Each case fixes the conversation, the open questions and the
  expected capability / binding / reply shape. Model output is recorded and replayed, so CI is
  deterministic and needs no network.

### PR 4 — Live dispatcher for read-only, then reminders and watches

- The understanding result dispatches live, first for read-only capabilities, then for reminders
  and watches, only behind the existing promotion gate. Thresholds are unchanged: at least 20
  calibration samples per capability, guarded-live confidence 0.82 (`calibrateGuardedRouting`), and
  the `evaluateShadowPromotion` criteria (≥50 paired events, pairing ≥95%, contextual ambiguity ≤10%,
  capability agreement ≥90%, contextual legacy cases manually reviewed).
- Anything below the gate keeps the legacy route.

### PR 5 — Reservation and calendar live; retire superseded regex

- Reservation and calendar dispatch from the understanding result once they pass the same gate.
- Regex rules that the replay harness proves superseded are deleted, one family at a time, each
  deletion with its replay cases green.

## Safety rules (all PRs)

1. **The model never grants authority.** It proposes a capability, slots and a binding. Execution
   authority comes only from the existing executors, approval binding, Sentinel and policy.
2. **Validators must agree.** A model binding is used only when the deterministic validator for that
   capability accepts the same slots (e.g. the reservation parser reads the merged text as one exact
   time). Disagreement → clarify, never pick one.
3. **Fail closed for writes.** Unreadable state, stale questions, missing owner match, low confidence
   or any validator disagreement means no write happens; the user gets a question or a plain answer.
4. **Owner-bound everywhere.** Questions, choices and approvals are read and closed by the owner's
   telegram id only; a payload naming another owner is ignored.
5. **Approvals are never resolved by the understanding layer.** Approve/Reject keep their own
   deterministic binding.
6. **Never guess between open questions.** Two candidates → ask which.
