# Inference gateways and free LLM tiers: research report (issue #274)

**Status: desk research plus a synthetic dry-run only. This is not live acceptance.**
No LLM provider or gateway was called, no API keys were created or used, and no production config was changed. Everything below comes from public documentation and web pages read on 24 Oct 2026, plus a local simulation with fake providers (`scripts/verify-inference-policy.mts`). Free-tier limits and terms change often, so re-check every number marked "verify" before relying on it.

## TL;DR

- **The "billions of free tokens" gateways are a no-go.** OmniRoute's headline numbers rely on consumer-subscription OAuth reuse, keyless scraped pools and multi-account pooling. It also had a critical RCE (CVE-2026-88062, fixed in 3.8.49 or later; the advisory data is inconsistent about the fix). FreeLLMAPI is cleaner, because it only uses your own official keys. But it describes itself as "Personal experimentation only", and serving production traffic from pooled free quotas breaks its own guidance and several providers' terms.
- **Legitimate cheap tiers are the real answer, and they cost little.** With Groq paid `gpt-oss-20b` as the primary for the four permitted task classes, the estimate is about **US$45 a month at 1k DAU** and **about US$450 a month at 10k DAU** (assumptions below). Free allocations can trim this at low volume, but they are too small and too unreliable to depend on.
- **Policy routing works in simulation.** In 300 synthetic requests and 220 compression documents there were zero personal-data leaks and zero training-tier violations. Approval and execution records stayed byte-identical (1,734 protected lines checked), and the fallback order was always honoured.

## Scope rules applied

A free or cheap tier may only ever see these four task classes:

| Allowed class | Meaning |
|---|---|
| `public_web_research` | Summarising or extracting from public web pages |
| `morning_intel_public_summary` | Morning Intelligence public news, markets and weather summaries (generated per topic or city cluster, never per-user context) |
| `make_draft_nonpersonal` | Make-tab drafting with no personal or owner-private context |
| `safe_classification` | Labelling public or non-personal text |

Always excluded: Gmail, Calendar, Vault, SecondBrain, payments, approvals, execution, personal memory and chat, contacts, travel tickets, bookings, commerce, and anything unknown. Those classes stay on the existing primary pipeline.

**Automatic NO-GO patterns:**
- repurposing consumer subscriptions or OAuth logins
- proxying forbidden OAuth flows
- keyless scraping of web endpoints
- rotating accounts or keys to multiply quota
- evading rate limits

## Candidates

