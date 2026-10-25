# Read-only production performance/cost baseline

Observed 2026-10-21 19:30:40 UTC (22 October IST), preceding24h rolling window. Source/deployment:b563a57; READY dpl_FWEZ3TvN6RsHAxvfX2wvdGfpH6Ta. Data are aggregate existing metering and run rows, without raw private payloads.

| Recorded vendor/category | Events | Stored estimate INR |
|---|---:|---:|
| Anthropic LLM |40|72.4397|
| Browserbase session |12|52.8000|
| Inception LLM |26|1.7805|
| Serper search |79|6.9520|
| Twilio WhatsApp outbound |17|5.9500|
| Total |174|139.9222|

Rate-card estimates are not invoices. The17 stored outbound events were historical events, not sends performed by this audit. LLM stored input/output: Anthropic724848/7687; Inception33352/11896. Legacy input fields may be cache-weighted; these are not raw token/cache reuse measures.

All174 lack task attribution, measured model latency and explicit pricing-status metadata. Do not divide aggregate costs by stored completed runs and call it cost per verified task. Proposed #736 instrumentation preserves raw/cache counters, explicit unavailable prices and owner/run/step/attempt attribution prospectively; it is not yet deployed.

Stored run statuses:9 completed,17 failed,4 paused,2 running. Completed rows(n9) wall p50=56,329ms and p95=301,713ms; failed(n17)p50=58,261ms,p95=185,212ms. These intervals are database wall durations, not end-user latency or independent success. Some paused rows have old completed_at; exclude them from completion metrics.

UNAVAILABLE: provider-verified completion rate, cost per verified completed task, actual invoice/browser minutes, queue/startup timings, cache-hit ratio, representative Jev classification/clarification accuracy, redundant-model-call rate and recovery success denominator.

Local aggregate artifact: outputs/core-v2-production-baseline-20261022.json, SHA256 B210F1EECA664536385130A19553E73E97AC60E54A197E87559ACB25F885086F. No raw credentials, messages, financial records or private documents are included.
