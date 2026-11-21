# AskGogo × Sarvam provider integration (17 Nov 2026)

**Status:** implemented behind OFF-by-default flags on the isolated `feat/sarvam-models-voice-prism-nov17` branch. NOT deployed and NOT accepted for production. The current AskGogo models remain primary unless operators explicitly opt in. Neither live credential tests nor tenant-data processing approvals have been performed.

## Implemented

| Surface | Gate | Model / endpoint | Rollback |
|---|---|---|---|
| Context-first Brain (already on owner canary only) | `GOGO_SARVAM_BRAIN=on` | `sarvam-105b`, `/v1/chat/completions`, exactly one required function call | `off`; Anthropic fallback |
| General conversational replies | `GOGO_SARVAM_DIALOGUE=on` | `sarvam-105b-conversations`, `/v1/chat/completions` | `off`; Claude/OpenAI fallback |
| Planner text (NOT screenshot/vision planner) | `GOGO_SARVAM_PLANNER=on` | `sarvam-105b`, `/v1/chat/completions` | `off`; Anthropic/OpenAI fallback |
| Web answer synthesis after provider search | `GOGO_SARVAM_WEB_ANSWER=on` | `sarvam-105b`, `/v1/chat/completions` | `off`; Mercury/Anthropic/OpenAI fallback |
| Optional intent observation | `GOGO_SARVAM_PRISM_SHADOW=on` | `sarvam-prism`, `/v2/systemone` | `off`; no decision authority ever |
| WhatsApp and Telegram voice-note transcription | `GOGO_SARVAM_STT=on` | `saaras:v4`, `/speech-to-text` | `off`; current OpenAI fallback |
| WhatsApp voice replies and dashboard Listen | `GOGO_SARVAM_TTS=on` | `bulbul:v3` (default), `/text-to-speech` | `off`; OpenAI fallback |

Required secret: `SARVAM_API_KEY` must be installed only in provider environment variables, never in Git. All Sarvam flags default OFF. **Production has an additional gate: `GOGO_SARVAM_PRODUCTION=approved`; without it, all Sarvam routes remain disabled even if a component flag is accidentally on.** Optional `GOGO_SARVAM_TTS_MODEL=bulbul:v4-flash` selects the newer TTS family, but v4 speaker personas are different from v3 and must be evaluated per language.

## Safety and limits

- The Brain is still limited to AskGogo's existing `GOGO_BRAIN_USERS` owner canary; Sarvam does not bypass exact commands, approval cards, payment checks, Sentinel, auth, owner binding or deterministic execution. Sarvam gets no direct execution authority.
- Prism returns probabilities **only for offline/shadow comparison**. Its predicted label cannot authorize bookings, payments, messages or writes. Shadow calls are currently best-effort telemetry, not persisted decision-learning evidence.
- Provider URL is fixed, credentials are server-side; requests are bounded, no response bodies or raw user prompts are written to provider error logs. No automatic retries are performed for ambiguous outcomes.
- Sarvam-generated tool calls now fail closed if arguments are missing, unknown, mistyped, or oversized relative to the declared tool schema. The model cannot authorize actions through extra JSON keys. Regression cases also reject a tool call when `toolChoice=none`.
- Sarvam STT synchronous REST is designed for audio up to 30 seconds. Our adapter limits payload to 8 MiB; for longer voice notes, allow existing OpenAI fallback or implement Sarvam Batch/streaming separately after testing. The rate limit and model quality must be measured.
- Saaras v4 defaults to transcription; pilot callers may explicitly select `mode=codemix` when Roman-script brands such as PhonePe should remain in Latin script. This is a request-level choice, not an automatic translation or permission to send extra customer data.
- Sarvam 105B is text-only; screenshot/vision planning remains with Claude/OpenAI. Managed Sarvam telephony/voice-agent deployment is not part of this PR; it requires separate provider provisioning and consent/telephony configuration. Twilio account health and WhatsApp calling remain external blockers.
- Sarvam billing documentation currently differs across pages. The estimate in the adapter uses the higher documented ₹15 input and ₹60 output per million tokens, and ₹4 input for Prism; review real billing before rollout. Cost events with INR are not mislabeled as USD. Voice prices depend on audio, not tokens.
- Evaluate cross-border processing, Sarvam data retention, DPA, sensitive tenant data and enterprise residency before sending customer data to a new model provider.
- OpenAI/Claude fallbacks are preserved, except when those fallback keys are absent, in which case the existing path fails cleanly.

