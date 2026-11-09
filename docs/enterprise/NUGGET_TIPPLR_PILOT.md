# AskGogo Enterprise x Tipplr/Flipkart/Petpooja - isolated shadow pilot

**Status (5 November 2026): DRAFT research and pure-function prototype. Not connected to Flipkart, ONDC, Petpooja, production DB, WhatsApp, or real customer orders. No external writes or resolved incidents.**

Tracked in **#1283**. Cross-agent coordination / ownership is **#274**.

## Independent Nugget-class pattern (public behavior only)

Nugget publicly documents intent routing -> verified knowledge -> contextual verification -> pre-response validation -> guarded business actions -> observability. Its Builder, Evals, Insights and Journeys provide useful functional benchmarks. We must implement our own architecture, not copy proprietary code, UI or prompts.

Sources: https://www.nugget.com/ ; https://www.nugget.com/technology/ ; https://www.nugget.com/chat/ ; https://www.nugget.com/resources/zomato-case-study/

## First thin slice

- Pure triage in `lib/enterprise/tipplr/triage.ts` classifies cancellation/rejection, known vs unproven POS mapping discrepancies, delayed orders and refund requests.
- Side-effect-free. It **never** authorizes a refund, external customer communication, cancellation or store remapping.
- Evidence `verified: true` is an **input from a future authenticated provider adapter**, not independently established in this module. An untrusted caller must never set it without signed event / provider readback verification.
- It rejects malformed tenant/order IDs, includes a tenant-scoped idempotency tuple, and refuses stale or future-dated mapping evidence.
- It is *not* wired into existing personal AskGogo brain, live webhooks, workspaces or production routes.

## Run isolated tests

```bash
node --experimental-strip-types scripts/verify-tipplr-enterprise-triage.mts
```

This uses Node 22 type stripping for a dependency-free offline smoke test. Production integration still needs repository CI/test manifest integration, full regression, typecheck and build verification.

## Proposed enterprise architecture

```text
Signed Flipkart/ONDC/Tipplr/Petpooja events -> tenant-scoped event ledger
  -> durable queue -> authenticated order + POS readbacks
  -> deterministic mapping/incident triage -> verified SOP and co-pilot
  -> internal support case -> approval-gated partner action
  -> provider readback -> outcome-verification audit -> analytics
```

Suggested enterprise tables: tenants, memberships, merchant stores, provider connections, order refs, ingress events, cases, case events, action proposals, approvals, outbox, SOP sources and evals. All RLS-denied by default, exact tenant/merchant IDs, scoped service role, no access to personal memory/Vault.

## Never assume authority

- Marketplace/ONDC complaint roles and external APIs depend on written partner arrangements.
- Consumer grievances ordinarily start with the buyer app under ONDC guidance: https://www.ondc.org/pages/complaint.html
- No automatic partner refunds, mapping corrections, live customer messages or real order mutations from this pilot.
- A ticket opened or HTTP 200 is **not** an incident fixed. Unknown outcomes must be reconciled before retrying.

## Next requirements

1. Obtain anonymized Flipkart order events, Tipplr merchant-store truth table and Petpooja authenticated mapping samples from authorized partner staff.
2. Establish provider signing/auth, dedupe uniqueness, exact tenant isolation, RLS, retention, audit and a replay fixture.
3. Build signed ingest + read-only adapters, isolated case dashboard, partner escalation with source evidence, staging QA and independent security review.
4. Start 10-25-store *shadow* pilot only after partner approval. Require explicit user approval before any live consequential action, merging or deploying.

**Never mark this PR production-ready on the basis of synthetic local tests alone.**
