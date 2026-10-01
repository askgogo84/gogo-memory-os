# AskGogo investor-demo acceptance — 1 October 2026

This is an evidence ledger, not a claim that AskGogo matches another product.

## Release evidence

- `7069499a`: pending-task routing and explicit appointment lead-time arithmetic. User's WhatsApp screenshots confirm the task list is retrieved and tomorrow's 4:30 pm appointment produces a 4:20 pm reminder.
- `aead89ea`: time-first reminder routing. Full local suite, typecheck, build and production GitHub CI passed. Production Vercel deployment `dpl_CYoYBdhaDpH4FoYD1zdkX9juXWW6` is READY on that exact commit; app HTTP 200. Exact `4pm aqua dental appointment today.. reminder` passes the real message-processing regression. Live user retest pending.

## Core demo acceptance

| Workflow | What has evidence | What must still pass |
|---|---|---|
| Task lifecycle | Owner-scoped records identify closed train handoffs, a superseded trip, questions mistakenly captured as tasks, and missing status/age in the list | Correct list and dashboard on the same deployment; closure stays closed; old unresolved work is not silently completed |
| Reminders | Oct-1 2:00 pm water occurrence sent at 2:00:39 pm, provider state `read`; appointment arithmetic confirmed live | Fresh create → correct due time → one delivery → Done bound to that occurrence → durable closure visible across surfaces |
| Sony price watch | Stored latest query correctly says WH-1000XM5, threshold 22000 and excluded bank/card offers | Read a current Amazon listing; record INR selling price + URL + timestamp; compare numerically; alert once on a verified crossing; stop reliably |
| Memory corrections | Recall paths have regression coverage | Save fact, correct it, query with different wording from WhatsApp and dashboard; corrected fact wins with provenance |
| Browser handoff | Pause/resume and human-only auth boundaries exist in code | Real provider session pauses for the human, resumes the same task and produces verified evidence; no claimed action without receipt |

## Confirmed gaps to address

1. Two active Sony watches exist with different query phrasing. Their worker records URL/signature changes, not a measured product price. A successful watch-creation confirmation is not proof of a functioning price-threshold alert.
2. Reminder `Done` currently acknowledges already-sent recurring occurrences without recording an acknowledgement; plain-text Done also selects a recent/pending row. Durable occurrence-bound closure needs verification before demo sign-off.
3. Browser provider access and same-session human takeover have not been demonstrated end to end. Do not advertise successful Blinkit/cart execution based on a product link or fixture.
4. Persistent corrections and self-learning are not signed off by tests of storage alone.

## Copyable acceptance prompts

Run one workflow at a time. Do not repeat creation prompts if the result is uncertain; inspect the saved record first.

### 1. Task status

```text
Show my pending tasks.
```

Expected: actual status/blocker and source age; closed/superseded handoffs and task-status questions do not appear as active work. Compare the dashboard against the same source records.

### 2. Reminder delivery and closure

```text
Remind me in 3 minutes to check the investor demo reminder.
```

Expected: one saved occurrence and correct local due time. Wait for the actual WhatsApp message, tap Done on that message, then inspect that occurrence and the next cron pass. A send acknowledgement alone is not proof of delivery or closure.

### 3. Memory correction

```text
Remember for my investor demo: the demo project is called Cedar and its budget is 12000 rupees.
```

```text
Correction: Cedar's budget is 15000 rupees, replacing the earlier 12000. Keep the project name unchanged.
```

```text
What budget have I allocated to the demo project?
```

Expected on WhatsApp and dashboard: 15000, with the old amount superseded rather than returned as a conflicting current fact. Run this only as a clearly identified demo memory, not a real financial record.

### 4. Sony watch

An existing live watch already exists. Do not create another for the demo until duplicate prevention and numeric price evaluation are verified. Preserve the request: Sony WH-1000XM5, amazon.in, below INR 22000, listed selling price only, no bank/card offers, no invented storage variant. Never fabricate a price drop to make the demo succeed. A controlled price-change fixture must be labelled as a simulation.

## Sign-off rule

Mark each workflow separately: fixture verified, deployed, live verified, or blocked. No global “fully autonomous”, “self-learning complete”, or competitor-parity claim until the corresponding live acceptance evidence exists. Do not purchase access services, place orders, contact providers, bypass auth or alter existing user records merely to make a demo pass.