## Verification / rollout

1. `npx tsx scripts/verify-sarvam-integration-nov17.mts` checks mock chat/forced-tool response, invalid calls, Prism labels, audio boundaries, media contract and opt-in wiring. `npm test` runs it from `scripts/tests.d/950-sarvam.list`.
2. Optional key-controlled multilingual synthetic evaluation: `npx tsx scripts/eval-sarvam-askgogo-nov17.mts --live` (add `--baseline` with an Anthropic key). This evaluates model decisions without performing any proposed tool action. The benchmark never draws from private customer records.
3. Run `npm test && npm run typecheck && npm run build` and inspect literal branch-head CI, not only GitHub's synthetic merge SHA. Fix all failures before merging.
4. Obtain an approved provider account/API key and verify no production user traffic is enabled. Use a mock or synthetic test for each model endpoint. Do not paste user data into public demos.
5. Run multilingual gold-set replays: English, Hindi, Kannada, Tamil, Telugu and code-mixing; compare Claude/OpenAI baseline for exact contextual referents, negation, refusal, tool schemas, voice accuracy and p95 latency.
6. Require zero approval bypasses and cross-tenant leakage; score task completion and hallucinations, pronunciation, timeout behavior and total COGS against baseline. Do not count synthetic acceptance as real provider-verified success.
7. On a **separate, explicit production approval**, enable one gate at a time on a small owner canary, starting with STT/TTS then dialogue, Prism shadow, Brain and planner. Observe failures and kill-switch rollback. Do not enable customer rollout automatically.

Official specifications: https://docs.sarvam.ai/api/token-factory/chat-completions · https://docs.sarvam.ai/api-reference/decisions/systemone · https://docs.sarvam.ai/api-reference/text-to-speech/convert · https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/rest-api

Coordination: issue #274. Separate files from Claude's Nov 17 voice-call, reminder, crew and learning leases. No merge or production switch is intended in this PR without CI and acceptance evidence.

## Per-user allowlist (added 21 Nov, PR after #1548)

`GOGO_SARVAM_DIALOGUE`, `GOGO_SARVAM_WEB_ANSWER`, `GOGO_SARVAM_PLANNER`, `GOGO_SARVAM_STT`, `GOGO_SARVAM_TTS` and
`GOGO_SARVAM_PRISM_SHADOW` were global: "on" meant every user. They now also require the person being served to be listed in
`GOGO_SARVAM_USERS`. `GOGO_SARVAM_BRAIN` needs the list too, on top of its own canary.

The list takes `users.telegram_id` values (comma-separated), NOT phone numbers: `GOGO_BRAIN_USERS` takes phones, this list does
not. Copy the id from the person's `users` row or from `cost_events.telegram_id`. A phone number here matches nobody.

- Unset or empty list: the switch reaches nobody, even when it is "on" and production is approved.
- Unknown person (a job with no metering context, such as a cron): the existing provider is used.
- No wildcard. `*` and `all` are ignored.
- Only WhatsApp inbound and dashboard chat set the person served. Telegram voice, the dashboard Listen button and crons have
  no person, so they keep the existing provider even for a listed id. A speech-to-text canary therefore covers WhatsApp voice notes.
- The gate lives in `lib/services/sarvam-gate.ts`; all six call sites import it. It chooses a model only and grants no permission.

Order for a canary, one switch at a time, each with the owner's explicit approval:
1. Set `GOGO_SARVAM_USERS` to the owner's id only.
2. Set `GOGO_SARVAM_PRODUCTION=approved`.
3. Turn on ONE switch. Speech-to-text first; planner last (it also drives the signed-in browser agent).
4. Watch `cost_events` / model usage for provider `sarvam` and the fallback rate before the next switch.
Rollback: remove the switch, or remove the id from the list. No deploy is needed beyond the env change taking effect.
