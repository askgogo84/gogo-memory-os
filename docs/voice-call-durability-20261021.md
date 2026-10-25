# Voice-call durability hardening

Baseline main: b563a57 (#734). This branch is independent of Work #735/#736. Coordinate through issue #274. No real phone calls, booking writes, messages or production data changes were performed by this work.

## Confirmed failure and fix

The actual chat entry on baseline contacted the synthetic provider even when agent_runs insertion failed. Permanent RED control: run `verify-voice-call-durability.mts` with VOICE_CALL_AUDIT_SOURCE pointing to the baseline voice-call.ts; the actual-entry persistence test fails with one provider effect where zero is required. The fixture never contacts Bolna.

The new `voice-call-execution.ts` adapter derives a deterministic UUID from owner, exact approved plan and attempt. The run PK is the cross-worker claim, persisted BEFORE any provider call. Duplicate/racing approvals cannot call twice. Missing/changed consent, wrong latest plan, invalid/future/expired timestamps, foreign owner and unsafe redials fail closed. A successful HTTP return with missing execution ID, transport uncertainty or acceptance-write failure remains unknown and cannot blindly retry. Only a definite provider rejection permits a separately requested bounded redial. Old pending plans without the new approval hash need a fresh plan; they cannot silently execute.

Terminal-result workers acquire one owner-bound result claim before interpreting/persisting/reporting. Concurrent pollers do not send twice. Interrupted result claims transition to unknown instead of being reclaimed by age. Booking records retain their existing owner/execution dedupe key; the associated reminder now has a deterministic PK and an idempotent insert. Failed reminder persistence no longer produces a promised reminder. Provider calls still running after the reporting deadline are unknown, not evidence that nothing was booked.

## Verification

Fifteen actual-module inert groups: racing approval; timeout after provider effect; pre-effect persistence failure; post-effect persistence failure; timestamp/consent/target changes; unknown/inflight/confirmed redial refusal; explicit retry after definite rejection; foreign previous attempt; actual chat entry with failed persistence; concurrent result pollers; interrupted result worker; nonterminal provider timeout; one booking/reminder under duplicate polling; honest reminder failure; interrupted provider call with dialogue remains uncertain instead of claiming nothing was booked.

Run targeted script, existing voice suite, full registered regression inventory, typecheck and build. Results and exact head are recorded in #274 and the PR when complete. An initial local build failed because Turbopack rejects a node_modules symlink outside the worktree; this is not counted as a passing build. Reinstall the locked dependencies in the worktree and rerun the normal build.

## Remaining limitations

- Unknown call placement without a returned provider ID still requires provider-side investigation; do not clear the durable intent to force another call.
- Result notification delivery is not proof the user received it. Migration to the shared quiet-policy/receipt gateway is the next delivery slice.
- Interrupted result work may need reconciliation rather than automatic continuation; this patch intentionally prevents ambiguous repetition.
- Phone booking confirmation is inferred from the actual provider transcript, not a written venue receipt. Exact returned date/time/party verification and prompt-injection-resistant evidence extraction need further security acceptance. Do not call all of gate8 complete from these tests.
- No production acceptance or superiority over Grok/Instinct is established by these fixtures.