| Candidate | License | How the free tokens arise | ToS verdict | Data retention / training | Free rate limits | Paid cost | India latency notes | Verdict |
|---|---|---|---|---|---|---|---|---|
| **freellmapi**: [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi), npm `freellmapi` 0.8.2 (MIT, modified 2026-10-20) | MIT | Self-hosted OpenAI-compatible router over your own official free-tier keys (Google, Groq, Cerebras, Mistral, OpenRouter, Cloudflare, Cohere, NVIDIA, HF and others). Tracks usage per key and cools a key down on 429/5xx. | Software is fine. The use is not: the README says "Personal experimentation only", and the [Better Stack guide](https://betterstack.com/community/guides/ai/freellmapi/) says one account per provider, no reselling, no sharing, and "don't use free-tier quotas to power a production service". Per-key pooling invites the multi-key rotation that providers treat as abuse ([Groq lists "rate-limit circumvention" as abuse](https://console.groq.com/docs/your-data)). | Inherits each provider's terms | Sum of the underlying free tiers. "No SLA, quality drops late in the day as caps hit" | n/a | n/a | **NO-GO** as a dependency. Its failover idea is reused in our own adapter, restricted to one official key per provider. |
| freellmapi forks: [S40014/freellmapi](https://github.com/S40014/freellmapi) (fork, 1 star), [Ahmed-M-Abdelkader/freellmapi](https://github.com/Ahmed-M-Abdelkader/freellmapi) (derivative, 8 stars) | MIT | Same as upstream | Same as upstream | Same as upstream | Same as upstream | n/a | n/a | **NO-GO** |
| **OmniRoute**: [diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute), npm `omniroute` 3.8.52 (MIT). Fork [v0l/OmniRoute](https://github.com/v0l/OmniRoute) has 0 stars. | MIT | Claims about 1.62B tokens a month summed across third-party free tiers. It supports **consumer subscription OAuth** for Claude Code, Antigravity, Codex, Cursor and Copilot ([instagit](https://instagit.com/diegosouzapw/OmniRoute/omniroute-oauth-providers-setup/), [pinggy](https://pinggy.io/blog/omniroute_ai_gateway_security/)). It also has keyless free pools, multiple connections per provider, and "TLS stealth" or proxy features. | **Automatic NO-GO.** Anthropic (19 Feb 2026): Free/Pro/Max OAuth tokens used "with any other products, tools, or services … is unauthorized" ([Gigazine](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block)). Google has suspended Antigravity accounts used through third-party proxies ([forum](https://discuss.ai.google.dev/t/appeal-antigravity-ban-for-unintentional-tos-violation-via-claude-code-cli-pro-subscriber-appeal-form-submitted-3x-no-response/142325)). OmniRoute itself marks 12 providers "tos: avoid". | Varies. Keyless pools are unknown. | "Never hit limits" marketing | n/a | n/a | **NO-GO.** Also a critical RCE, [CVE-2026-88062](https://osv.dev/vulnerability/CVE-2026-88062) (CVSS 9.5, ≤3.8.49). A sibling router, 9router, had [CVE-2026-49352](https://www.thehackerwire.com/vulnerability/CVE-2026-49352/). |
| **Google Gemini API, free tier** | Commercial ToS | Official free quota per project | Allowed, but "Do not submit sensitive, confidential, or personal information to the Unpaid Services". Paid only for EEA/UK/CH users. 18+ only ([terms](https://ai.google.dev/gemini-api/terms)) | **Trains on inputs and human review is possible** (unpaid) | Per model, shown in AI Studio ([rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), verify) | Paid: 3.1 Flash-Lite $0.25 in / $1.50 out per 1M; Batch/Flex $0.125 in ([pricing](https://ai.google.dev/gemini-api/docs/pricing)) | One India-based developer reports about 2.1s TTFT on Gemini 3 Flash preview, against about 150ms on Groq ([forum](https://discuss.ai.google.dev/t/high-ttft-2s-with-gemini-flash-vs-150ms-on-groq-any-optimization-or-throttling-insights/138024)). That is an anecdote, not a benchmark. | **GO for the 2 public classes only.** **Paid Flash-Lite (Batch) recommended** for Morning Intelligence. |
| **Groq** | Commercial ToS | Official free plan | Allowed. One account; no limit circumvention. | No retention by default. Abuse/reliability logs kept up to 30 days, with opt-out. **ZDR available to all customers.** Data in US GCP ([your data](https://console.groq.com/docs/your-data)). Training policy not stated (verify). | gpt-oss-20b/120b: 30 RPM, 1K RPD, 8K TPM, **200K TPD** ([limits](https://console.groq.com/docs/rate-limits)). The page is ambiguous about free vs developer plan (verify). | llama-3.1-8b $0.05 / $0.08. gpt-oss-20b $0.075 / $0.30. gpt-oss-120b $0.15 / $0.60 ([via Spheron, citing groq.com/pricing](https://www.spheron.network/blog/groq-api-pricing-2026-cost-per-token-vs-gpu-rental/)) | Fast TTFT (anecdote above). No India region; US-hosted. | **GO.** Recommended primary, on the paid Developer plan with ZDR on. The free plan is far too small (200K TPD covers about 14 user-days). |
| **OpenRouter `:free` models** | Commercial ToS | Official free variants | Allowed for low volume | Free endpoints may route to providers that train. The training opt-out can be set per account or per request ([privacy](https://openrouter.ai/docs/features/privacy-and-logging)). OpenRouter's own retention isn't stated on that page (verify). | 20 RPM. 50 RPD, or 1,000 RPD after buying $10 of credits ([limits](https://openrouter.ai/docs/api-reference/limits)) | Paid variants are uncapped | n/a | **NO-GO for production** (cap too low, provider mix unstable). Fine for model evaluation. |
| **Cerebras** | Commercial ToS | Official free tier, plus $5 trial credit that expires in 30 days | Allowed | **Not verified.** Our simulation assumes no training and 30-day retention; owner must verify before use. | gpt-oss-120b: 5 RPM, 1M TPD ([limits](https://inference-docs.cerebras.ai/support/rate-limits)) | n/a here | n/a | **CONDITIONAL**: second fallback once the data terms are verified |
| **Mistral free mode** (La Plateforme) | Commercial ToS | Official free plan; phone verification required | Allowed | **Trains on inputs by default** in free mode; opt-out exists ([help](https://help.mistral.ai/en/articles/323757-do-you-use-my-user-data-to-train-your-artificial-intelligence-models)). Training opt-in is required per [cheahjs list](https://mintlify.wiki/cheahjs/free-llm-api-resources/providers/free/mistral-plateforme) (secondary source). | 1 RPS, 500K TPM, 1B tokens a month per model (secondary source) | Paid opt-out available | n/a | **GO for the 2 public classes only**, as a fallback. The router blocks it for drafts and classification. |
| **GitHub Models** | GitHub ToS | Free with Copilot tiers | The free limits are "intended to help you get started with experimentation". Production should use paid usage or BYOK ([docs](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)). | n/a | 10–15 RPM, 50–150 RPD, 8K in / 4K out | Paid opt-in | n/a | **NO-GO** for production |
| **Cloudflare Workers AI** | Cloudflare ToS | 10,000 neurons a day on Free and Paid plans | Allowed | **Not verified** (pricing/data page fetch was blocked; verify) | 10k neurons/day, resets 00:00 UTC | $0.011 per 1,000 neurons ([flaviocopes summary](https://flaviocopes.com/cloudflare-workers-ai.md)) | Edge network with India PoPs; GPU locations per model not verified | **CONDITIONAL**: third fallback after verification |
| **Together AI** | Commercial ToS | No free credits since July 2025; $5 minimum prepaid ([pricepertoken](https://pricepertoken.com/endpoints/together/free)) | Allowed | Not verified | Tier 1: about 60 RPM | Small models from about $0.02/1M | n/a | **Not needed** (cheap paid alternative only) |
| **Fireworks AI** | Commercial ToS | Trial credits (amount not verified; fetch blocked) | Allowed | Not verified | n/a | n/a | n/a | **UNVERIFIED** (not needed) |

## Go/no-go summary

| Candidate | Verdict |
|---|---|
| freellmapi (and forks) | NO-GO (personal-experimentation tool; production use of pooled free quotas breaks its own and providers' guidance) |
| OmniRoute | NO-GO, automatic (consumer OAuth reuse, keyless pools, multi-account; critical RCE history) |
| Groq | GO, paid Developer plan + ZDR, primary |
| Gemini | GO paid Flash-Lite Batch for Morning Intelligence. Free tier only for public classes. |
| Mistral free | GO only for public classes, as a fallback |
| Cerebras, Cloudflare Workers AI | CONDITIONAL on verifying data terms |
| OpenRouter `:free`, GitHub Models | NO-GO for production (evaluation only) |
| Together, Fireworks | Not needed |

## Recommended plan (minimal)

1. **Use one provider-adapter interface, one official API key per provider, and no gateway.** `lib/inference/adapter.ts` provides `ProviderAdapter`, the pure `routeTask()` policy router and `compressPrompt()`.
   - `validateRegistry()` rejects consumer OAuth, keyless scraping, pooled multi-account setups, a second adapter for the same provider, and unknown retention.
   - A 429 falls through to the **next** provider. It never retries another key on the same provider.
2. **Fallback order** (owner to confirm):
   1. Groq `gpt-oss-20b` (paid Developer plan, ZDR on)
   2. Cerebras `gpt-oss-120b` (after the data terms are verified)
   3. Cloudflare Workers AI (after verification)
   4. Mistral free (public classes only; the router removes it for drafts and classification)
   5. Gemini 3.1 Flash-Lite **paid** as the backstop
   
   Morning Intelligence uses Gemini Flash-Lite **Batch** (50% off), generated once per topic or city cluster and shared, never per user.
3. **The router refuses by default.** It allows only the four classes, re-scans every prompt for personal data even when the caller says it is clean, and refuses any prompt that contains an approval or execution record. Anything refused stays on the current primary pipeline.

### Monthly cost estimate (assumptions; not measured)

Per daily active user, for the four permitted classes only:
- 2 research calls (6k input / 500 output tokens each)
- 0.3 Make drafts (1.5k / 800)
- 5 classifications (300 / 10)

That is about **14k input and 1.3k output tokens, across about 7 requests, per user-day**. Morning Intelligence per-cluster summaries are negligible: about 50 clusters × 4k tokens a day.

| Model | 1k DAU (420M in / 39M out per month) | 10k DAU (4.2B in / 390M out per month) |
|---|---|---|
| Groq gpt-oss-20b ($0.075 / $0.30) | **about $43** | **about $432** |
| Groq llama-3.1-8b ($0.05 / $0.08) | about $24 | about $241 |
| Gemini 3.1 Flash-Lite standard ($0.25 / $1.50) | about $164 | about $1,635 |
| Gemini 3.1 Flash-Lite Batch ($0.125 / about $0.75) | about $82 | about $818 |

**Recommended budget:** about **US$50 a month at 1k DAU** and about **US$450–500 a month at 10k DAU**, plus 20% headroom. That is roughly ₹4.4k and ₹42k a month at about ₹88/USD (FX not verified).

Free allocations could absorb part of the 1k-DAU load: Cerebras 1M TPD, Groq free 200K TPD, and Mistral up to 1B tokens a month for public classes only. That saves at most about $10–40 a month. It is not worth building any dependency on.

## How compression preserves approvals and execution records

**Protected lines** are either of these:
- A line starting with `[APPROVAL …]` or `[EXECUTION_RECORD …]`.
- Every line inside a `-----BEGIN APPROVAL-----` … `-----END APPROVAL-----` fence, or the `EXECUTION_RECORD` equivalent. Marker whitespace is tolerated, and an unterminated fence protects everything to the end of the prompt.

`compressPrompt()` copies protected lines byte-for-byte. It does no trimming, whitespace collapsing, deduplication, truncation or reordering on them. Only unprotected lines are normalised: whitespace is collapsed, runs of blank lines are folded, duplicates are dropped, and long lines are truncated. The verifier checks that `extractProtectedLines(before)` deep-equals `extractProtectedLines(after)`, and that each protected line appears verbatim in the output.

The simulation caught and fixed one real bug. A hand-spaced fence (`-----BEGIN  APPROVAL-----`) was not recognised before compression but was recognised after it, which would have altered the record.

The router also refuses to send any prompt containing a protected record to a free or cheap tier. Compression of protected records only matters on the primary pipeline.

## Synthetic dry-run results (`npx tsx scripts/verify-inference-policy.mts`)

| Metric | Value |
|---|---|
| Synthetic routing requests | 300 (seeded, deterministic) |
| Allowed to free/cheap chain | 69 |
| Refused: class not permitted | 116 |
| Refused: declared personal | 34 |
| Refused: personal data detected although the caller said clean | 34 |
| Refused: approval/execution record | 47 |
| Requests that used fallback | 20, all in strict order, each provider at most once |
| Personal or protected leaks to fakes | **0** |
| Training-tier violations | **0** |
| Compression docs / protected lines checked | 220 / 1,734, all byte-identical |
| Size saved on unprotected text | 73% |

The registry guard is also checked: it rejects consumer OAuth, keyless scraping, a second Groq account and unknown retention.

## Risks

- **Free tiers are volatile.** Limits change without notice, and the GitHub Models docs say so explicitly. Never make a user-facing feature depend on a free allocation.
- **Training on inputs** (Gemini free, Mistral free) is acceptable only for public content. The router enforces this for drafts and classification, but **misclassifying a class upstream** is the main residual risk. The scanner is a regex backstop, not a guarantee.
- **The personal-data scanner can be wrong both ways.** It may miss names or addresses written in prose, so the router does not detect names. It may refuse public text that contains business phone numbers. Both outcomes are safe: a false refusal just uses the primary pipeline.
- **Data residency and DPDP.** Groq stores data in the US. Cross-border transfer of public, non-personal content is low risk, but legal should confirm before anything touches user-originated text.
- **Latency.** No India-region hosting was confirmed for Groq or Gemini. The TTFT figures are anecdotal.
- **Quality.** Small open models may underperform Haiku on drafting. This needs an offline eval before rollout; the research did not run one.
- **Supply chain.** Self-hosted gateways add an attack surface (the OmniRoute RCE, the 9router auth bypass). Using direct SDK calls behind our adapter avoids it.

## Needs the owner's decision or budget

1. **Budget.** Approve about US$50 a month (1k DAU) scaling to about US$500 a month (10k DAU), and a Groq paid Developer account with ZDR enabled.
2. **Fallback order.** Confirm the order above, and decide whether Mistral free (trains on inputs) is acceptable even for public classes.
3. **Verification.** Have someone read Cerebras and Cloudflare Workers AI data-use terms before they enter the chain.
4. **Offline quality eval.** Approve an eval of `gpt-oss-20b` against current models on the four classes, using public fixtures. This is the next step; it needs keys and spend, so it was out of scope here.
5. **Integration.** Wiring the adapter into Morning Intelligence or web research is a separate, reviewed change. This branch changes no runtime path.

## Pages that could not be fetched (not verified)

- `raw.githubusercontent.com/diegosouzapw/OmniRoute/main/README.md`
- `developers.cloudflare.com/workers-ai/platform/pricing/` (a secondary summary was used instead)
- Fireworks trial page on mintlify.wiki
- Groq community thread on India hosting (redirected to groq.com)

GitHub REST metadata for the candidate repositories was not available in this session, so repo pages were read via the web instead.
