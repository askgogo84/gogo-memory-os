# KeenAble 1.0 evaluation — public search only

16 November 2026. This experiment is isolated from AskGogo Commerce PR #1524 and Claude's current search provider routes.

- Vendor official release: https://keenable.ai/blog/keenable-1.0
- Public API: https://docs.keenable.ai/api-reference/search
- Keyless limited-use, 100k/mo keyed free, $4/1k additional: https://docs.keenable.ai/pricing
- 9 November Artificial Analysis leaderboard: https://artificialanalysis.ai/agents/search-api
- NEEDLE is vendor-run; treat its rank as directional rather than independent.

## State
Shadow-only HTTP adapter at `lib/research/keenable-public.ts`. It is not imported into any production route. It is **disabled unless** `KEENABLE_SHADOW_ENABLED=true`; keyless mode is allowed only outside production with `KEENABLE_ALLOW_KEYLESS_DEV=true`. The default key policy requires `KEENABLE_API_KEY` for production.

The only permitted input has `classification=public_web_only` and `approval=server_verified_public`, set by trusted application server code, never an LLM deciding on its own. Heuristics additionally block obvious sensitive queries. Do not send memory, connected Gmail, internal documents, employee details, account data, invoice numbers or personal instructions. Keenable's ordinary data policy retains requests. Obtain written zero-data-retention terms before any enterprise traffic.

Results include title, source URL, page excerpt, published and indexed timestamps; reject ephemeral knowledge-card links for durable citations, private hosts, duplicates, unsupported protocols and malformed provider responses. 600-character snippets and 3-8 results cap model tokens. HTTPS only, no query logging, timeout caps, no automated retries or purchases. It is NOT a browser executor and cannot make merchant payments.

## Acceptance and rollout
Evaluate 100 public-domain benchmark queries against AskGogo's currently preferred Parallel, Serper and fallback on: answer correctness with citations, freshness, Indian coverage, hallucination rate, token cost, p50/p95 latency and external cost. Include business operations, finance, travel, policy and general questions, but only public facts. Build an offline reusable dataset from public facts, NOT enterprise/private data. Disable the pilot after test failures and do not change search-provider routing until benchmark criteria are met and a code review is completed.

**Important:** No live Keenable API calls were made by this commit; CI tests the contract with mocked responses. The screenshot's 50% lower token count and 100M cards are Keenable's reported product claims, not AskGogo validation.
