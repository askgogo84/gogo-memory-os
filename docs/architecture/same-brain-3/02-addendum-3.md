# Same Brain 3.0, Addendum 3 (10 Nov 2026): model router, durable workers, voice

Status of this document: sprint items 1 and 2 (audit; Muse Ember adapter and shadow harness). Nothing here is switched on.

## 1. Meta Muse Ember: what is verified and what is not

Verified on 10 Nov 2026 from Meta's own pages (research.meta.ai/blog/muse-ember, dev.meta.ai/docs):

| Item | Value |
|---|---|
| Model id | `muse-ember-1.0` |
| API | Meta Model API, base `https://api.meta.ai/v1`, `Authorization: Bearer <key>`; chat completions, responses and messages endpoints |
| Price per million tokens (prompt up to 200K) | input 0.10 USD, cached input 0.004 USD, output 0.50 USD |
| Price over 200K input tokens | input 0.30, cached 0.012, output 1.50 USD |
| Context / max output | 1,048,576 / 524,288 tokens |
| Tool calling, structured output | listed as supported |
| Reasoning effort | `minimal` to `max`; the default is `max` |

Not verified (not stated on those pages): data retention and whether API inputs train models; rate limits; GA or
preview status; the exact reasoning parameter name on chat completions; `tool_choice` options; usage field names.
Until the data terms are confirmed in writing, the candidate may receive only committed synthetic fixtures or public
text. No owner data.

For comparison, the models AskGogo calls today: Claude Haiku 4.5 (1 / 5 USD per million) and Claude Sonnet 4.5
(3 / 15 USD). The token price is 10x lower than Haiku. That is not yet a lower cost per completed task: the default
reasoning effort is `max`, output tokens include reasoning, and a wrong answer that escalates costs both calls.

## 2. What already existed (before this addendum)

- `lib/inference/adapter.ts`: provider adapter contract, data-policy registry checks, task classes, a router that
  refuses personal data for cheap providers, fallback, prompt compression.
- `lib/inference/cheap.ts`: Groq and Gemini adapters for public work. `minimax-eval.ts`, `minimax-gateway-eval.ts`,
  `openrouter-gateway.ts`: evaluation-only adapters with a circuit breaker.
- `lib/agent/brain.ts`: `GOGO_BRAIN_MODEL`, `GOGO_BRAIN_SHADOW` (Haiku 5.5 shadows every production decision and logs
  `BRAIN_SHADOW` agreement, latency and cost), `MODEL_PRICES`.
- `lib/services/model-ids.ts`: one place for Sonnet/Haiku ids.
- Autonomous runtime (`lib/agent/autonomous-runtime.ts`, `run-cancel.ts`, `app/api/cron/autonomous-runs`): durable
  runs and steps in Postgres, attempt-fenced step claims, dependency ordering, lanes, retry with backoff, approval
  release, stale-step recovery, unknown-outcome state that is never replayed, user cancel that later waves cannot
  undo, cron-driven resume. Procedures (`lib/procedures/*`) run on it.

## 3. What this change adds (draft PR, all off)

- `lib/inference/muse-ember-eval.ts`: evaluation-only adapter. Not registered in `cheapProviders()`, refuses
  production, needs explicit opt-in plus an approved data policy, takes only `public_web_research` and
  `safe_classification`, refuses personal data, bounded output, `reasoning_effort: low`.
- `lib/inference/task-routing.ts`: routing policy for eight task kinds. Default `off` = today's models. In `shadow`
  mode (`GOGO_MODEL_ROUTER=shadow`) a candidate may be measured, never answer. Unknown, consequential, sensitive and
  retry-after-failure tasks always go to the strong model. Owner data reaches a candidate only with approved terms.
- `scripts/lib/model-shadow-eval.mts`, `scripts/eval-model-shadow.mts`: 130 synthetic cases (105 representative, 17
  adversarial, 8 failure) across intent classification, reminder parsing, email classification, memory extraction,
  summarisation and light tool decisions; exact scoring; accuracy, p50/p95 latency, cost, and cost per correct answer
  for candidate and baseline.
- `scripts/verify-muse-ember-eval-nov10.mts`: 42 checks.

## 4. Benchmark results

None yet. The evaluation makes paid calls and needs a Meta Model API key and a read of Meta's data terms; neither is
available to the build session. To run (Claude Code, repo root, never on production):

```
EVAL_ALLOW_NETWORK=1 MODEL_API_KEY=<meta key> ANTHROPIC_API_KEY=<key> npx tsx scripts/eval-model-shadow.mts --terms-checked
```

Promotion bar proposed for any task family: candidate accuracy within 2 points of baseline, zero adversarial failures
that the baseline passes, and lower cost per correct answer. Then a live shadow on synthetic-equivalent traffic.

## 5. DeepSeek dsh-superagent principles against the existing runtime

First-pass audit from reading the runtime's exports and cron routes; each gap is re-checked in code before its PR.

| Principle | AskGogo today | Gap |
|---|---|---|
| Single entry point for state changes | `autonomous-runtime` functions, owner-scoped writes | none found |
| Durable queue and execution records | `agent_runs`, `agent_steps`, activity log | none found |
| Isolated bounded workers | per-run waves, `maxParallel`, lanes, 12-wave cap | no per-owner concurrency cap across runs |
| Lease-aware ownership | attempt-fenced `claimStep` | no time-based lease expiry on a claimed step other than stale recovery |
| Retry and timeout | per-step retry with backoff; procedure node retry budgets | deterministic failures were retried (fixed for procedures in #1457) |
| Crash recovery and watchdog | `recoverStaleAutonomousSteps`, cron resume every minute | `agent-learning` cron times out at 60 s; no health signal after N consecutive failures of one kind |
| Idempotency, unknown outcome | `outcome_unknown` never replayed; approval binding | no general event inbox with a dedupe key for inbound triggers |
| Event-driven activation | cron polling; approval route resumes a procedure | no domain events (`run.ended`, `approval.granted`) with durable effects |
| Dependencies and cancellation | `dependsOn`, user cancel is terminal | cancel does not stop an in-flight provider call |
| Verification | provider read-back for Gmail/Calendar/browser | cab booking has no verified executor (stays fail-closed) |

Next narrow PRs, in order: (a) effects/event inbox table with dedupe key and after-commit dispatch (migration, owner
runs it); (b) health entry after three consecutive failures per effect kind, surfaced in ops alerts; (c) per-owner
worker slots; (d) fix the `agent-learning` timeout. Each with tests for duplicate events, a crashed worker, a provider
timeout, a stale approval and concurrent tasks. No second runtime.

## 6. AgentRing-style calling (next sprint, design only)

AgentRing (Apache-2.0, pre-release, Android only, one tested device) uses a relay, self-hosted LiveKit for audio, FCM
to ring a locked phone, and a realtime voice model. For AskGogo: a `VoiceSessionAdapter` interface (start, join,
transcript events, end) so Android, Windows and TV can use different transports over the same Same Brain context and
task state. Rules carried over: a voice session never approves a consequential action by voice alone (it creates the
same bound approval card); app-to-app VoIP only, not cellular; WhatsApp/Twilio unchanged; recordings off unless the
owner turns them on; half-duplex or echo cancellation required before any desktop reuse. Behind a flag, Android first.

## 7. REA and BLA

Assessment only, later, for AskGogo-owned client apps. Nothing in the server runtime. Not on the release path.
