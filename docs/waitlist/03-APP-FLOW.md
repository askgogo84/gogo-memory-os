# 03 — App flow: askgogo.in waitlist (two-repo)

End-to-end flows for the three mockup states. Reads with 01-PRD and 04-UI-UX-BRIEF. The **front-end
flow runs on askgogo.in** (site repo); the **submit crosses to app.askgogo.in/api/waitlist**.

---

## 1. State machine

```
        arrive (askgogo.in)
          │
          ▼
   ┌──────────────┐  tap any "Join Gogo" / rewired ex-WhatsApp CTA
   │  S1  SITE    │───────────────────────────────►┌──────────────┐
   │ 16-chapter   │                                 │  S2  FORM    │
   │ immersive    │◄────────────────────────────────│  sheet open  │
   │ no gate      │  close (X / Esc / backdrop)      └──────┬───────┘
   └──────────────┘                                         │ submit → cross-origin POST
          ▲                                                 ▼  app.askgogo.in/api/waitlist
          │                                          ┌──────────────┐
          └───────────────────────────────────────── │  S3  DONE    │
             close → returns to S1                     │ "on the list"│
                                                       └──────────────┘
```

S2/S3 are overlays over S1 — **no route change** (important: the site is one immersive page loaded by
`index.html`; opening the sheet must not navigate). Browser Back from S2 returns to S1 scroll
position.

## 2. S1 → S2: opening the sheet

**Triggers (all open the same sheet):**
- Header **"Join Gogo"** pill (was "Talk to Gogo", `part-00.htmlfrag:64`) → `source=askgogo.in:header`.
- Hero **"Join Gogo"** button (was "Meet Gogo", `part-00.htmlfrag:94`) → `source=askgogo.in:hero`.
- Menu drawer entry (was "Talk to Gogo", `part-00.htmlfrag:80`) → `source=askgogo.in:menu`.
- **Any** other element whose href matches WhatsApp (interceptor, 02-TRD §2).

**Mechanism (safe — 02-TRD §6):** `waitlist.js` adds a capturing `document` click listener; when the
target matches a Join CTA or a WhatsApp href, it `preventDefault()`s and opens the sheet. No runtime
edit.

**On open:** dim the site (backdrop); mount the sheet (bottom sheet <768px / centred modal ≥768px);
move focus to the country select; trap focus; remember the invoking element.

**The one link that is NOT the sheet:** "Open dashboard" → `https://app.askgogo.in`
(`part-00.htmlfrag:63,78`) — normal navigation; existing users are never funnelled into the waitlist.

## 3. S2: the form

Order: title → country select (+91 default / +971) → WhatsApp number → email → opt-in checkbox
(unticked) → **Join Gogo** submit → consent line → hidden honeypot.

**Client validation (UX only; server is source of truth — 02-TRD §5):** on blur + submit; inline
error under each field. IN 10 digits 6–9; UAE 9 digits starting 5; email standard format. Block
double-submit while a request is in flight.

**Submit sequence:**
1. Serialize `{ country, phone, email, whatsapp_opt_in, source, company(honeypot) }`.
2. `POST https://app.askgogo.in/api/waitlist` (cross-origin; CORS allows askgogo.in — 02-TRD §4).
3. **→ S3 success** on: `200` new row, OR duplicate (server upserts, returns success), OR honeypot
   (server returns success shape, writes nothing).
4. **Server `400`** → show inline field error(s), stay in S2.
5. **Network / CORS / `5xx`** → one non-field error line, stay in S2, keep entered values.

## 4. S2 → S3: success

Swap the sheet **body** to **"You're on the list"**; site stays dimmed behind. If opt-in was ticked,
note we'll message on WhatsApp when the invite is ready. Close button present; "Open dashboard"
remains available. **Identical for new and duplicate** — never reveal prior membership.

## 5. Closing → S1

Close via **X (≥44px)**, **Escape** (desktop), or **backdrop**. On close: unmount sheet, remove
backdrop, **return focus to the invoking CTA**, restore scroll. No reload.

## 6. Error & edge flows

| Case | Behaviour |
|---|---|
| Invalid IN/UAE number | inline error; no request |
| Invalid email | inline error; no request |
| Already-registered number | **S3 success** (server upserts email/opt-in); no hint of prior membership |
| Honeypot filled | **S3 success** shape; **nothing written** |
| Opt-in unticked | valid; `whatsapp_opt_in=false`; **never messaged on WhatsApp** |
| CORS/`5xx`/offline | non-field error; values preserved; retry |
| JS disabled / fragment load fails | sheet cannot open; `index.html:36/:59` fallback shows — currently WhatsApp links (OPEN, repoint per 02-TRD §2 L5/L6) |
| Existing user | "Open dashboard" → app.askgogo.in; never enters waitlist |
| Direct WhatsApp message to `17605483659` | **out of website scope** — governed by the OPEN DECISION in 01-PRD §6 |

## 7. The flow must never

- Gate S1; auto-open the sheet on arrival; navigate away when opening the sheet.
- Expose a wa.me / api.whatsapp.com / whatsapp:// link that reaches the bot from the live site
  (subject to L5/L6 fallback decision).
- Message a user who did not tick opt-in.
- Reveal registration status.
- Put `SUPABASE_SERVICE_ROLE_KEY` (or any secret) in client code — the browser only calls the
  endpoint (05 §5).
