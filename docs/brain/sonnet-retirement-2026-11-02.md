# Sonnet 4.5 retirement migration

Coordination: #274; baseline `16e99ab881060867ebf857babd4d963fe84f3213`. This is a proposed migration, not a production release or live acceptance report.

## Decision and comparison

Use native `claude-sonnet-5-5` for the existing Sonnet workloads. Keep the current Haiku workloads unchanged. Use active `claude-sonnet-4-6` only when the ticket-image primary returns HTTP 404; invalid requests, authentication failures and refusals do not trigger this model fallback. Existing SDK transport retries and other provider fallbacks are unchanged.

Official prices checked 2 November 2026; USD per million tokens:

| Model | Input / output | 5m cache write / read | Provider latency description | Migration assessment |
| --- | --- | --- | --- | --- |
| Sonnet 5.5 | 2 / 10 | 2.50 / 0.10 | Fast | Recommended native replacement; current default; no live AskGogo quality or latency benchmark yet |
| Sonnet 4.6 | 3 / 15 | 3.75 / 0.30 | No measured AskGogo comparison | Active legacy alternative; limited document fallback; retirement not sooner than 17 February 2027 |
| Haiku 5.5, <=100k prompt tokens | 0.10 / 0.50 | 0.125 / 0.01 | Fastest | Candidate for cheaper routing after a labelled evaluation; not promoted by this PR |
| Haiku 5.5, >100k prompt tokens | 0.50 / 2.50 | 0.625 / 0.05 | Fastest | Higher tier must be included in any large-context benchmark |
| Sonnet 4.5 (historical only) | 3 / 15 | 3.75 / 0.30 | Not a sustainable availability choice | Deprecated; native API retires 30 November 2026 |

At equal usage of 5,000 uncached input + 150 output tokens, Sonnet 5.5 costs $0.01150, compared with historical Sonnet 4.5 / active 4.6 at $0.01725 (33.3% lower). Haiku 5.5 at the lower tier costs $0.000575. These are arithmetic estimates, not per-success measurements. Sonnet 5.5's newer tokenizer can use about 30% more tokens for the same text; images can cost more too. At exactly 1.3x text tokens the 5.5 estimate is $0.01495 (13.3% lower). Do not promise a 33% bill reduction. Haiku's historic booking rehearsal note records worse task completion than Haiku 4.5; low price alone does not justify replacing action routing.

Reliability evidence in this PR is synthetic request compatibility, regression behavior and build/CI. Provider descriptions are not measured p50/p95 or real-world success rates. Keep Sonnet-class capability for existing workloads while the canary evaluates quality. No availability claim for this account can be established from public model status alone.

Sources:
- https://platform.claude.com/docs/en/about-claude/model-deprecations
- https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide
- https://platform.claude.com/docs/en/models/sonnet-4-6/overview
- https://platform.claude.com/docs/en/models/haiku-5-5/overview

## Runtime audit and changes

| Path | Audited call sites / configuration | Result |
| --- | --- | --- |
| `lib/agent/brain.ts` | Default, explicit decide model, GOGO_BRAIN_MODEL, followup model, GOGO_BRAIN_SHADOW, pricing | 5.5 default; stale 4.5 alias and dated overrides resolve to 5.5; only reviewed models allowed; retired/unknown shadows excluded; legacy price retained solely for historical accounting; 4.6 accounting added |
| `lib/services/claude.ts` | Freeform, live flight status, web synthesis | Shared 5.5 options and block-type text extraction; Mercury/OpenAI routing and safety prompts preserved |
| `lib/services/voice-reply.ts` | Podcast content generation | Shared 5.5 options; text extracted after possible thinking blocks; no audio provider change |
| `lib/services/asset-memory.ts` | Document/image classification and extraction | Shared 5.5 options and block-type parsing; storage/privacy/owner behavior unchanged |
| `lib/agent/deep-research.ts` | Synthesis and shared default model caller | 5.5 synthesis; removed sampling parameter incompatible with 5.5; query-planning Haiku and cheap public providers retained |
| `lib/services/pdf-reader.ts` | PDF ticket, PDF summary, image ticket primary/fallback | 5.5 primary; supported 4.6 on image model-404 only; native document/image payloads preserved; Haiku classification/local PDF parsing retained |
| `lib/services/pdf-reader-whatsapp.ts` | Alias wrapper and local fallback | Delegates to migrated reader; no model literal or edit needed |
| `lib/agent/planner-provider.ts` / `booking-rehearsal.ts` | Async scoped dynamic planner model | Defaults and sole runtime override caller use Haiku 4.5; no Sonnet 4.5 route found; no edit |
| Remaining `lib/` + `app/` | All Claude literals, SDK calls and direct HTTP payloads | Haiku 4.5 alias/datestamp remains in classification, translation, mail, browser planning, memory, web search, voice-call and other helpers; not the retiring Sonnet model |
| Other provider configuration | OPENAI_FALLBACK_MODEL, GROQ_MODEL, GEMINI_MODEL, OPENROUTER_MODEL, GOGO_IMAGE_MODEL, GOGO_TTS_MODEL | Separate provider endpoints, not native Claude Sonnet defaults; unchanged |
| Scripts/config/tests/docs | Repository-wide retired-ID scan; relevant assertions; no checked-in retired environment default found | Mercury source assertion and brain auto-tool assertion updated; historical family/cost fixtures retained; current brain README corrected |

