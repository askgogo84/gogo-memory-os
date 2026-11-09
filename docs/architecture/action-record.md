# Action record (6 Nov 2026)

One shape for every consequential action, whichever feature runs it: `lib/agent/action-record.ts`.

```
request ──► decision (policy.ts: auto | recommend | approval | human_led)
        ──► state: planned → awaiting_approval → running → verifying → verified_success
                                                   └─► failed | blocked | outcome_unknown
        ──► evidence[] (what the provider said back: ids, status, link)
        ──► verification (outcome-reconciliation.ts: verified_completed | verified_absent | still_unknown)
        ──► receiptLine(): the one sentence the person reads
```

Rules the module enforces:
- The mode comes from `evaluateAgentExecutionPolicy`; the model never decides it.
- `verified_success` is reachable only through `recordVerification`; `transition()` throws on shortcuts and on any move out of a terminal state.
- `mayRetry()` is false for `outcome_unknown`: an action whose outcome is unknown is reconciled, never re-run.
- The receipt says what was verified ("Done: …"), never what was attempted; unknown outcomes say so and name the next step.

Storage: `agent_activity` rows with `event_type = 'action_record'` (`recentActionRecords()` reads them). No migration.

Adopted so far: the shared-content offers (`expense.log`, `reminder.create`). Next, in order: `booking-calendar-execution.ts` (replace its ad-hoc `calendarExecution` metadata), `gmail-send-execution`, reminder creation in `process-message`, then the task-status reply ("what did you do today?") reading `recentActionRecords`.
