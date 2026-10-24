# AskGogo Universal Agent Operator Architecture

Date: 2026-09-13

## Product outcome

AskGogo should behave like one personal operator even though many specialist agents execute the work. A user should be able to say things such as:

- Find and prepare the best Mumbai to Rajkot train for tomorrow evening.
- Compare flights, trains and buses and choose the best option for me.
- Find three movie/concert/event ticket options and prepare the best one.
- Build my grocery basket across Blinkit, Zepto and Instamart and show the cheapest usable basket.
- Reorder the food I usually get, but compare Swiggy, Zomato and direct ordering first.
- Find the best delivered price for this product across Amazon, Flipkart and the brand store.
- Track this purchase, warranty, return deadline and refund status.

The user should not need to know which agent, provider or execution tool is involved.

## Core rule: specialist agent + relevant memory + safest execution surface

Do not solve every request with one giant prompt or one browser agent. The orchestrator chooses:

1. the specialist domain;
2. the minimum memory required for the next decision;
3. the safest available execution surface;
4. the approval boundary;
5. the verification evidence required before claiming success.

The seven memory classes used by AskGogo are:

| Memory | AskGogo use |
| --- | --- |
| Working | Current objective, constraints, options and tool observations needed for the next decision only. |
| Semantic | Stable user facts/preferences: home city, dietary preferences, preferred airlines, brands, seat preferences, budget rules. |
| Episodic | Prior executions: what provider was tried, what failed, what price/result was found, user feedback, final outcome. |
| Procedural | Provider playbooks, safety rules, approval rules, comparison procedures and reusable skills. |
| Retrieval | Documents, email, receipts, bookings, screenshots, connected-account data and exact structured records. |
| Parametric | General model knowledge/reasoning; never the authority for live price, policy, balance, availability or account facts. |
| Prospective | Reminders, watchers, retries, deadlines, delivery/booking monitoring and future actions. |

Stored data is not automatically active context. Each specialist should retrieve the smallest useful subset into working memory. Old or irrelevant memories must not be dumped into every model call.

## Specialist agents

### Orchestrator

Owns intent/outcome decomposition, specialist selection, context minimisation, sequencing, approvals and final verification. It does not become a universal executor.

### Travel Agent

Rail, flight, bus, hotel and itinerary research/preparation. It can combine alternatives across modes. It uses trip history and user preferences, but live inventory/fare/availability must come from a current provider/API/page.

### Ticketing Agent

Movies, concerts, sports and other event tickets. BookMyShow-style provider blocks use device handoff rather than anti-bot evasion.

### Food Agent

Restaurant/menu discovery, basket comparison, fees, ETA, dietary preferences and repeat-order history. Final order submission/payment is approval controlled.

### Grocery Agent

Basket-level comparison across quick-commerce/grocery providers. It must reason about substitutions, pack sizes, availability, delivery time and total delivered cost rather than comparing only headline item price.

### Shopping Agent

Product research across marketplaces and brand stores. Ranking considers total landed cost, seller/merchant confidence, delivery, return policy, warranty and—when explicitly available—rewards/card economics.

### Local Services Agent

Appointments, reservations and local/home services. It coordinates availability with calendar and location context.

### Communications Agent

Reads connected communication context with permission; drafts or prepares outbound actions. Sending/forwarding remains approval controlled.

### Documents Agent

Receipts, IDs, tickets, statements, confirmations, files and expiry evidence. It provides exact retrieval evidence to other specialists rather than forcing them to infer facts from chat history.

### Calendar Agent

Availability/conflict reasoning and prepared calendar mutations. External mutation remains approval controlled.

### Life Event Agent

Long-lived state machine for trips, bookings, purchases, deliveries, subscriptions, documents and follow-up. This is AskGogo's prospective-memory backbone.

### Payments Agent

Separate high-risk boundary. Other agents may research and prepare carts/bookings, but payment authorization is not implicitly inherited. The payments specialist owns spend approval, idempotency, amount/payee verification and supported payment/device handoff.

### Research Agent

Fresh public/partner evidence and option normalisation. It researches; it does not silently buy.

### Secure Browser Agent

Permitted web navigation only when a safer supported API/account integration is unavailable. It must never bypass anti-bot, CAPTCHA, authentication or provider access controls. Challenges move to device handoff or another legitimate source.

## Universal execution lifecycle

Every substantial internet task should be representable as:

`UNDERSTAND → RETRIEVE → RESEARCH → NORMALIZE → RANK → PREPARE → APPROVE → EXECUTE → VERIFY → REMEMBER → MONITOR`

### UNDERSTAND

Extract desired outcome and constraints: date/time, budget, passengers, quantity, delivery address/context, preferences and what trade-offs are acceptable. Ask only for genuinely missing information.

### RETRIEVE

Load the smallest relevant user context. Examples:

