# Jev audit and generative-UI evaluation (Part 1: audit)

Branch: research/jev-generative-ui. Read-only audit. Nothing merged or deployed.
Date: 14 Oct 2026. Source article: https://thenewstack.io/workday-is-using-typesafes-jev-to-build-user-interfaces-on-the-fly/

## What the article actually says (via a summarising fetch; verify before quoting)
- Workday Sana does not let an LLM draw each screen. Jev classifies the request and picks from Workday's existing design-system components. Jev returns a choice (up to 255 options), a score or yes/no, each with a probability, never text.
- Claimed: 70 to 500 ms; 175 ms median on OpenRouter's Banking77 set; 81% accuracy vs 84.4% for Claude Opus 5 (about 22x the cost, 2.3 s); a partner test (synthetic data) cut median dashboard render from 29 s to 3.8 s.
- Fallback in that partner setup: Jev answer under 50% confidence goes to a language model. Workday's own fallback is not described.
- TypeSafe docs: weak at counting, arithmetic and dates; favours the first listed option; does not treat injected content as hostile. Hosted API only, processed in the US.
- The article says nothing about how Workday enforces permissions or verifies execution.
These are vendor and third-party numbers. None are AskGogo measurements.

## 1. Where Jev is used in AskGogo today
| Place | What it does | Authority |
|---|---|---|
| lib/typesafe/jev-shadow.ts, called from lib/agent/shadow-brain.ts `observeShadowBrainTurn` | One call per turn asks 4 typed questions (intent: 17 options, action mode, attention state, readiness) plus referent when the turn looks contextual. Skipped for deterministic reads (Gmail verification, autonomy status, "show my watchers"). Timeout 900 ms. Awaited before routing. | Observation |
| lib/agent/semantic-gate.ts | A keyword rule may not claim a message when Jev is at least 0.8 confident the sentence belongs to a different capability. Fails open on no result, low confidence, "general_reasoning"/"other", exact commands, under 3 words. | Can only block |
| lib/agent/jev-router.ts `promotedJevIntent` | Intent in an 11-item allowlist at 0.9 or more, not blocked by readiness=clarify at 0.7 or more, referent checks. Gives a specialist first refusal. Writes `jev_routing_hint_used` with `execution_authority:false`. | First refusal only |
| jev-router `jevClarificationReply` | For contextual turns, readiness=clarify at 0.9 or more asks which item the user means. | Asks a question |
| lib/agent/open-loops.ts | attention_state=completed at 0.93 or more auto-resolves an open loop; other states capture one. | Writes private state |
| lib/services/link-vault.ts `jevShelf` | Picks a shelf (reference, inspiration, tool, product, social) for a saved link. 650 ms timeout, 0.55 minimum. | Classification |
| lib/agent/shadow-router-outcome.ts | Telemetry of what Jev said against what handled the turn. | None |

Safety properties confirmed in code: secret-shaped text is withheld or redacted before the call; rejected learning hints are never sent; Jev output never grants execution; the call fails open; approval and verified execution stay in deterministic code. Tests: verify-brain-jev-release, verify-jev-clarification-guard, verify-semantic-routing, verify-jev-email-routing, verify-jev-private-state-routing, plus shadow-brain tests. Full suite passed on main at 6f75ccc.

## 2. Production sample (Vercel runtime logs, `SEMANTIC_READING`, last 3 days)
53 readings (32 WhatsApp, 21 dashboard). Mostly the owner's own test traffic and travel-heavy (17 travel_research), so not representative of real users.
- ok: 53 of 53. No timeouts, HTTP errors or malformed responses in the sample.
- Latency (ms, measured from our server): p50 289, p95 334, min 270, max 349, mean 295. Dashboard p50 286. This is the call time added to the turn, because it is awaited before routing.
- Intent confidence at 0.9 or more: 31 of 53 (58%). Below 0.7: 13 of 53.
- 28 readings pass the intent part of the promotion rule (promotable intent, 0.9 or more). 14 of those carry readiness=clarify. Overall readiness=clarify on 34 of 53 (64%), including clear requests such as email_read at 1.0 and reminder_read at 0.73. The log does not record readiness confidence, so how many actually blocked (clarify at 0.7 or more) is not known.
- Accuracy: not measurable from logs. They hold no message text and no ground truth. Token usage and cost: not in logs.

## 3. Gaps found
1. Dashboard and WhatsApp differ. The dashboard chat route passes Jev to `routeFeatureIntent` and `processIncomingMessage` (so the gate applies) but never calls `promotedJevIntent`, `recordJevRoutingHint` or `jevClarificationReply`. Only WhatsApp gets first-refusal promotion and the clarification guard.
2. Jev runs serially before routing on every non-deterministic turn: about 0.3 s added to every message, including ones a deterministic rule then answers. Could start in parallel with the cheap deterministic checks.
3. Telemetry is too thin to evaluate: no readiness confidence, no referent confidence, no probabilities, no correction label in `SEMANTIC_READING`.
4. Readiness looks over-eager (64% clarify). Unverified whether it hurts; needs labels.
5. Jev adds a call per turn; it replaces no LLM call today. Cost per LLM call avoided is therefore zero so far. Where typed decisions could replace LLM calls is not measured.
6. Not verified: what `recentConversation()` can contain. Up to 700 characters of it go to TypeSafe. If assistant replies containing email text are included, then email content reaches Jev, which the docs say does not treat injected text as hostile.
7. Data handling: user text and recent context are sent to a US-hosted vendor. Needs a decision against DPDP expectations and your privacy policy.
8. Admin report at /api/admin/shadow-brain needs an admin session; not called here.

## 4. Component registry: what exists
There is no registry. The only UI-selection mechanism is `lib/agent/flight-choices.ts` `flightChoiceFromText`: it matches Gogo's own fixed question sentences exactly and returns the matching option set. WhatsApp turns it into buttons and the dashboard (components/dashboard/gogo-chat.tsx) into chips. That is deterministic, needs no model, and cannot be triggered by user text. Any registry should keep this rule: when the server wrote the question, the server picks the component. Jev is only useful where the component depends on the meaning of what the user typed.

## 5. Not done in this pass (needs decisions or access)
- Hosted-vs-self-hosted comparison: Jev appears hosted-only, so the comparison is Jev vs a small open model. Needs a labelled set of at least 150 sanitised messages and a choice of model.
- Cost per 1,000 decisions: needs token usage from agent_activity (query supplied separately) and TypeSafe pricing, which I do not have.
- Accuracy, fallback behaviour under failure injection.