Eleven runtime retired-model literals were removed/replaced; the only exact quoted retired ID remaining in runtime source is historical `MODEL_PRICES`. The shared resolver also recognizes deprecated names in a regex to prevent override reintroduction. The test audits `lib/` and `app/` for new retired literals and intercepts all fetches when exercising the real SDK.

## Request compatibility and safety

- 5.5 uses `thinking: {type:'between_tools'}` plus `output_config.effort:'low'` to preserve the small existing one-shot output budgets and latency intent. It rejects `thinking:disabled`; no old enabled budget, sampling parameter or assistant prefill is introduced.
- SDK 0.90's type union predates `between_tools`. A single documented narrow cast in the shared helper supplies that wire value without upgrading dependencies. The test inspects the serialized request, not just the helper's return value.
- Forced tool choices are removed. Brain tools use `auto`, strict schemas and `additionalProperties:false`. Existing prompt requires one tool. No tool / refusal / truncated or non-tool completion becomes `skip` and falls back to the existing deterministic pipeline; followups do not send an unvalidated freeform answer. There is no forced retry to defeat a refusal.
- Text consumers select blocks by type, so leading thinking blocks cannot hide the actual answer. Refusal/truncated completions produce no completed answer/extraction.
- Brain consent/negation, invented-action guards, owner predicates, approvals, provider verification, idempotency, unknown-outcome handling, canary allowlist and kill switch remain in place. This PR makes no real sends, booking/payment, schema, account, credential or environment change.
- Existing `GOGO_BRAIN_MODEL` accepts 5.5, 4.6, Haiku 4.5 and Haiku 5.5 only. Unsupported settings fail closed to the existing pipeline. `GOGO_BRAIN_SHADOW` keeps its production Haiku default and drops retired/unknown entries. Runtime production values were not read or modified; operators must inspect them before release.

## Verification and release gates

Focused test: `npx --yes tsx scripts/verify-sonnet-retirement.mts`. It executes real SDK serialization with fictional data and sealed fetches across brain, all three chat paths, native PDFs, ticket-image fallback, asset classification, voice script generation and research. It checks retired overrides, refusal/truncation, allowed shadows, consent and unexpected network rejection. Voice audio/storage is deliberately not invoked. Run the existing `verify-brain-oct27.mts` safety tests too.

Dedicated `Sonnet retirement literal head` workflow checks out `pull_request.head.sha`, asserts it, installs the lockfile, runs both focused suites, full registered `npm test`, Next typegen, typecheck and production build with fixture credentials. Ordinary PR CI remains separate. Finished runs and SHA are recorded in the PR/#274 rather than claiming an unobserved result here.

Local `tsx` CLI hits an environment IPC socket restriction; use the same tsx loader with `node --import` to run the registered entry points locally. This does not replace native `npm test` on the hosted literal-head job.

Before a production recommendation: independent code/behavior review; completed exact-final-head CI; account-specific model availability; non-side-effect provider canary using synthetic prompts for conversation/pronouns, explicit negation, approval-like replies, ambiguous dates, document/image parsing, asset extraction, voice JSON and research synthesis. Compare 5.5 low/medium and the supported alternative on the same fixed prompts. Record request count, failures/timeouts/refusals/truncation/no-tool, p50/p95, actual input/output/cache usage, billed cost and manually labelled correctness. Retain the 12-second no-retry brain budget; do not relax safety to improve completion rates. Hosted WhatsApp/owner-bound context and document integration acceptance remain separate gates with normal approvals.

Deploy only after coordination and the existing release approvals. Inspect production GOGO_BRAIN_MODEL/SHADOW and verify the deployed SHA. Rollback must use a reviewed supported-model configuration or correction: blindly reverting this migration after November 30 would restore an unavailable model. `GOGO_BRAIN=off` remains a brain-only kill switch, not a rollback for direct Claude document/chat calls. No deployment is recommended merely because mocked tests pass.
