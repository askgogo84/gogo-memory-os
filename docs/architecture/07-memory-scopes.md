# 07 — Memory scopes, provenance and enterprise isolation (plan)

Status: **plan only**. No code or schema change until the founder approves.
Source of the design: YC's open-source agent harness QM (`yc-software/qm`, MIT; its `docs/memory-records.md`, `docs/memory-providers.md` and `src/memory/*`, read on 20 Oct 2026). We borrow the design, not the code. Any ported code keeps the MIT notice.

## 1. Why
Consumer AskGogo already remembers facts (`memories`, `memory_embeddings`, preferences, documents, life events). Enterprise AskGogo needs four more things:
1. one person's memory never reaches a colleague;
2. company knowledge is shared deliberately;
3. every fact says where it came from and how sensitive it is;
4. edits never silently lose that information.

Consumer AskGogo benefits too. Family groups and shared reminders already exist (`memory_shares`), and so do sensitive documents.

## 2. Target model
**Scopes.** A notebook belongs to one scope:
- `personal:<user>`
- `group:<id>` (family, friends or a team room)
- `org:<id>` (company knowledge)

A conversation may *read* several notebooks. It *writes* only to the scope it is in, unless the user explicitly says "save this for the team".

**Records, not text blobs.** Each fact is a record with these fields:
- `id`
- `text`
- `scope_id`
- `sensitivity`: `ordinary`, `sensitive`, `restricted` or `unknown`
- `source`: the scope, conversation or turn it came from, set by runtime code and never claimed by the model
- `source_unknown`: a flag for when the source can't be established
- `created_by`
- `revision`
- timestamps

A missing or failed sensitivity classification counts as `unknown`, and `unknown` stays narrow.

**Revisions.** A memory edit creates a new revision with a revision check, so concurrent writers can't overwrite each other.
- A whole-notebook rewrite or restore keeps the *strictest* labels of everything it touches.
- Clearing a fact removes it from current recall but not from the audit history.

**One disclosure check.** Recall, search, the understanding context pack and admin views all go through one function. That function answers: may this actor, in this conversation, see this record?
- A record is visible only if the actor still has access to its source scope.
- An `ordinary` personal fact may follow its owner into an internal group they belong to.
- `sensitive` and `restricted` facts appear only where every participant is entitled to the source.
- Lookups fail closed.

**Audience change cuts earlier context.** When someone joins or leaves a group, earlier model history in that group isn't replayed into new turns. Human transcripts stay intact.

**Recall per turn.** This keeps today's approach and tightens it:
- The token budget for memory per turn is capped (QM uses 6,000 characters).
- Facts are ranked by embedding similarity to the message and the last turns.
- If search fails, recent facts are used instead.
- A background indexer handles missing vectors.

**Provider routing (later).** Per scope, the system can read from or write to an external memory provider, for example a company knowledge base, or Supermemory (looked at on 17 Oct). Each provider has its own timeout and fail-open recall, and explicit writes fail visibly.

**Procedures (later).** Remember the steps of tasks that succeeded, such as a repeat booking flow, separately from facts.

## 3. Mapping from today
| Today | Becomes |
|---|---|
| `memories` (per `telegram_id`) | `personal:<user>` records, with `sensitivity=unknown` and `source_unknown=true` for legacy rows. Legacy sources are never guessed. |
| `memory_shares` | `group:<id>` scope membership |
| preferences / rules | `personal` records of kind `preference` |
| documents (sensitive) | stay in `documents`. Memory holds only a pointer and a `restricted` label. |
| context-brain / understanding pack | read through the disclosure check |

## 4. Rollout (each step is its own PR, tested, and behind a flag)
1. Add the new tables (additive migration: `memory_records`, `memory_revisions`) and a write path that also writes `memories`. Reads are unchanged.
2. Backfill legacy rows as `unknown` / `source_unknown`. Compare recall results between old and new in shadow.
3. Switch recall to the disclosure check for personal scope only. Measure recall quality and latency.
4. Add group scope (family/team), the audience-change cutoff and "save for the team".
5. Add org scope and admin views (enterprise).
6. Add optional external providers.

**Gates for each step:**
- Owner binding on every query.
- No fact visible outside its allowed audience (adversarial tests).
- Recall latency within 1.2× of today.
- The backfill is reversible.

## 5. Decisions needed from the founder
- Approve the additive migration (step 1) before any production schema change.
- Whether `unknown` legacy facts may follow a user into family groups. The proposed answer is no, until the user re-confirms them.
