Design and plan ONLY. Do not write any code until I approve the plan.

---

## GOAL

Implement a new unified "asset memory" flow in AskGogo for images, screenshots, PDFs and documents.

AskGogo should no longer behave like an OCR dump tool for uploaded images/documents. Instead, when a user sends a screenshot, image, or PDF and says things like "save this", "save this payment screenshot", "save Srini passport", "remember this document", it should:

1. classify the asset
2. store the original file
3. extract structured metadata
4. save a searchable memory
5. send a clean user-facing confirmation
6. allow natural-language retrieval later
7. return the original file or a signed URL when retrieved
8. mask sensitive data by default for identity/financial documents

---

## PRIMARY UX TO IMPLEMENT

### A) PAYMENT SCREENSHOT FLOW

User sends a bank-transfer/payment screenshot and says "save this payment screenshot" or "save this as Abdul Rahiman ₹51,000 payment proof".

AskGogo should:
- detect it is a PAYMENT PROOF / RECEIPT
- store the original image
- extract where possible: counterparty / paid to, amount, date, bank, payment method, reference number / transaction ID
- save searchable metadata + memory embedding
- reply with a concise confirmation like:

```
✅ Saved payment proof
Abdul Rahiman — ₹51,000
1 Sep 2026 · IMPS · SBI

I've saved the original screenshot and its details.

You can ask later:
- "Show me Abdul Rahiman payment proof"
- "Find the ₹51,000 payment screenshot"
- "What was the reference number?"
```

Do NOT suggest "add to calendar" for payment screenshots.

### B) PASSPORT / SENSITIVE DOCUMENT FLOW

User sends a passport PDF/image and says "save Srini passport" or "remember this passport".

AskGogo should:
- detect it is a PASSPORT / IDENTITY DOCUMENT
- store the original PDF/image
- extract structured metadata: document type, person name, passport number, DOB, issue date, expiry date, nationality
- BUT the WhatsApp response must NOT dump full OCR text
- mask sensitive fields by default in chat output

Expected confirmation style:

```
✅ Saved — Srini's Passport
Indian Passport · expires 15 Jun 2027

I've securely saved the original file and the passport details.

You can ask later:
- "Show me Srini passport"
- "When does Srini passport expire?"
- "Send me the original passport PDF"
```

Mask examples:
- passport number: R21••••9
- full address should not be echoed back by default
- DOB can be masked or omitted unless explicitly requested

### RETRIEVAL UX

Later, when the user asks "show me Abdul Rahiman payment proof", "find the ₹51,000 payment screenshot", "what was the reference number?", "show me Srini passport", "when does Srini passport expire?", "send me the original passport PDF":

AskGogo should:
- search the saved asset memories using semantic + metadata-based retrieval
- return a concise summary
- include the original file (or a signed URL / file link) wherever supported
- for sensitive docs, continue masking by default unless the user explicitly asks for a specific field

---

## CORE PRODUCT REQUIREMENTS

**1) UNIFIED ASSET TYPES.** Add or support a normalized asset classification system, at minimum: `payment_proof`, `passport`, `id_document`, `invoice`, `travel_ticket`, `event_poster`, `food_image_or_menu`, `generic_document`, `generic_image`. Implement via a new enum/string field, or structured metadata on notes/documents/memories. Choose the least disruptive clean option.

**2) STORE THE ORIGINAL FILE.** Preserve the original file in storage, associate it with the saved record, ensure it can later be returned via signed URL. Reuse existing document/file infrastructure rather than creating parallel storage flows.

**3) STRUCTURED METADATA EXTRACTION.** For each asset store: asset type, title / display title, summary, key entities, extracted date(s), keywords/tags, source file id / storage path / document id, privacy class (normal vs sensitive).

For payment proofs: amount, recipient / counterparty, date, bank, method, transaction/reference number.
For passports: name, passport number, DOB, issue date, expiry date, nationality.

**4) PRIVACY / MASKING RULES.** Sensitive asset types include at least: passport, id_document, bank statement, payment proof, insurance policy, tax/financial documents if detected.

- default chat confirmations must be concise and masked
- do NOT echo raw OCR dumps for sensitive documents
- do NOT echo full addresses, full ID numbers, full account numbers unless explicitly requested
- when explicitly requested, return only the requested field, not the whole OCR blob
- never expose stored credentials/password-like content in this flow

**5) RESPONSE TEMPLATES.** Replace raw "Document read" / "Image note read" dumps with intent-specific confirmations for at least: payment proof, passport / identity document, generic document, event poster, travel ticket, generic image note.

**6) EVENT POSTER RULE.** Calendar suggestions only when classification strongly indicates an event/poster/invite/ticket with date/time/venue semantics. Never for bank transfers, passports, IDs, receipts, menus.

