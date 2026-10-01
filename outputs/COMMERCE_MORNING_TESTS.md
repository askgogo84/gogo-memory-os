# Commerce morning acceptance — draft, not a live-readiness claim

The new commerce branch is not deployed yet. Run these only after the release report names the production commit. Provider access/callback approval and your sign-in are separate prerequisites. Current implementation reaches account connection and saved-address selection in fixtures; Food catalogue reads are now wired after address selection, but delivered-total and cart execution are still unfinished.

## 1. Start a comparison on WhatsApp

```text
Find me a vegetarian burger near PIN 560086, Bengaluru. Compare available delivery options and report only verified information. Do not add anything to a cart or place an order.
```

Expected: Indian location retained, honest evidence limits, a link to this comparison. No US restaurants, invented distances/prices or cheapest-total claim without evidence.

## 2. Open the comparison link

Sign in to AskGogo if needed. The page must show the original burger comparison. If it says provider approval is required, that is the current external blocker: stop here. Do not repeatedly attempt sign-in or send OTPs in chat.

## 3. Connect your account — only after provider approval

Choose Swiggy for the restaurant-food task. Complete sign-in on Swiggy's own page. Returning to AskGogo must preserve the original comparison. If already connected, use that account without another sign-in.

Expected: choose a saved delivery address. Account connection alone must not claim prices or cart success.

## 4. Select a saved address

Choose the actual saved address you want. If several addresses say Home, use the displayed address lines to distinguish them. Selection must be confirmed only after provider readback succeeds. Full street and phone are not copied into task metadata.

After selecting an address, expect Swiggy restaurant options from a fresh provider read. Choose an offered restaurant to read matching available items. Closed restaurants and unavailable/non-vegetarian items must not appear in the vegetarian options. Menu prices and delivery totals are explicitly unverified until their evidence exists. A provider failure must preserve the task and show a retry/sign-in/address action rather than invent results.

## 5. Check the same task from WhatsApp

```text
Show my food comparison.
```

Expected: same progress and next action as the dashboard. After a successful provider catalogue read, it names the same options and check time. Prices, delivered totals and cart preparation remain unverified. That is not an end-to-end pass.

## Remaining end-to-end acceptance — OPEN

- Instamart and Zepto: connect each account, explicitly confirm equivalent delivery locations and the same product/variant/quantity.
- Read availability, item price, fees, discounts and final payable total from providers, with timestamps. Unknown fees remain unknown; no cheapest delivered claim when a comparable total is missing.
- User explicitly selects an actual provider item/quantity before a cart change. Preserve unrelated existing items. Verify the cart by reading it after the change; do not blindly retry an unknown outcome.
- Open the returned verified provider link on your phone and confirm the correct account, address, item, variant and quantity. Installed-app opening alone does not prove the cart matches.
- WhatsApp and dashboard must show that same verified outcome. No order or payment is executed.

No current live item IDs, prices or cart links have been obtained, so none are fabricated here as test inputs.