- semantic: preferred seat, favourite restaurant, vegetarian rule;
- episodic: last failed IRCTC attempt, prior preferred seller, usual grocery basket;
- retrieval: booking email, receipt, order screenshot;
- procedural: provider-specific booking/search skill;
- prospective: existing watcher or deadline.

### RESEARCH

Prefer supported partner/provider APIs and connected read-only account data. Use public web/browser research only where appropriate.

### NORMALIZE

Convert provider results to a shared schema. For commerce this includes item/basket total, taxes/fees, ETA, cancellation/return terms and confidence. For travel it includes departure/arrival, duration, class/fare, transfers and booking constraints.

### RANK

Rank against the user's actual objective rather than cheapest headline price. Default ranking dimensions include:

- final payable amount;
- availability/inventory confidence;
- time/ETA and schedule fit;
- cancellation/refund/return terms;
- seller/provider confidence;
- user preferences and past feedback;
- loyalty/rewards economics only when reliable data is available.

### PREPARE

Fill/search/select up to the consequential boundary. Prepare the cart, passenger form, reservation or checkout state where permitted.

### APPROVE

External mutations with meaningful consequence require the existing AskGogo permission/Sentinel boundary. Payment always has its own explicit boundary.

### EXECUTE

Use the safest available execution surface:

1. supported partner API;
2. authenticated/connected account action with explicit permission;
3. permitted Secure Browser interaction;
4. device handoff for provider auth/challenge/payment;
5. human/manual handoff when none of the above is reliable.

### VERIFY

Never equate a click with success. Require terminal provider evidence: confirmation page/state, booking/order ID, confirmation email, provider-issued ticket/QR, payment confirmation or equivalent strong evidence.

### REMEMBER

Write an episode containing objective, provider, actions, observations, errors, user feedback and verified outcome. Extract only stable lessons into semantic/procedural memory.

### MONITOR

Create prospective actions only when useful: fare/price watcher, delivery tracking, boarding-pass watcher, return deadline, warranty expiry, subscription renewal, cancellation deadline, event/venue change, etc.

## Provider capability strategy

A provider is not hard-coded directly into conversational logic. Each provider gets capability metadata and one or more adapters/playbooks.

| Domain | Example providers | Preferred path | Fallback |
| --- | --- | --- | --- |
| Rail | IRCTC / supported rail partners | partner/API where legitimately available | permitted browser → device handoff for auth/payment |
| Flights | airlines / OTAs | airline/OTA API, existing travel integrations | browser/device handoff |
| Movies/events | BookMyShow and supported ticket networks | provider/partner source | screenshot/device handoff when provider blocks server access |
| Food | Swiggy, Zomato, direct restaurant | supported commerce/partner integration | permitted browser/device handoff |
| Grocery | Blinkit, Zepto, Instamart, BigBasket | supported partner/catalog integration | permitted browser/device handoff |
| Shopping | Amazon, Flipkart, brand stores | affiliate/catalog/partner APIs where available | permitted browser/device handoff |
| Local services | provider/marketplace-specific | supported booking API | browser/device handoff |

The absence of a server-safe provider path must not trigger anti-bot evasion.

## History and personalisation

AskGogo's history must be assembled from legitimate user-owned sources:

- AskGogo's own verified episodic runs;
- connected email confirmations/receipts;
- user-shared screenshots/files/receipts;
- supported provider account/API integrations;
- explicit semantic preferences saved by the user.

Do not infer an order/history entry simply because a similar provider message exists.

## Payment architecture

Phase 1: autonomous research and checkout/cart preparation, user pays on provider/device.

Phase 2: supported payment intent with explicit amount/payee/cart approval, idempotency and terminal verification.

Never store or replay CVV, OTP or other one-time authentication secrets. Authentication challenges remain user/device controlled.

## Failure learning

Every specialist run should classify failure cause, for example:

- provider_unavailable;
- no_inventory;
- auth_required;
- provider_access_challenge;
- payment_required;
- ambiguous_identity;
- stale_price;
- verification_missing;
- user_rejected;
- tool_error.

Episodic reflection may suggest a procedure change, but one failure must not automatically become a permanent rule. Procedural changes need validation/regression coverage.

## Release acceptance examples

The router must select these domains consistently:

- “Book a Mumbai to Rajkot train tomorrow after 6” → Travel.
- “Find tickets for a concert this weekend” → Ticketing.
- “Order my usual biryani but compare Swiggy and Zomato first” → Food.
- “Get this grocery list from the cheapest service in 30 minutes” → Grocery.
- “Find this phone on Amazon and Flipkart and tell me the best deal” → Shopping.
- “Renew my passport before it expires” → Documents + Life Events; any external submission is separately approved.
- “Pay this bill” → Payments; no payment without explicit approval.

The same user identity, semantic preferences, life-event state and approval policy must hold across WhatsApp, dashboard and native app.
