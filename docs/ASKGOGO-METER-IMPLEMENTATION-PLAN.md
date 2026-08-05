# AskGogo — Meter Implementation Plan
*Doc 3 of 3. Repo: `C:\Users\gover\gogo-memory-os` → Vercel project `gogo-memory-os` (NOT `credit-iq`). Deploy: `git add/commit/push` then `npx vercel --prod`. PowerShell chains with `;` not `&&`.*

---

## Phase order

Each phase is a separate session with its own diff review and its own deploy. Nothing here jumps ahead of **TIER 1A (delivery-truth reminders)** — a meter on top of an unaudited send path is the wrong order.

---

## Phase 0 — Read-only investigation *(no code)*

Before anything is written, confirm on the actual codebase:

1. Every call site that hits an LLM or a paid API — grep `askClaude`, `askClaudeWithContext`, web-search service, `parseImageTicket`, PDF ticket parse, image classifier. Produce the definitive list of billable actions and their file:line.
2. Whether a friend-reminder contacts table exists (decides §5 of the schema doc).
3. Where the IST day-window helper already lives (reminder-limit fix) so it is reused, not rewritten.
4. Whether `telegram_id` is reliably present on every path, or whether some paths only carry `whatsapp_to`. **This is the highest-risk unknown** — the meter keys on user identity, and the codebase has already burned a session on `whatsapp_to` vs `whatsapp_id`.

**Output:** a short findings note. No files changed. If (4) comes back messy, the identity question gets solved before the meter is built, not during.

---

## Phase 1 — Migrations *(SQL only, no code)*

Apply the three tables from the Backend Schema doc in `qenhjcooyecmatwducpu`, in order, each confirmed with a SELECT that returns the object. Backfill every existing user into `user_plans` as `free`, then confirm the row count matches the user count.

**Do not proceed to Phase 2 until all four SELECTs have been eyeballed.**

---

## Phase 2 — The meter module *(pure, offline-testable)*

New file: `lib/services/meter.ts`. Nothing else changes in this phase.

```
getPlan(telegramId)                 → plan row, defaulting to 'free' when absent
getLimits(planCode)                 → row from plan_limits (cached ~5 min in-process)
getUsage(telegramId)                → { aiToday, docsThisMonth, friendContacts }
checkAllowance(telegramId, counter) → { allowed, used, limit, resets }
recordUsage(telegramId, counter, action, meta)  → insert into usage_events
```

Rules baked into the module:

- `checkAllowance` throws a distinct `MeterUnavailableError` on any DB failure — callers translate that to the honest *"couldn't verify your allowance"* message. **Fails closed.**
- `recordUsage` never throws upward. If the ledger insert fails, log `USAGE_RECORD_FAILED` and continue — a metering failure must never cost the user the answer they already paid for.
- Check happens **before** the expensive call; record happens **after it succeeds**. A failed LLM call is never billed.

**Tests:** offline unit tests for window maths (IST day boundary, IST month boundary, month rollover), free-default when no plan row, limit-exactly-reached vs limit-exceeded. `npx tsc --noEmit` — 5 pre-existing errors are known; only NEW errors matter.

**Deploy:** nothing is wired yet, so this phase is safe to ship on its own.

---

## Phase 3 — Wire ONE action *(web search)*

Behind env var `METER_ENABLED` (unset = meter completely bypassed = instant rollback, same reversible-rollout pattern as the reminder buttons).

1. Wrap the web-search call site: `checkAllowance` → call → `recordUsage`.
2. Run-out copy, with the reset time and one link.
3. Low-allowance footer at the last 20%, on that reply only.

**Test on phone.** Set free tier on a test user, burn 5 searches, confirm: the 5th works, the 6th is refused honestly, a reminder created immediately after still works normally, and unsetting `METER_ENABLED` restores everything.

Only after this passes does anything else get wired.

---

## Phase 4 — Wire the rest, one action per commit

Same wrap, one at a time, each with its own diff review:
translate → ask-anything/general LLM → image classify → on-demand brief → ticket parse *(counter: `document`)* → statement parse → receipt parse.

**The routing rule, enforced at every site:** if the action belongs to CreditIQ, it calls the CreditIQ meter over HTTP with `x-wa-secret` and does **not** touch the AskGogo counters. One action, one counter, never both. Add an explicit test for a linked user: one CreditIQ question from WhatsApp must decrement exactly one counter, in `yazpphublutdodahfwvr`.

---

## Phase 5 — Reminder fair-use ceiling *(handle with care)*

The only reminder-path change in this entire track. Count existing reminder rows for the IST day at **creation** time; if over the plan's `reminders_per_day_fair_use`, refuse creation with a warm message.

- **Fail OPEN.** Any error in this count creates the reminder anyway.
- Touches only the creation path. **Nothing goes into the send path.**
- Diff-reviewed line by line before deploy — this file has caused real outages.

---

## Phase 6 — Entitlements

`calendars_max` and `friend_contacts_max` enforced at connect-time / add-time. Includes the 7-day calendar trial for Free (`calendar_trial_started_at`), assuming option (a) from the PRD stands. When the trial lapses, the morning brief carries the warm pause message rather than silently dropping the calendar section — silent drops are how the 1C "not connected" bug hid for so long.

---

## Phase 7 — Surfaces

- **WhatsApp:** `usage` / `my plan` command → three lines plus reminders-unlimited.
- **Dashboard:** the usage card, three progress bars, reminders shown as Unlimited, upgrade CTA. Both surfaces read the same `getUsage` — never two implementations.

---

## Standing rules for this track

1. Verify before build — the codebase reality has differed from assumption every time.
2. Migration-first, confirm with SELECT. Never trust "applied."
3. Review the diff before deploy, especially anything near reminders.
4. Reversible rollout — `METER_ENABLED` unset reverts everything instantly.
5. Fail closed on the product meter, fail open on abuse guards and on the reminder ceiling.
6. One action per commit in Phase 4. Not seven at once.
7. Test on phone. The WhatsApp screenshot is the only real confirmation.

---

## Definition of done

- A free user hits 5 AI actions, is refused honestly, and can still set unlimited reminders.
- A linked CreditIQ user's card question decrements exactly one counter, in the right project.
- `METER_ENABLED` unset restores pre-meter behaviour with no code change.
- Dashboard and WhatsApp report identical numbers for the same user at the same moment.
