# 03 — App flow: askgogo.in waitlist

End-to-end flows for the three mockup states. Reads with 01-PRD (states) and 04-UI-UX-BRIEF
(behaviour detail).

---

## 1. State machine

```
        arrive
          │
          ▼
   ┌──────────────┐   tap any "Join Gogo" CTA
   │  S1  SITE    │──────────────────────────────►┌──────────────┐
   │  browsable   │                                │  S2  FORM    │
   │  no gate     │◄───────────────────────────────│  sheet open  │
   └──────────────┘   close (X / Esc / backdrop*)  └──────┬───────┘
          ▲                                                │ submit (valid OR already-registered)
          │                                                ▼
          │                                         ┌──────────────┐
          └─────────────────────────────────────── │  S3  DONE    │
              close → returns to S1                  │ "on the list"│
                                                     └──────────────┘
   * backdrop tap closes on mobile bottom sheet; on desktop modal, backdrop click closes too,
     but Escape is the documented keyboard path (04).
```

Only **S1** is a real URL. S2/S3 are overlays over S1 — **no route change**, no history entry that
strands the user on a blank sheet (browser Back from S2 returns to S1 scroll position; see §5).

## 2. S1 → S2: opening the sheet

**Triggers (all open the same sheet):**
- Header **"Join Gogo"** pill.
- Hero **"Join Gogo"** button.
- **Any** element that used to be a direct-WhatsApp link (rewired per 02-TRD §2). After rewiring
  there is no other WhatsApp entry point.

**On open:**
1. Dim the site (backdrop over S1).
2. Mount the sheet: bottom sheet (<768px) or centred modal (≥768px) — 04.
3. Move focus to the first focusable control (the country select), trap focus inside the sheet.
4. Record the invoking element so focus can return to it on close.

**The one link that is NOT the sheet:** "Already using AskGogo? Open your dashboard" →
`https://app.askgogo.in` (normal navigation, opens the product). Present in the sheet header/footer
and/or the site header so existing users are never funnelled into the waitlist.

## 3. S2: the form

**Layout order (top→bottom):** title → country select (+91 default / +971) → WhatsApp number →
email → opt-in checkbox (unticked) → **Join Gogo** submit → consent line → (hidden honeypot).

**Client validation (UX only — server is source of truth, 02-TRD §3):**
- On blur and on submit, validate each field; show **inline error under the field**.
- IN number: 10 digits 6–9. UAE number: 9 digits starting 5. Email: standard format.
- Submit disabled only while a request is in flight (never disabled purely on pristine state — the
  server still re-checks; but do block double-submit).

**Submit sequence:**
1. Client validation passes → serialize `{ country, phone, email, whatsapp_opt_in, company(honeypot) }`.
2. `POST` to the endpoint (02-TRD §1/§4).
3. **Any of these → S3 success:** `200/201` for a new row, OR a duplicate number (server upserts and
   returns success), OR a honeypot hit (server returns success shape, writes nothing).
4. **Field/validation error from server (`400`)** → show inline error(s), stay in S2.
5. **Network/`5xx` error** → show one non-field error line ("Something went wrong — try again"),
   stay in S2, keep the entered values.

## 4. S2 → S3: success

- Swap the sheet **body** (not the whole overlay) to the **"You're on the list"** confirmation.
- Keep the site dimmed behind.
- Confirmation content: a short line acknowledging they're on the list; if they ticked opt-in, note
  we'll message them on WhatsApp when their invite is ready; a close button; the "Open your
  dashboard" link remains available.
- **Never** state whether the number was already registered — S3 is identical for new and duplicate.

## 5. Closing (any state) → S1

- Close via: **X button** (≥44px), **Escape** (desktop), **backdrop tap/click**.
- On close: unmount sheet, remove backdrop, **return focus to the invoking CTA**, restore S1 scroll
  position. No page reload.

## 6. Error & edge flows

| Case | Behaviour |
|---|---|
| Invalid IN/UAE number | inline error under the number field; no request sent |
| Invalid email | inline error under email; no request sent |
| Already-registered number | **S3 success** (upsert updates email/opt-in server-side); no hint of prior membership |
| Honeypot filled (bot) | **S3 success** shape returned; **nothing written** |
| Opt-in left unticked | valid; row written with `whatsapp_opt_in=false`; **never messaged on WhatsApp** |
| Server `5xx` / offline | non-field error line; values preserved; user can retry |
| JS disabled | sheet cannot open; **fallback** = the CTA is a real link/anchor to a static "join" section or `mailto`/dashboard? **Open decision — see report Q5.** Do not assume. |
| Existing user | uses "Open your dashboard" → app.askgogo.in; never enters the waitlist |

## 7. What the flow must never do

- Never gate S1. Never auto-open the sheet on arrival.
- Never expose a wa.me / whatsapp:// link anywhere on askgogo.in.
- Never send a WhatsApp message to a user who did not tick opt-in.
- Never reveal registration status.
- Never put `SUPABASE_SERVICE_ROLE_KEY` (or any secret) into client code (02-TRD §5).
