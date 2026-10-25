# AskGogo daily-use acceptance contract

Updated 7 October 2026. The supplied Muse post says “26 use cases”; the pasted excerpt has 24 named sections. All 24 sections are included below, plus the calls, business and shopping cases from the accompanying request. These are requirements, not verified claims about Muse's implementation.

## What counts as passing

The user asks in WhatsApp or web chat; the correct owned task is created; work survives closing the client; the requested output is delivered to the originating surface; evidence establishes the result. A queued acknowledgment, model-generated statement, passing fixture or provider-accepted message alone does not establish completion.

For an external action, prepare the concrete choice/draft first and retain its identity through clarification and approval. A booking passes only with the provider's booking reference/status, not a filled form. A payment passes only with an authorized transaction and receipt. Login/CAPTCHA/payment challenges pause with a usable handoff. A blocked provider produces a clear explanation or labelled fallback; it is not silently counted as a successful action.

## Use-case inventory

**Code** means a relevant implementation was found; it does not mean production acceptance passed. **Gap** means the requested integration/executor has not been demonstrated in this repository. **Mixed** means only part of the requested outcome is implemented.

| Requested case | Current evidence / boundary | Acceptance requirement |
|---|---|---|
| News alerts | Code: `watch-command.ts`, `watchers.ts`, notification delivery | Source-backed change alerts; no repeated unchanged messages; edit/stop works |
| Courts, movies, restaurants, flights | Mixed: appointment/restaurant/browser/travel workers and booking closure; court/provider coverage unverified | Availability, exact slot/date, approved commit, provider confirmation, calendar conflict check |
| Custom Kanban | Mixed: saved tasks and lists; no demonstrated arbitrary custom-app builder | Create/move/archive cards and recover the board; generated app claims require an actual deployed artifact |
| Calendar management | Code: Workspace OAuth, calendar handlers and approval policy | Correct timezone, no duplicate event, conflict handling, edit/cancel and confirmation |
| Spotify playback/playlists | Gap: no Spotify playback/playlist executor found | Connected-device selection, actual playback or persisted playlist URI |
| SMS/RCS texting | Mixed: WhatsApp transport exists; standalone SMS/RCS consumer flow unverified | Resolve recipient, preview exact draft, approve, delivery receipt, no duplicate send |
| Agent phone / partner updates | Gap: no demonstrated dedicated identity, phone battery/location bridge | Explicit contact/access setup and evidence from authorized device data |
| Voice notes | Code: transcription and voice input; output coverage needs acceptance | Same action semantics as text, transcription ambiguity handled, actual playable audio if requested |
| Multi-voice podcasts | Gap: no demonstrated podcast rendering/delivery executor | Real audio artifact, requested voices/content, playable/downloadable result |
| Deep research | Code: research/planner/artifact paths | Dated sources, distinguish inference, usable saved report, resumable job |
| Monthly finances / bank accounts | Mixed: expenses and CreditIQ; no Plaid/bank-ledger statement integration demonstrated | Read-only accounts, reconciled balances/transactions, missing cash clarification, actual statement export |
| Price alerts | Code: web watches; market-specific data/change rules need acceptance | Correct asset/currency/threshold, prior observation comparison, stop works |
| xpub wallet security watch | Gap: no xpub derivation/blockchain outgoing-transaction executor found | Watch-only addresses, confirmed outgoing transaction evidence, no signing keys |
| Email drafts | Code: Gmail read/draft/send gates and inbox triage | Correct thread, drafts visible, no send before approval, corrections retained |
| YouTube comment replies | Mixed: generic browser; no demonstrated scheduled channel/comment executor | Owner channel, exact comment/reply preview, approval, published comment readback |
| Social posts | Mixed: draft workflows and browser; no demonstrated every-platform scheduler | Full draft, no invented personal claims, approval and published URL/readback |
| Sentry/GitHub bug monitoring | Gap: no deployed issue-to-repo repair executor found | Source error, isolated patch, tests, concrete reviewable change; no claimed fix without code |
| PC screenshot streaming | Gap: no authorized desktop streaming client in this repo | User-controlled capture, correct device, explicit start/stop, observed image |
| Managing other AIs | Mixed: Anthropic/OpenAI calls exist; arbitrary external model delegation unverified | Supported model/API, bounded task and costs, actual result and failure handling |
| Image/video generation | Gap: no demonstrated media-generation artifact executor | Actual generated media, task ownership, downloadable artifact; no fake file/link |
| Google Drive collaboration | Mixed: contextual Drive retrieval; live document editing/export coverage unverified | Exact owned document, preview changes, actual saved edit, current revision |
| D&D / campaign assistance | Mixed: conversation/memory/research | Retrieve correct campaign/rules, persistent notes, no invented recalled facts |
| Video editing | Gap: no footage processing/rendering executor found | Actual uploaded input, processed output, duration/format verification and resumable compute |
| Dynamic avatar outfits | Gap: no demonstrated avatar asset/state workflow | Correct context, actual rendered asset/state and user display |
| Customer-service calls / IVR / hold / transfer | Gap: no call orchestration or live handoff executor found | Provider call SID, verified connection, IVR/hold state, usable human transfer |
| Bill negotiations / cancellations | Mixed: browser cancellation primitives; voice negotiation missing | Exact account/service, bounded authority, explicit approval, provider cancellation or revised bill evidence |
| Marketplace negotiation / pickup | Mixed: generic browser; seller messaging/negotiation workflow unverified | Exact item and seller, approved messages and price bounds, actual seller response and agreed pickup |
| Groceries / food / retail | Code: commerce providers, comparison, cart approval and delivery tracking | Product/quantity/location, total fees, offers eligibility, approval, order receipt |
| Shopify / Stripe / QuickBooks admin | Gap: no business-ledger/inventory executors demonstrated | Connected owner store, stock/order evidence, idempotent changes and ledger reconciliation |
| Competitor ad/research briefs | Mixed: public research/content drafts; private ad/group access and slide export unverified | Accessible dated ads/quotes, citations, actual deck artifact, no fabricated engagement |
| Four-week content calendar | Mixed: drafts/planner/calendar; trend metrics/publishing coverage unverified | All requested weeks/platforms, dated evidence, approval before publishing/scheduling |
| WhatsApp business support | Mixed: current personal-agent WhatsApp path; merchant knowledge/reservation integration unverified | Correct merchant context, customer identity, escalation and real reservation confirmation |
| Lifestyle goals and reminders | Code: goals, reminders and autonomous workers | Concrete plan, correct timezone/cadence, delivery, snooze/done/edit/stop |
| Notion daily research database | Gap: no Notion database write executor found | Connected database/schema, actual row/page IDs, duplicate prevention and schedule stop |

