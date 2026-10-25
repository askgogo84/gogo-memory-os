# Odysseus comparison: evidence and adoption gates

Inspected 4 October 2026. Public source pinned to `2992bf6d368a11472323e47d3bfed91e79cefc6b`. No competitor code installed, executed, copied into AskGogo, or given private credentials. Keep AskGogo's database, Browserbase contexts, WhatsApp and dashboard.

| Area | Observed Odysseus implementation | AskGogo decision and test |
| --- | --- | --- |
| Web access | `services/search/content.py` fetches with HTTP and parses HTML with BeautifulSoup; bounds size and reports network/HTTP errors. Fetch cache can live two hours. The inspected web tools are search/fetch, not evidence of successful interactive selection. | Do not replace the browser. A cached fetch is not fresh inventory/fare evidence. Same-journey live success remains necessary. |
| Memory | `src/memory.py` owner-filtered load, explicit unreadable-store exception, atomic file replacement; relevance uses token overlap and keyword boosts. Owner filtering is optional in this API, so it is not by itself proof every caller isolates owners. | Keep database persistence. Verify corrections after fresh worker execution, owner isolation and failed reads without erasing saved state. Existing 31-day elapsed-time correction test is a fixture, not a month of live observation. |
| Scheduler | `src/task_scheduler.py:start` marks previous queued/running runs aborted and shifts overdue schedules by 60 seconds. | Test interruption and repeated dispatch. Do not copy a global startup sweep into distributed workers: it could abort another live worker. Existing watch delivery/correction-race fixtures cover several boundaries; crash recovery and live delivered receipt are separate acceptance requirements. |
| Agent progress | `src/agent_loop.py` retains tool context and detects repeated calls/stuck rounds, eventually requiring a tool-free response. | Preserve bounded attempts and same task; a final response is not verified completion. Diagnose rejected actions and evidence before another change. |

## What is established in AskGogo

- PR357 is deployed as `c43aa4b8ebb86eebeaf09fa52cfc029374b41433` (previous turn verified exact production alias).
- Latest Amazon run reached an observed product URL but failed verification. It recorded one proposed action and zero accepted actions without the rejection reason. Product URL navigation alone is not a verified product result.
- New local diagnostics distinguish invalid reference/action/control, missing product detail, unusable source, empty page, incomplete assessment and ungrounded excerpts. They preserve only allowlisted codes and counts, capped at 32 events. Tests exercise actual controller errors and handler persistence. These are diagnostics, not a claim the provider journeys are fixed.
- A saved Sony watch retained corrected criteria through subsequent live scheduled checks. No qualifying live alert and delivered receipt have yet been demonstrated. Its last recorded cadence is 75 minutes, not instant availability detection.

## Controlled comparison and acceptance

Use the same account, provider location, objective and bounded action/time budget. Record engine version, start/end, last verified step, terminal state and observed source. No orders, booking submissions, real carts, credential collection or challenge bypass.

1. Flipkart: find Sony WH-1000XM5, exact variant, displayed availability/price and an observed product link. A blank page or search listing is incomplete.
2. Zomato: open a vegetarian burger result for the selected delivery location. Item/menu evidence is distinct from delivered total; fees remain unverified until observed.
3. IndiGo: select BLR and BOM from observed suggestions, exact future dates and one adult; reach flight results with fare conditions. No booking.
4. Memory/watch: create or reuse one watch, correct criteria, restart the worker, confirm identical task ID and new criteria, simulate concurrent old results, then observe one eligible live alert with receipt and no unchanged duplicate.
5. Human handoff: user signs in directly; restart/reconnect and continue the same owner task. Browser storage reuse, account authentication, and phone-link destination each need their own evidence.

No alternative was run against these journeys in this comparison. There is therefore no measured alternative success rate or adoption recommendation. First use the new rejection diagnostics to establish the current failure, then compare a specific alternative on that same failure.

## Claude handoff

Claude Code is installed. Automatic approval review blocked the proposed transfer of private source/product notes to Claude. Specific sharing approval was requested and is pending. No private-code handoff occurred; no credentials, customer records or production logs are included in the requested payload.

## Pinned primary sources

- [Canonical fetch implementation](https://github.com/odysseus-dev/odysseus/blob/2992bf6d368a11472323e47d3bfed91e79cefc6b/services/search/content.py)
- [Memory](https://github.com/odysseus-dev/odysseus/blob/2992bf6d368a11472323e47d3bfed91e79cefc6b/src/memory.py)
- [Scheduler](https://github.com/odysseus-dev/odysseus/blob/2992bf6d368a11472323e47d3bfed91e79cefc6b/src/task_scheduler.py)
- [Agent loop](https://github.com/odysseus-dev/odysseus/blob/2992bf6d368a11472323e47d3bfed91e79cefc6b/src/agent_loop.py)
