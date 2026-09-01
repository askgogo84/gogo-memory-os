We tested the new asset-memory flow on real WhatsApp. Do NOT add new features yet. Fix the regressions exposed by this end-to-end test.

Before editing, trace the exact routing/data flow for each case below and report the files/functions involved.

---

## PRIORITY

**Case 3 is BLOCKING and comes first.** Full passport numbers, DOB and place of birth were returned into a WhatsApp thread, which persists in the user's cloud chat backup. Trace and fix that before touching Cases 1, 2, 4 or 5.

Report the leak path — specifically whether the reply came from `buildAssetRetrievalReply` rendering `extracted.fields` unmasked, or fell through to freeform — before you change anything.

---

## CASE 1 — SAVE COMMAND BEFORE MEDIA

**Observed:** User sends "save this". AskGogo replies asking for the item. User then sends an image. The image falls into the OLD "Saving as a note..." / "Image note read" flow.

**Required:** Support a short-lived pending asset intent.

When the user says "save this" / "remember this" / "keep this" and no media is attached or referenced yet, store a pending action for that user (e.g. `pending_asset_action = save`) with a sensible short TTL / one-next-media semantics.

The NEXT image/PDF/document from that user must be routed through `tryHandleAssetSave` BEFORE the legacy image/document note response. Clear the pending action after successful use or expiry.

Do not create permanent database state if existing conversation/session state already has an appropriate mechanism.

---

## CASE 2 — MEDIA FIRST, SAVE COMMAND SECOND

**Observed:** User sends an image. AskGogo immediately generates the legacy OCR "Image note read". User then says "save this payment screenshot".

**Required:** Natural conversation must support BOTH directions — command → media, and media → command.

For a save command received shortly after an image/PDF, resolve "this" to the user's immediately preceding media/document. Do not require the user to resend the file. The original media id / storage path must remain available long enough for this follow-up.

If the media has already been automatically analyzed, reuse the existing result where possible instead of making another expensive vision call.

---

## CASE 3 — SENSITIVE RETRIEVAL IS LEAKING FULL VALUES (BLOCKING)

**Observed:** "save Srini passport" gives the new concise masked save confirmation — good. But "show me Srini passport" returned:

```
Passport Number: S5863938
Date of Birth: 04/08/1983
Place of Birth: BANGALORE, KARNATAKA
```

Full number, full DOB, full place of birth. The SAVE path masks correctly; the RETRIEVAL path does not. Masking is applied on one path only.

**Required:** Fix `buildAssetRetrievalReply` so sensitive documents are MASKED BY DEFAULT on retrieval as well as on save.

For passport / ID / sensitive financial documents:
- NEVER return raw `documents.extracted` wholesale
- never dump all extracted fields
- full passport / account / ID numbers must remain masked
- omit address, DOB and birthplace by default
- show only minimum useful metadata

Expected default:

```
📄 Srini's Passport
Indian Passport · expires 15 Jun 2027
Passport no. S58••••8

[original file]

Ask me for a specific detail if you need it.
```

Specific field requests such as "what is Srini's passport number?" may go through `buildAssetFieldReply`, but return ONLY the requested field. Do not return the rest of the extracted metadata.

**On an extra confirmation step for field requests: do not build one.** WhatsApp has no second factor, so a confirmation prompt is security theatre — anyone holding the unlocked phone taps yes. The real protections are returning one field rather than the blob, and logging the access. Add the logging; skip the prompt.

---

## CASE 4 — "SHOW ME" MUST RETURN THE ORIGINAL

**Observed:** "show me Srini passport" returns text and says "Need the original PDF? Just ask...".

**Required:** "show me <asset>" should itself return the saved original.

Per the earlier decision, sensitive assets return a **short-TTL signed URL in the reply text**, not a WhatsApp media attachment — a media send puts the document permanently into the user's chat backup and Twilio's CDN. Include that link in the same response; do not force a second "send me the original" command.

Keep "send me the original..." as an additional supported phrase, not a requirement.

---

## CASE 5 — CROSS-TURN STATE CONFUSION

**Observed in the same test:** after saving the jewellery order slip, AskGogo replied "Saved, boss! Your Jopasu car care product payment is now in memory." Jopasu was the PREVIOUS image, two turns earlier. Something is binding to stale media or stale conversation state.

This matters more once Cases 1 and 2 add pending-media resolution — if "this" already binds to the wrong media, more ways to resolve "this" will multiply the error.

Find the cause **before** implementing the pending-intent mechanism, and make sure any pending state is keyed to a **specific message id**, not "the most recent media".

**Also:** in the test the bot ASKED the user to type their passport number and expiry into chat — "I need the actual passport number and expiry date. Can you share those details?". Never solicit sensitive values as chat text. If extraction fails, say the document was saved but some fields could not be read, and stop there.

---

## CLASSIFICATION CORRECTION

Our real test image was an ORDER ESTIMATION SLIP, but the user called it a "payment screenshot". It was not classified as `payment_proof` — it fell to the old summariser and dumped full OCR including customer name, amounts and dates. It also got "Reply add to calendar to create this event" because the slip had a due date.

Do not let the user's save label completely override document evidence. Store separately:
- **detected asset type** (from vision evidence)
- **user label / user tags** (from their wording, kept for retrieval)

If vision evidence says "order_estimate" or "invoice/estimate" and there is no evidence of completed payment, do NOT classify it as `payment_proof` merely because the user says "payment screenshot".

Add these types if needed, without broad refactoring: `order_estimate`, `receipt`.

And per the original scope: calendar suggestions only for genuine events. A receipt or estimate with a due date is not an event.

---

## LEGACY UX

The end goal is that explicit save flows should NOT first produce "Saving as a note..." / "Image note read" / a huge OCR dump.

If an explicit save intent exists, the new asset-memory handler must claim the turn before that legacy response is sent.

Do not break normal image understanding for users who merely send an image and are NOT asking to save it.

---

## TEST MATRIX — MUST VERIFY

1. `"save this"` then `[product image]` → one concise asset saved response, NO "Saving as a note...", retrievable later
2. `[document/image]` then `"save this"` → preceding media resolved, saved without resend
3. `[passport PDF]` then `"save Srini passport"` → concise masked save confirmation
4. `"show me Srini passport"` → concise MASKED summary, original PDF signed URL included, NO full passport number / DOB / address
5. `"what is Srini passport number?"` → only the requested value, no other private fields leaked
6. `"show me my lease agreement"` → the matching document if it exists, null/fall-through if not
7. `"show me weather"` / `"show me groceries"` → asset handler must NOT hijack them
8. Order estimate labelled by user as "payment screenshot" → detected type stays `order_estimate`/`receipt`, user's wording retained as a tag

---

## AFTER IMPLEMENTATION

- `npx tsc --noEmit` — report only NEW errors caused by your changes
- report every file changed
- show exact routing traces for tests 1–8
- do not deploy automatically
