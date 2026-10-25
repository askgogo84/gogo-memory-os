# AskGogo India commerce integrations — 1 October 2026

Status: researched from provider documentation; none of these MCP connections is activated in AskGogo. The owner confirmed Swiggy access has not yet been added. A client configuration or a successful public search is not production integration.

## Verified official options

| Provider | Interface and endpoint | Documented capability | AskGogo activation requirement |
|---|---|---|---|
| Swiggy Food | MCP: `https://mcp.swiggy.com/food` | Saved addresses, restaurant/menu discovery, cart operations and readback | Production access application, approved callback, per-user OAuth |
| Swiggy Instamart | MCP: `https://mcp.swiggy.com/im` | Grocery search and cart/checkout workflow | Same onboarding; validate local inventory per selected address |
| Swiggy Dineout | MCP: `https://mcp.swiggy.com/dineout` | Restaurant/table discovery and reservations | Same onboarding; separate reservation workflow |
| Swiggy Scenes | MCP: `https://mcp.swiggy.com/scenes` | Listed as an official server | Scope expansion after food/grocery acceptance |
| Zepto | MCP: `https://mcp.zepto.co.in/mcp` | Search, account-synced cart, orders and history across groceries and other stocked categories, including electronics | Ask for the AskGogo callback to be allowlisted and confirm third-party product use; per-user OAuth |
| Zomato | MCP: `https://mcp-server.zomato.com/mcp` | Restaurant/menu discovery, cart creation, ordering and QR payment | Official manifest says personal testing only and no third-party apps currently; obtain integration permission before activating AskGogo |
| Amazon India | Creators API, not a verified consumer cart MCP | Product catalog access for eligible affiliate/publisher integrations; India marketplace is documented | Eligible Amazon account/API credentials; a separate cart/checkout approach would need verification |