## Conditions every supported flow must cover

1. Exact production request and natural paraphrase.
2. Voice/text parity, spelling variation and quoted content vs instructions.
3. Multiple requests in one message; failure of one must not swallow another.
4. Missing or ambiguous identity/date/time; one concise clarification, retained draft context.
5. Timezone midnight, DST where applicable, explicit date, past/invalid date.
6. Duplicate inbound event, double approval/click and overlapping workers.
7. Client closed, worker interruption/restart, stale lease and bounded retries.
8. Temporary provider errors, rate limit, timeout, unavailable stock/slot.
9. Authentication/security challenge with a usable handoff; no bypass.
10. Approval is scoped to the exact recipient/choice/amount; edits invalidate stale approval.
11. Wrong account/owner isolation and no private-data leakage.
12. Evidence: product variant, route/date/cabin/passengers, source currency and amount.
13. Unknown taxes/baggage/fees/delivery/offer eligibility remain unknown.
14. Provider-accepted output distinguished from actual recipient delivery.
15. Failed publication retries delivery without repeating completed external work.
16. No fake success, confirmation reference, file, media, purchase or booking.

## Current production acceptance

Retailer comparisons: fresh Flipkart and Croma product-page reads and automatic web publication were verified on 7 October. Real WhatsApp receipt remains pending a user phone message.

Flight baseline: the real web test for BLR → BOM, 20 October 2026, one adult, economy, non-stop failed with `browser_objective_unverified` and generic HTTP failure. The repair introduces durable queueing, a worker, conservative evidence validation, labelled fallback, and originating-surface publication. Live acceptance of the repaired build must be recorded separately; fixture success does not qualify as live inventory or booking success.

No unverified integration in the inventory above is marked as passing. Universal provider success is not a valid acceptance criterion: third-party outages and authentication walls need tested recovery, not fabricated completion.
