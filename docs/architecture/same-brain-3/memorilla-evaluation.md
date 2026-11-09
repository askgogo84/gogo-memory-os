# Memorilla evaluation and hybrid recall

Status: hybrid recall implemented behind `GOGO_HYBRID_RECALL` (off). Memorilla runtime not deployed; recommendation below.
Companion to `00-current-state.md` and `01-procedures-and-trace.md`. Reference: snap-stanford/memorilla (commit
d8f1889, 6 Nov 2026), paper arXiv 2610.21375, results from memory.stanford.edu.

## 1. What Memorilla is (read from the code, not the abstract)

- **Encoder:** every document (one chat, one passage) becomes one pooled vector from Qwen3-Embedding-4B, computed once
  and stored (`memorilla/embeddings.py`, fp16 safetensors shards). Reusable across questions.
- **Memory module** (`memorilla/memory.py`, ~300 lines): 16 slot vectors (learned, or initialised from the documents
  most similar to the question), conditioned on the question by cross-attention, then 2 blocks of cross-attention from
  the slots over **every** document vector in the collection, then a linear projection into the decoder's hidden size.
- **Decoder:** a frozen Qwen3-8B receives those 16 vectors as input embeddings (vLLM `enable_prompt_embeds`,
  `memorilla/vllm.py`). The text prompt never contains the documents.
- **Training:** three stages on ~310 GiB of data, ~19 h on 4×H100, plus per-benchmark fine-tuning for PersonaMem-v2 and
  PV4. Inference: one 80 GB GPU, ~25 GB of weights.
