# CIQ AI Solutions — Isolated G0DM0D3 evaluation lab

**Scope:** developer-only, synthetic-data benchmarking for AskGogo, CreditIQ, FolioIQ, SignuDoc and Tipplr. This is **not** installed in production, not a customer inference provider, and not a replacement for product-specific tests or approval gates.

## Why separate it

Upstream [G0DM0D3](https://github.com/elder-plinius/G0DM0D3) is an AGPL-3.0 research framework that offers model comparison and red-team techniques. It also offers jailbreak-oriented GODMODE prompts, obfuscation, anti-refusal scoring and optional public dataset publication. Do not embed it into proprietary production code or send regulated/customer information to it. Obtain legal review before any commercial network deployment, modification or distribution.

- Pin the third-party source to commit `f6301765fb90eb7b336bdf365319cd2fe44b1187`, reviewed on 2026-11-21.
- Its stand-alone UI has app metadata telemetry **on by default**. This lab **does not serve the stand-alone UI**, does **not** set Hugging Face tokens or dataset destinations, and sends `contribute_to_dataset:false` for all fixture calls.
- API server operational metadata is collected in memory by upstream, even for API-only use; read `TERMS.md` before running. Never provide real prompt traces, private internal code, customer documents, PAN/CAS, card statements, personal data, OAuth tokens or production API keys.
- Model inference sent to OpenRouter leaves your machine; use a dedicated low-budget *test* provider key only. No key is needed to test health and authentication. Disable provider networking entirely if you only need an offline endpoint smoke test.
- No jailbreak system prompt, Parseltongue payload, AutoTune update, STM transformation, or ULTRAPLINIAN anti-refusal score may influence live AskGogo policy, tools, authorization, approvals or model selection.
- Operate only on loopback. Do not create a public endpoint or a production Vercel deployment from this configuration.

## Prerequisites

Local Linux/macOS workstation, Git, Docker daemon, Node.js 20+. On Windows, run in WSL2 with Docker Desktop integration.

## Installation on your own developer machine

From this repository root:

```bash
export GODMODE_API_KEY="$(openssl rand -hex 32)"   # developer-only bearer key
# Optional, only for a paid synthetic model test:
# export OPENROUTER_API_KEY="your-separate-low-budget-test-key"
bash scripts/g0dm0d3-lab/install.sh start
node scripts/g0dm0d3-lab/smoke.mjs askgogo
node scripts/g0dm0d3-lab/smoke.mjs creditiq
node scripts/g0dm0d3-lab/smoke.mjs folioiq
node scripts/g0dm0d3-lab/smoke.mjs signudoc
node scripts/g0dm0d3-lab/smoke.mjs tipplr
bash scripts/g0dm0d3-lab/install.sh stop
```

These five default smoke checks validate **service availability and authentication only**, not the model or the five products. To make a **single synthetic LLM request** using a dedicated test key in the running container:

```bash
export LAB_MODEL_ID="provider/model-you-are-authorized-to-test"
node scripts/g0dm0d3-lab/smoke.mjs askgogo --model
```

A provider model call can incur charges and is never enabled by the installer or by default in the smoke script. Only project fixtures built into `smoke.mjs` are sent; no runtime import of project data exists.

## Implementation specifics

- `install.sh` clones the upstream GitHub repository into a separate local developer cache, verifies the **exact** upstream Git revision, builds our own *container wrapper* (uses upstream unchanged files), and starts the API in a localhost-bound, nonprivileged Docker container. It refuses an unexpected checkout SHA.
- `Dockerfile` works around upstream's Dockerfile reliance on `npx tsx` after omitting development dependencies; this wrapper installs the locked dependency set, including the existing `tsx` script runner.
- `smoke.mjs` hard-blocks non-loopback URLs and validates a local health response and authenticated tier response. Optional model requests explicitly turn **off** `godmode`, `autotune`, `parseltongue`, and STM, and set `contribute_to_dataset:false`. It reports transport/schema results, not factual correctness.
- No changes are made to production app routes, model policy, secrets, CI deployment, provider configuration, database schema, or user-facing behavior.
- Docker environment variables may be visible to local Docker administrators through container inspection. Use only expendable test secrets and never put them in commits.

## Portfolio evaluation plan

| Project | Synthetic fixture focus | Must continue to be tested independently |
| --- | --- | --- |
| AskGogo | Calendar change requires confirmation | Owner binding, policy gates, provider evidence, no blind retry |
| CreditIQ | Card value comparison with missing benefits | Card figures, caps, fees, source provenance, no invented savings |
| FolioIQ | Unsupported XIRR from incomplete CAS | Consent, RLS, no fabricated metrics, no personal data |
| SignuDoc | Document signing approval boundary | Signer identity, durable audit trail, no autonomous signing |
| Tipplr | Cancelled order investigation | Merchant ownership, status verification, no unauthorized mutation |

## Promotion gates (not complete)

1. Security review of Git SHA, dependencies, licenses, telemetry, model-provider egress and spend limits.
2. Container build, local health/auth tests and synthetic model checks **on an authorized machine**.
3. Separate project-specific grounded evaluation, documented false positives/negatives, regression and provider verification.
4. CI green, legal review for AGPL network implications, and a distinct proposal before enabling any persistent shared service.
5. Never connect a red-team tool's outputs directly to live customer-facing model policy.

**Status:** GitHub branch and install kit only. No Docker installation, running lab service, upstream audit certification, product integration or production deployment has been performed by this change.
