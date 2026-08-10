# Implementation Plan — AskGogo First-Message Onboarding

**Track:** Onboarding (doc 6 of 6)
**Status:** Ready to execute once copy is confirmed
**Date:** 10 Aug 2026
**Reads with:** all of `PRD-01` … `SCHEMA-05`

---

## 0. Blockers to clear first

These are not part of this track, but they touch it:

| Item | Why it blocks | Effort |
|---|---|---|
| Bill-split A+B fix | `my card balance` dead-ends; can't be an example, and a new user will try it | Approved, unwritten — one session |
| `gold price` 18K bug | It's in the example list and returns an impossible number | Unknown, investigate |
| Routing fix uncommitted | Sitting dirty in the tree; any deploy picks it up | Commit it |

Ship at least the first two before enabling the gate. A new user's first
impression is the whole point of this track.

## 1. Phases

Each phase ends in a reviewable state. Do not run two phases in one session.

| Phase | Deliverable | Gate state |
|---|---|---|
| A | Migration applied + backfilled + confirmed | n/a |
| B | Copy file + routing harness passing | off |
| C | Handler built, wired, deployed | off |
| D | Gate enabled, phone-tested | on |

## 2. Phase A — schema

Hand-applied by you. Claude Code cannot run DDL.

1. Run the migration from `SCHEMA-05` §3 on **`qenhjcooyecmatwducpu`** — check
   the ref in the URL bar.
2. Run the confirming SELECT. Two rows, or stop.
3. Run the backfill from `SCHEMA-05` §4.
4. Run the backfill confirmation. Zero null stages, or stop.

Do not proceed until step 4 returns zero nulls.

## 3. Phase B — copy and harness

```
Phase B of the onboarding track. Two new files, no wiring yet, no changes to any existing file.

Read docs/onboarding/UIUX-03-askgogo-onboarding.md first — it holds the copy and the five example phrasings.

1. Create lib/bot/onboarding-copy.ts exporting:
   - WELCOME(name?: string): string
   - CAPABILITIES(name?: string): string        // message 2a
   - EXAMPLES(name?: string): string            // message 2b, includes the dashboard line
   - FIRST_ACTION(name?: string): string        // message 3
   - EXAMPLE_PHRASINGS: string[]                // the five, as plain strings
   Copy comes verbatim from the UI/UX brief. Bold via WhatsApp *asterisks*. NO italics anywhere. Handle a missing name by dropping the name clause cleanly, not by printing "undefined".

2. Create scripts/verify-onboarding-examples.mjs modelled on scripts/verify-creditiq-routing.mjs. It must exercise the REAL two-stage pipeline order — the routeFeatureIntent matchers first, then detectIntent — and assert every string in EXAMPLE_PHRASINGS routes to its intended handler. A phrase claimed by an upstream matcher that should have reached a different handler is a FAILURE, not a pass.

   Include these as must-NOT-match controls: "my card balance" (currently hijacked by bill-split), "start", "hey".

Run the harness and paste the full pass/fail table. Do not modify any existing file to make it pass — if an example doesn't route, report it and stop.
```

**If any example fails**, that is information, not an obstacle — swap the
example in the copy rather than widening a matcher. Matcher widening is how the
last three bugs happened.

## 4. Phase C — handler and wiring

```
Phase C of the onboarding track. Read docs/onboarding/TRD-02 and APPFLOW-04 first.

1. Create lib/bot/handlers/onboarding.ts with a single entry point that takes the inbound message + the user row and returns either null (not our concern, continue routing) or the messages to send plus the new stage.

   Implement the state machine from APPFLOW-04 §1 and every branch in §3. Specifically:
   - null stage → send WELCOME, set 'welcomed'. If the message ALSO parses as a real command, let it continue to normal routing (branch 3.1).
   - 'welcomed' + real command → return null, let routing handle it, then FIRST_ACTION fires downstream.
   - 'welcomed' + trigger word OR anything unrecognised → CAPABILITIES then EXAMPLES, set 'capability_sent' (branches 3.2).
   - any other stage → return null immediately, before any DB work.

2. Wire it into app/api/webhooks/whatsapp/route.ts at the TOP of the handler, BEFORE routeFeatureIntent (:836). Not as another matcher in the chain.

CONSTRAINTS — this is the hottest path in the repo:
- Gated on ONBOARDING_ENABLED. When unset, return immediately with zero DB reads and behaviour byte-identical to HEAD.
- Every failure fails OPEN: a state read/write error, a generation error, or a send error must NEVER prevent the user's own message from being handled. Wrap everything.
- The stage write that sets 'welcomed' must be the concurrency guard (branch 3.6) — set it as part of the same write that decides to send the welcome, so a second message arriving within the same second reads the advanced state.
- Static copy only for v1. Do NOT add LLM generation of the capability response in this phase.
- Do not touch routeFeatureIntent, detectIntent, the reminder send path, the dedupe guard, or the delivery-truth code.

When done: show the full diff, list every file changed with its risk, and give me the phone-test checklist from APPFLOW-04 §7.
```

Note the last constraint: v1 ships **static copy**, not generated. Generation is
a Phase E enhancement once the flow is proven. A generated first-impression that
drifts or times out is a worse failure than a slightly less personal fixed one.

## 5. Phase D — enable and verify

1. Deploy with `ONBOARDING_ENABLED` unset. Confirm nothing changed — message
   AskGogo from your own number and see normal behaviour.
2. Confirm the backfill again:
   `select count(*) from public.users where onboarding_stage is null;` → **0**.
3. Set `ONBOARDING_ENABLED=1` in the **gogo-memory-os** Vercel project.
   Redeploy — the variable does nothing until you do.
4. Run the full test matrix from `APPFLOW-04` §7 from a genuinely new number.

**Row 8 is the release gate.** An existing user must receive no onboarding
message of any kind. If any existing user sees a welcome, unset the flag
immediately and investigate before doing anything else.

## 6. Rollback

Unset `ONBOARDING_ENABLED`, redeploy. Flow stops, columns go inert, no code
change. Same pattern that made the TIER 1A rollout safe.

## 7. Deliberately deferred

| Item | Why |
|---|---|
| LLM-generated capability response | Prove the flow first. Static is safer for a first impression |
| Quick-reply button for the trigger | Needs a Meta template approval cycle |
| Follow-up nudge if the user goes quiet | Business-initiated, needs a template, consumes the 250/24h cap |
| Per-example activation tracking | A second table; not needed to ship |
| Language-aware routing | The real fix for non-English users, but a separate track. Branch 3.2 covers v1 |

## 8. Definition of done

- Migration applied, confirmed, backfilled, confirmed
- `verify-onboarding-examples.mjs` passing against the real pipeline order
- All ten rows of the test matrix pass on a real phone
- No existing user received a welcome
- Gate can be unset for an instant, code-free rollback