- **Licences:** code Apache-2.0. PersonalizationV4 CC BY 4.0. Each Memorilla-Data config keeps its source licence
  (PersonaMem-v2's is not stated in the repo; check the dataset card).

### Reported results (memory.stanford.edu)

| Benchmark | Full context | Best baseline | Memorilla |
|---|---|---|---|
| PersonaMem-v2 (accuracy) | 27.92 | 30.90 (xRAG) | **44.60** |
| PersonalizationV4 (accuracy) | 59.12 | 67.88 (MemoRAG) | 66.65 |
| FactKG | 80.43 | 80.43 | **84.33** |
| PubMedQA | 67.00 | 69.00 | 59.00 |
| NarrativeQA (ROUGE-L) | 17.99 | 20.51 | 19.31 |

Against top-50 RAG on the same questions: PersonaMem-v2 26.7 → 44.6; PV4 65.8 → 66.6; and the union of the two methods
answers far more than either (PMv2 53.8, PV4 80.4) — the paths are **complementary**, which is the basis for a hybrid.

### Stated limitations that matter for AskGogo

- Loses fine-grained details such as exact names. → our exact path must stay authoritative.
- Needs open decoder weights and a module trained per decoder. → **not compatible with Claude.** There is no API to
  inject vectors into Claude's input layer, so the 16-token interface cannot be used, adapted or approximated with it.
- Qwen encoder + Qwen decoder, text only; other model families untested.
- **No privacy evaluation.** The README's headline example infers "family history of type 2 diabetes" from one indirect
  question among 107 chats and volunteers it in an unrelated breakfast answer. For AskGogo that behaviour is a defect:
  it is a sensitive health inference, never stated by the user, surfaced without being asked.

## 2. What we adapted, and what we did not

| Memorilla idea | AskGogo adaptation | Status |
|---|---|---|
| Reusable per-document embeddings | Already exists: `memory_embeddings` (text-embedding-3-small, 1536-d), `match_memories` RPC, owner-scoped | reused |
| Query-dependent selection over the whole collection | Multi-probe recall: the question + up to 2 entity labels from the graph + one domain facet, each probed, aggregated per memory, then MMR so a fixed budget spans the collection instead of near-duplicates | implemented |
| Fixed memory budget regardless of collection size | ≤ 6 items / 900 chars per decision, independent of how many memories exist (pinned with 2,000 docs) | implemented |
| Trained memory slots / latent tokens | Not adopted. Requires open weights and a GPU service; Claude cannot consume them | rejected for production |
| Agent learning from its own history (TextWorld GRPO) | Already covered more conservatively by Same Brain v2 decision learning (20 samples, 0.82, verified outcomes only). No RL on users | not adopted |
| Implicit trait inference across chats | Allowed only as a labelled **hypothesis** from ≥ 2 non-sensitive memories, never stored, never used to act | implemented with guard |

## 3. Hybrid retrieval design (implemented)

```
question ─┬─ exact path ── semantic graph neighbourhood (verified / reported / inferred, provenance) ──┐
          │                                                                                        ├─ merge ─ bounded pack
          └─ recall path ─ probes ─ owner-scoped vector search ─ scope re-check ─ stale (graph) ────┘
                                                               ─ sensitive guard ─ exact-dedupe ─ MMR ─ budget
```

Files: `lib/agent/context-graph/recall.ts` (path), `build.ts` (merge + render + flag), `types.ts` (`pack.recall`),
`lib/agent/brain.ts` (shadow log counts only, never text).

Rules, each pinned in `scripts/verify-hybrid-recall-nov9.mts`:

1. **Exact wins.** Recall items duplicating a graph assertion, a pack fact or an exact source ref are dropped.
2. **Provenance labels.** Every recall item is `evidenceClass: reported` (the owner said it), `relevance: inferred`,
   `mayAuthorize: false`. The prompt says "related, not verified. Do not act on them alone".
3. **Corrections.** A memory whose graph assertions were all superseded/retracted (`staleRefsFromGraph`, one owner-scoped
   query) is not recalled. The current fact comes from the exact path.
4. **Sensitive guard.** Health, finances, religion, politics, sexuality, caste, immigration and legal memories are
   never recalled into an unrelated question. If the question is about that category, only the owner's own words are
   shown, and no hypothesis is drawn from sensitive items.
5. **Tenant isolation, twice.** The index is queried with the verified actor's id; every returned row's scope is then
   re-checked and foreign rows dropped (defence against an upstream scope bug — the current path has no second check).
6. **Actions.** Recall never reaches `executeGuard`, approvals or procedures. Consequential objectives keep
   `approvalRequired` whatever recall says.
7. **Flag.** `GOGO_HYBRID_RECALL=shadow|on`, `GOGO_HYBRID_RECALL_OWNERS=<ids>`. Shadow logs counts in
   `CONTEXT_GRAPH_SHADOW.recall`; only `on` puts recalled lines in the prompt. Needs `GOGO_CONTEXT_GRAPH` on/shadow.

## 4. Evaluation

### 4a. AskGogo synthetic fixtures (`scripts/fixtures/hybrid-recall/askgogo-synthetic.json`)

Two tenants (Divya, Nithin), 23 memories, 5 exact facts, 2 corrections, 18 cases over the ten required categories.
Run: `npx tsx scripts/eval-hybrid-recall.mts`.

| Category | Cases | Current | Hybrid |
|---|---|---|---|
| preference | 2 | 0 | 2 |
| multi_conversation | 2 | 2 | 2 |
| multi_hop | 2 | 2 | 2 |
| task_continuation | 2 | 1 | 2 |
| corrections | 2 | 0 | 2 |
| exact_fact | 2 | 2 | 2 |
| sensitive | 2 | 1 | 2 |
| sensitive_allowed | 1 | 1 | 1 |
| tenant_isolation | 2 | 0 | 2 |
| action_boundary | 1 | 1 | 1 |
| **All** | **18** | **10** | **18** |

| Metric | Current | Hybrid |
|---|---|---|
| Required evidence missing | 0 | 0 |
| Forbidden items in context (stale, sensitive, other tenant) | 9 | 0 |
| Context tokens per question (exact + recall) | 66 | 65 |
| Retrieval pipeline time, offline | 0.26 ms | 1.02 ms |
| Embedding calls per question | 1 | 2.17 |

**How to read this honestly.**
- Every current-path failure is a **leak**, not a miss: the superseded address and the old PNR (corrections), the
  diabetes clue and thyroid medication in a breakfast question (sensitive), the other tenant's memories under a scope
  fault (isolation). The gain on these fixtures is safety, not recall.
- The offline embedder is a deterministic token + concept hash (`scripts/lib/hybrid-recall-eval.mts`). It measures the
  pipeline, not embedding quality. Recall gains of the Memorilla kind (implicit preferences across many chats) need real
  embeddings and the research benchmarks (4c).
- I wrote both the fixtures and the system. One bug was found and fixed during evaluation (the finance pattern matched
  "headphones finally broke"), which is a real false positive, not fixture tuning. A blind held-out set written by a
  separate agent is in 4b.

### 4b. Blind held-out set

See the section appended after the held-out run (written without access to the code or the fixtures above).

### 4c. Research benchmarks (prepared, not run here)

`scripts/eval-memorilla-benchmarks.mts` runs current top-5 vs hybrid on PersonaMem-v2 or PV4 rows exported with
Memorilla's own loader, a Claude answerer (`claude-haiku-5-5` by default) and Memorilla's scoring rule (nearest of the
candidate answers under an embedding model). It refuses to run without `EVAL_ALLOW_NETWORK=1`, `--license-checked`, and
a data file outside the repository. Not run: this sandbox cannot reach OpenAI, Anthropic or Hugging Face.

Suggested first run: PV4 hard subset (629 questions), ≈ 1,300 Haiku calls and ≈ 3,000 embedding calls. Results will not
be directly comparable with Memorilla's numbers (different answerer) and must not be presented as such.

### 4d. Token cost and latency in production

- Embeddings: hybrid makes up to 4 embedding calls (probes) instead of 1, issued in parallel. text-embedding-3-small on
  probes of < 100 tokens costs a fraction of a paisa per turn; added wall time ≈ one embedding round-trip, inside the
  900 ms recall timeout that already bounds it.
- One extra owner-scoped query for corrections (`semantic_sources` + `semantic_assertions`), only when there are hits.
- Prompt tokens: bounded at 900 chars of recall (≈ 225 tokens), and only in `on` mode.
- Memorilla runtime, for comparison: a dedicated 80 GB GPU (H100 class) per serving replica plus a second model family
  in the request path.

## 5. Security and privacy review

| Risk | Control | Test |
|---|---|---|
| Sensitive inference surfaced in an unrelated answer (Memorilla demo) | category guard; no hypotheses from sensitive items | `sens-1`, `sens-2`, pin 1 |
| Over-blocking the owner's own sensitive question | allowed when the question is about that category, own words only | `sens-3` |
| Cross-tenant recall | actor-scoped query + per-row scope re-check | `tenant-1/2`, pin 2 |
| Stale or corrected facts resurfacing | graph supersession check | `stale-1/2`, pin 4 |
| Recall used as authority for an action | `mayAuthorize: false`; approvals/procedures never read recall; prompt warning | `act-1`, pin 5 |
| Prompt growth / cost | fixed item and char budget | pin 3 |
| Logging personal text | shadow log carries counts only | brain.ts log line |
| Keyword guard misses paraphrased sensitive text | known limitation: regex categories catch explicit wording, not every paraphrase; the guard reduces, not eliminates, the risk; prompt still labels everything "not verified" | future: classifier |
| Memorilla runtime | weights and embeddings of user chats would sit in a GPU service outside Supabase RLS; no deletion story beyond "can be deleted on request"; no privacy evaluation published | not deployed |

## 6. Recommendation on the Memorilla runtime

**Do not deploy, not even experimentally, yet.** Reasons, in order:

1. It cannot serve Claude. A sidecar would mean answering personalization questions with Qwen3-8B instead of the
   AskGogo brain — a model replacement, not a memory upgrade, which the directive rules out.
2. Its demonstrated strength (implicit trait inference) is the behaviour our privacy rules restrict most.
3. Operational cost: a dedicated GPU service, a second model family, a new data store for user-chat embeddings outside
   RLS, and per-decoder training.

Revisit only if, after the hybrid has run in shadow and the PV4/PMv2 runner has produced numbers, there is a measured
gap of at least ~10 points on non-sensitive personalization that the hybrid cannot close — and then as an offline,
synthetic-data-only evaluation on a separate GPU host, never on live user data and never in the Vercel path.

## 7. Implemented / evaluated / future work

**Implemented:** `recall.ts` (probes, owner-scoped index over `match_memories`, scope re-check, sensitive guard, stale
suppression, exact dedupe, MMR, fixed budget, labelled hypotheses); pack wiring with `off|shadow|on` flag; shadow
counts in the brain log; fixtures; offline harness; live benchmark runner; CI pin (6 groups).

**Evaluated:** Memorilla code and published results; AskGogo synthetic fixtures (18 cases, 10 categories); blind
held-out set (§4b); cost and latency model.

**Future work:** run the PV4/PMv2 runner with real embeddings; replace the keyword sensitive guard with a small
classifier evaluated on a labelled set; add conversation summaries (not just memories) to `memory_embeddings` so
multi-conversation recall has more to draw on; per-workspace recall for enterprise Spaces (scope `workspace`), which
this PR deliberately does not enable.

## Enable order (owner, after merge)

1. Vercel → `GOGO_HYBRID_RECALL=shadow`, `GOGO_HYBRID_RECALL_OWNERS=-884501501`, redeploy (needs `GOGO_CONTEXT_GRAPH`
   already shadow/on). Logs: `CONTEXT_GRAPH_SHADOW` gains a `recall` object with item, dropped and probe counts.
2. After a day of shadow logs: `GOGO_HYBRID_RECALL=on` together with `GOGO_CONTEXT_GRAPH=on`.
