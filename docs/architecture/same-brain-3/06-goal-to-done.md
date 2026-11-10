# Same Brain 3.0, Addendum 5: Goal-to-Done

Reference: the Daybook task-delegation video. AskGogo does not clone it. This note says what AskGogo already had, what the addendum adds, and in which order, with every new part off in production until switched on.

## What AskGogo already had

| Daybook capability | AskGogo today |
|---|---|
| One request with several goals | `general-planner.ts` splits a multi-domain request into steps; `persistent-general-plan.ts` runs safe steps in waves |
| Background work that survives closing the app | `autonomous-runtime.ts` (durable steps, leases, retries), cron sweepers, the background browser worker |
| Approvals before consequential actions | `agent_approvals`, approval cards on WhatsApp and the dashboard, Sentinel, execution policy, Adaptive Trust |
| Status per task | Tasks page: Needs you · On radar · Recent · To-dos; one owner-facing state per run (`task-state.ts`) |
| "Is it done?" | Owner confirmation (`owner-confirmation.ts`): only the owner marks an outcome task complete; `outcome_unknown` is never retried blind |
| Proactive follow-ups | Open Loops scout, attention state, calendar clash detection |
| Same task on WhatsApp and web | Both read the same `agent_runs`, `agent_steps`, `agent_approvals` |

## What the addendum adds

1. **Ownership** (`lib/agent/task-ownership.ts`). Each task is shown as Gogo handles, We do together or Your turn. It is responsibility, not permission: derived at read time from the plan's label (when Gogo took the task on from a list) and the task's state now, taking the more hands-on of the two. No permission code reads it. No migration: an intake plan writes `metadata_json.ownership` on the runs it starts.
2. **"Done" states**: Done, checked · Done, not checked · Draft ready · Needs your yes · Waiting · Blocked · Could not finish · Not sure it happened (plus Working now, Starting, Cancelled). "Checked" needs evidence from outside the agent that did the work: the owner's confirmation, or `metadata_json.verification = {state:'verified_completed', check, at}` written by a code check that read the result back from the provider. A check named after a model is refused. A draft is never done.
3. **Tasks › Overview** (`lib/dashboard/goal-board.ts`, `components/dashboard/goal-board.tsx`), built to the approved mock. Flag `GOGO_TASKS_OWNERSHIP` (`on`, or a comma list of owner numbers). The other tabs are unchanged.
4. **Taking a list of goals** (phase 2): extract goals from a paragraph, voice note or pasted list; remove duplicates; ask only for what is missing, once; start what is allowed on "get it done"; emails stay drafts behind approval cards; one parent with linked children.
5. **Independent checks** (phase 3): per kind, code that reads the result back (reminder row, calendar event, list) and records `verification`. Never another model as the only proof.
6. **Corrections and preferences** and **Events nudges** (phase 4).

## How the numbers are counted (last 30 days)

- Done and checked: finished runs with outside evidence.
- Need you: drafts, approvals, blocked runs, unknown outcomes.
- Time saved, estimated: for each finished run (never a draft, failure or unknown outcome), a fixed number of minutes for its kind, summed. The table is `TIME_SAVED_MINUTES` in `goal-board.ts`: reminder 2, list 2, memory 1, calendar 4, web search 10, research 15, travel or flight 20, comparison 15, price 10, booking or reservation 10, meeting prep 10, artifact or document 20, events 10; anything else 5. It is an estimate and is labelled as one.
- Runs that worked: finished ÷ (finished + failed); unknown outcomes are counted on their own.
- Handed to Gogo: tasks Gogo took on ÷ (those + the owner's own to-dos).

## Not claimed

Cross-device continuity is the shared database: WhatsApp and the web dashboard read the same rows. A Windows companion, Android or TV surface is not part of this work. A cloud dashboard is not evidence that background workers ran.
