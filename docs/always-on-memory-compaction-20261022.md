# Chat-summary correction durability — 22 October 2026

Independent main-based slice of the ten-area hardening mission, coordinated in issue #274. Audited base: `b563a57b6eeaa39aa48d0fdf6bbd1659ae3e3a40` (#734). Branch: `fix/work-chat-summary-durability-20261022`. No claim that this patch is deployed or live accepted.

## Confirmed defects and minimal fix

| Requirement | Exact implementation path and before evidence | Risk and minimal change | Regression evidence |
| --- | --- | --- | --- |
| Corrections survive asynchronous compaction | `lib/agent/conversation-summary.ts`: `readConversationSummary` chose the last inserted row; refresh deleted every other row by insertion order. An older model job can finish after a newer one, make an old dinner time current again and delete its correction. Actual exported functions reproduced both windows. | Incorrect personal context may propagate to later planning. Read by greatest source-message `upTo`, recheck after synthesis, select the same deterministic equal-cursor survivor and delete only observed loser IDs for that owner. Preserve append-before-cleanup ordering. | Late insert, in-model replacement, post-recheck insertion, simultaneous same-cursor writers, deterministic tie order, cleanup failure and owner controls. |
| Failed reads do not fabricate an empty memory baseline | Same module ignored Supabase `error` on conversation/summary reads. A failed read with partial data could still synthesize/write a replacement. | Lose prior context while reporting a normal update. Strict internal reads abort refresh; public context reads remain best-effort and withhold on failure. Bounded candidate scan fails closed at 100 matching rows rather than select from an incomplete set. | Baseline read failure, history read failure, post-model read failure, insert failure, saturated read. |
| Secret filtering reaches the prompt boundary | Same module redacted new writes, but legacy summary text was passed directly into both `summaryContextBlock` and the next Mercury prompt. | Previously stored sensitive values can re-enter model context. Apply existing redactor to both paths and retain existing marker stripping. Vault plaintext and storage architecture are unchanged. | Legacy sensitive-value positive controls before both models; original secret filtering/fenced-context assertions remain unchanged. |
| Preserve available source timing and epistemic status | Same module supplied only role/text to Mercury and labelled a synopsis generally incomplete. Relative dates lacked their message timestamps; assistant claims could become an asserted booking state. | A historical plan can look current and an assistant claim can look verified. Include each existing source timestamp, label assistant claims, ask synthesis to retain corrections/dates, and label the final block unverified with its source coverage cursor. | Actual prompt role/time assertions. This verifies transmitted metadata, **not** model compliance or claim-level provenance. |

The RED run against unmodified main passed only 1/8 initial groups; seven assertions failed. The same initial groups pass after the fix. Final review added a distinct Postgres microsecond-cursor RED (15/16 before correction): Date.parse alone collapsed distinct source times. Coverage comparisons now preserve submillisecond fractions, including offset timestamps, on read, fold and pre-insert recheck. The final dedicated script has 16 groups; all are inert actual-module tests, not network calls. `scripts/verify-chat-summary.mts` remains unchanged, retaining its five existing groups and its disabled/batching/redaction/owner controls. `package.json` adds the new script without removing existing commands.

## Architecture and boundaries

Existing `memories` JSON state, Mercury synthesis, `MIN_NEW_MESSAGES=6`, `VERBATIM_WINDOW=20`, `MAX_OLDER=40`, 600-token synthesis limit and the current `process-message.ts` assembly/scheduling remain. No model provider, new memory service, table, migration, router, runtime, gateway or UI is introduced. The new source cursor selection is independent of database insertion timing. Its guarantee relies on ordinary committed-read visibility and unique immutable row IDs; transaction-level behavior has not been exercised against production or a local Postgres instance in this slice.

The 100-row cap is a deliberate availability tradeoff: a heavily accumulated/broken owner history is withheld and refresh fails visibly in logs. This patch does not automatically repair such a backlog. Invalid/future cursors are ignored (one minute of clock skew allowed); invalid matching rows are not destructively removed. No production cleanup is authorized by this report.

## Still open in gate 6

- This remains a bounded prose synopsis. There are no claim-level source IDs, revisions, deterministic semantic supersession, per-claim expiry or sensitivity/permission labels.
- Timestamp/role prompt instructions are guidance, not protection against a model inventing or dropping a fact. An assistant's provider outcome still requires the existing typed record/read-back; summary text is no authority to execute.
- The existing recent-40 older-message window can skip a backlog if ingestion outpaces refresh; this patch does not invent coverage for omitted messages. Equal timestamps still use the existing timestamp-only fold cursor. A future durable cursor should include a message ID and explicit contiguous coverage.
- Explicit user corrections inside the last 20 messages still outrank summaries through the existing prompt. Semantic correction survival across repeated model compactions needs grounded structured-claim fixtures and evaluation, not an inert model stub returning the expected words.
- Vault secrets, saved preferences, documents and provider records stay authoritative and unchanged. Enterprise memory scopes in `docs/architecture/07-memory-scopes.md` remain a separate plan.

## Verification and continuation

Run `scripts/verify-summary-durability.mts`, original `scripts/verify-chat-summary.mts`, all registered regression commands, typecheck and normal production build with CI placeholder credentials. Record exact uploaded SHA/results in the PR and issue #274. A passing local suite or CI does not establish real WhatsApp/dashboard or repeated-model acceptance.

Other active Core V2 work owns runtime/notifier/browser/gateway files. This slice deliberately leaves them and Claude's feature/UI work untouched. #735 now includes additional review fixes; #736 needs reconciliation with that advanced base before integration, while #737 has its own independent voice-call safety patch. Preserve all of these changes when preparing the final ten-gate integration.