**7) TITLE / FILING LOGIC.** Avoid ugly titles like "This is an Indian Passport belonging to Srinivas…". Use clean display titles: "Srini Passport", "Abdul Rahiman Payment Proof — ₹51,000", "Flight Ticket — Bangalore to Dubai", "Invoice — Vendor XYZ".

**8) NATURAL SAVE PHRASES.** Support "save this", "remember this", "save this screenshot", "save Srini passport", "keep this payment proof". Do not force special command syntax.

**9) RETRIEVAL IMPLEMENTATION.** Document indexing / memory retrieval infrastructure already exists. Wire the retrieval path so document/image hits do not come back as bare text only. When a result is a stored document/image, retrieve: display title, asset type, summary, signed file URL or equivalent. Use existing Supabase storage helpers.

---

## SCOPE LIMIT — READ THIS FIRST

Implement ONLY the unified save + retrieve-original-file flow, covering:
- `payment_proof`
- `passport` / `id_document`
- `generic_document` / `generic_image`
- classification routing so payment proofs and IDs never get a calendar suggestion

Explicitly OUT OF SCOPE for this pass, even if you see the need:
- reminder hooks off expiry dates — plan for it, do not build it
- `travel_ticket` and `event_poster` handling beyond correct classification
- any refactor of the existing ticket parsing path
- any change to nutrition/food image routing
- the two morning-briefing builders
- meter/quota enforcement

Get save + retrieve stable and verified first. Report anything you had to leave half-done so it can be picked up next.

Do not make preparatory code changes for out-of-scope items. You may only document extension points or TODOs for them. No schema fields, handlers, routes, or refactors solely for future requirements unless they are strictly necessary for the save/retrieve flow being implemented now — and if you judge something strictly necessary, say so explicitly in the plan with the reason, rather than including it silently.

---

## WORKING RULES

- BEFORE editing, inspect the codebase and report: (1) your implementation plan, (2) every file you intend to change, (3) any schema/storage changes you propose, (4) risks and assumptions.
- Do not start coding until I have approved the plan.
- Do not use PowerShell string-replacement scripts for patching files.
- After implementation run `npx tsc --noEmit` and any existing relevant tests.
- Keep changes as focused as possible. Do not refactor unrelated systems.

---

## CONTEXT YOU SHOULD NOT HAVE TO REDISCOVER

- **Most of the storage layer already exists.** `lib/services/document-store.ts` has `storeDocument()`, the private `user-documents` Supabase bucket, and `indexMemory({ sourceTable: 'documents' })`. `public.documents` already has 12 columns including `extracted jsonb` and `expires_on`. Reuse it — do not build a parallel store.

- **An image classifier already exists** at `app/api/webhooks/whatsapp/route.ts` ~481-492 returning TICKET / FOOD / DOCUMENT / OTHER, and a PDF equivalent in `lib/services/pdf-reader.ts`. Extend these; do not replace them. The travel ticket path works and has regressed before — route around it, don't modify it.

- **KNOWN UNFIXED BUG that affects this design:** the freeform LLM path surfaces stored `memories` content in chat when contextually relevant, including credentials. So masking in the save confirmation is not sufficient on its own. Sensitive values must NEVER reach `indexMemory` — index the LABEL only ("Srini passport number"), never the value. Flag anywhere this rule is hard to guarantee.

- **Live example of the problem being fixed:** a learner's licence saved 23 Aug pulled DOB, blood group, full home address and licence number into a plaintext note and echoed all of it in chat — for a third party, not the account holder.

- Supabase project ref: `qenhjcooyecmatwducpu`. Migrations are run by the user in the SQL editor, not by you.

---

## ACCEPTANCE CRITERIA

1. **Payment screenshot saved.** "save this payment screenshot" → original file stored, classified `payment_proof`, concise confirmation, no calendar suggestion, later retrieval by amount/person/date/reference works.
2. **Passport saved.** "save Srini passport" → original stored, classified `passport`, masked confirmation, no full OCR dump, later retrieval by person/document type works.
3. **Generic document saved.** "remember this document" → original stored, concise title + summary, retrieval returns original file.
4. **Retrieval.** "show me the ₹51,000 payment screenshot" → finds the asset, returns summary + original file link.
5. **Sensitive default masking.** No full passport number, full address or full account number echoed in normal save confirmations.

---

## DELIVERABLE FORMAT

1. First output: implementation plan, file list, schema/storage changes, risks and assumptions. **Then stop and wait for approval.**
2. Then implement.
3. Then show: what changed, any migrations, how to test manually, typecheck results.