Sources: [Swiggy quickstart](https://mcp.swiggy.com/builders/docs/start/developer/), [Swiggy delegated auth](https://mcp.swiggy.com/builders/docs/start/enterprise/delegated-auth/), [Swiggy cart readback](https://mcp.swiggy.com/builders/docs/reference/food/get_food_cart/), [Zepto official manifest](https://github.com/zeptonow/mcp), [Zomato official manifest](https://github.com/Zomato/mcp-server-manifest), [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/), [Amazon locale reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/locale-reference).

Zepto's manifest explicitly states that the cart stays synced with the account. That does not establish the same guarantee for other providers. Opening a URL in an installed app is an OS/provider behavior; a cart must separately be read back in the intended account. We have not phone-tested either behavior in AskGogo.

## Popular services not verified as available consumer MCP integrations

| Service | Finding / next route |
|---|---|
| Blinkit | No official public consumer MCP verified in this research. Community wrappers are not proof of supported API access or app-cart sync. Keep browser/manual handoff explicit until official access is established. |
| BigBasket / BB Now | No official public consumer MCP verified. Seek provider partnership/API documentation. |
| JioMart | No official public consumer MCP verified. Search results for products branded “MCP” are irrelevant. |
| Magicpin | Public claims found, but no verified official consumer endpoint/access contract. Do not onboard from an unverified short link or merchant-support endpoint. |
| Flipkart | Official seller API/SDK exists; that is not a consumer shopping/cart interface. No official consumer MCP verified. |
| Croma | No official retail MCP verified. “usecroma.com” is a different business and is not evidence for Tata Croma. |
| Reliance Digital | No official consumer MCP verified. |
| ONDC | Official MCP repositories exist, but the inspected repository listing/boilerplate does not prove a hosted consumer shopping service with ready buyer-network access. Evaluate an approved buyer integration separately. |

“Not verified” means the searches did not establish a supported public integration, not proof that no private partnership exists. This is a first shortlist of major requested categories, not an exhaustive inventory of every Indian app. Relevant primary sources: [Flipkart seller SDK](https://github.com/Flipkart/flipkart-seller-api-java-sdk), [ONDC MCP repository](https://github.com/ONDC-Official/ondc-mcp), [ONDC automation scaffold](https://github.com/ONDC-Official/automation-mcp).

## Build order

1. Swiggy Food and Instamart: one official provider onboarding covers the burger and grocery demo categories.
2. Zepto: second grocery provider and documented account-cart sync; use the same per-user connection model.
3. Amazon catalog: measured electronics price discovery/watch evidence. Do not imply catalog access grants checkout or cart access.
4. Zomato after explicit product-integration approval; then validate a genuinely comparable food basket.
5. Remaining apps only when a supported provider interface or a verified browser handoff is available.

## Required end-to-end contract

- Retrieve addresses through the authenticated provider session. Select a unique Home address when the request says home; clarify if ambiguous. Never assume an address ID from one provider works on another.
- Preserve one AskGogo task ID through location, login, selection, cart preparation and handoff. Keep credentials in per-user encrypted storage, outside prompts and task metadata.
- Represent each quote with provider, exact item/variant/quantity, address identity, currency, item amount, fees, discounts, payable total, availability, source and observation time. Missing fields remain unknown.
- Compare only equivalent baskets. Rank delivered totals only when the provider verified them. Menu price and cart total are different evidence levels.
- Cart changes require the user's actual instruction. Do not replace an existing cart silently to obtain a comparison. After a mutation, read back the exact item/quantity/address and payable total before reporting success.
- On an uncertain write, read back before retrying. Do not double-add or place duplicate orders.
- Return provider-supplied item/checkout links. Do not invent URL parameters claiming to prefill a cart. Test installed-app and browser-fallback behavior on the user's phone.
- User handles sign-in, OTP, CAPTCHA, payment authentication and final order confirmation. Initial integration should expose no automatic order-placement path.

## Burger incident repair in this branch

The Oct-1 request now has a food-comparison route ahead of generic model/search routing on WhatsApp and dashboard. It saves a task, asks for a missing Indian delivery PIN, and resumes that same task after the location reply. Recent explicitly supplied postal area can be reused; unrelated messages and expired handoffs are not claimed. Only the PIN is sent to search, not the street address.

Public first-party page discovery is an interim fallback. It returns matching provider links without promoting indexed snippets into live prices, proximity, discounts or cart evidence. The saved task stays paused with `provider_connection_required`. This fixes the false US recommendation path; it does NOT complete live food comparison or cart integration.

Verification: production build and TypeScript pass. The complete package test manifest passed when executed from a Bash script file; direct Windows `npm test` exceeded the command-length limit. The final affected test additionally drives the agent API location question and resumes its task through the WhatsApp handler. A live local search probe could not run because `TAVILY_API_KEY` is absent from the existing local environment. Provider-page retrieval and phone/cart acceptance are therefore not claimed as verified. No production secrets were downloaded for this work.

## Onboarding brief — prepared, not submitted

Product: AskGogo, a WhatsApp and web assistant at https://app.askgogo.in.

Use case: user-authorized India food/grocery discovery, retrieval of saved delivery addresses, comparison of verified prices and fees, explicit cart preparation and provider checkout handoff. No OTP collection in chat; no automatic purchases.

Requested initial servers: Swiggy Food and Instamart; Zepto consumer commerce. Request production-platform eligibility and exact OAuth callback approval before deployment. A proposed callback naming convention is `/api/integrations/{provider}/callback`; these routes are NOT implemented by this repair.

Still required from the owner/provider: legal organization/contact details, expected traffic, allowed callback URLs, product-integration approval and a staging demonstration. Do not submit invented details. No application, email or GitHub issue has been sent.

## Acceptance prompts

```text
Find me a veg burger nearest my house.. best and the cheapest one compare with all good delivery apps
```

After the location question:

```text
560086
```

Current expected result: same task, relevant provider-page links where found, honest incomplete comparison and no invented prices/distance/cart. This is a routing acceptance test, not cart acceptance.

After a provider is connected, the separate cart acceptance test is:

```text
Add one of the burger I selected to my cart using my saved Home address. Show the verified item, quantity and total, and give me the checkout link. Do not place the order or pay.
```

Pass only when provider readback and the phone's opened cart agree.
