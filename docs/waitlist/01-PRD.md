# 01 — PRD: askgogo.in waitlist

**Status:** draft for build · **Docs-only run:** 19 Sep 2026 · no site code/config changed here.
**Approved mockup (hard constraint):** https://claude.ai/artifact/HQaGjw9gB8gfg3jjU3XXPF — three
states: (1) site fully browsable, no gate; (2) any "Join Gogo" CTA opens a bottom sheet over the
dimmed site with the waitlist form; (3) the same sheet shows "You're on the list".

---

## 0. Repo-reality caveat (read before anything else)

This doc set is written against the repository `askgogo84/gogo-memory-os`. The survey in §Step-0 of
the accompanying report establishes one fact that changes how these docs are scoped:

> **This repo is `app.askgogo.in` (the product/dashboard app), not the `askgogo.in` marketing site.**
> `app/layout.tsx:29,41` sets `metadataBase`/OpenGraph URL to `https://app.askgogo.in`, and the
> comment at `app/layout.tsx:11-12` names "the handoff from askgogo.in to app.askgogo.in" as two
> surfaces. The only public page in this repo is `app/page.tsx` — a one-screen splash with a single
> WhatsApp CTA. There is **no** browsable marketing site, **no** pricing page/plan cards, **no**
> nav/footer, and **no** sitemap in this repo.

Consequence for these docs:

- The **backend** (`POST /api/waitlist`, Phase 2) is grounded firmly here — this repo already hosts
  ~39 serverless route groups under `app/api/**`, so it can host the endpoint with no structural
  change (see 02-TRD §1).
- The **site-side** work (Phase 3 sheet/CTA/hero, Phase 4 pricing removal/redirects/sitemap) targets
  the **askgogo.in marketing site**, whose source is **not present in this repo**. Wherever that
  source lives is an **open question for the owner** (see §8 and the report). These docs specify the
  target behaviour precisely; they do not assume the marketing markup exists here.

Nothing below waters down the product decisions — it only names where each one is applied.

---

## 1. Goal

Convert askgogo.in from a "message the bot now" front door into a **waitlist front door**, without
gating the site. Every visitor can read everything; the only way *in* to the assistant for a new
person is to join the waitlist. Existing users are never blocked.

**Why:** the WhatsApp bot is invite-paced (capacity, quality-of-first-run). A public wa.me link lets
anyone skip the waitlist and land on the bot cold. The waitlist is the throttle.

## 2. Non-goals

- No account creation, no login on the marketing site.
- No phone-verification (OTP) at this stage (explicitly deferred — see FORM below).
- No pricing on the public site at all (removed, not replaced).
- No change to the WhatsApp bot, the dashboard, or product pricing config (`lib/pricing/*`).

## 3. Principles (hard decisions — encoded in every doc)

1. **Site-first. No gate on arrival.** Visitors browse everything. The waitlist is opt-in via CTA.
2. **One CTA, one destination.** Every call-to-action reads **"Join Gogo"** (header pill + hero
   button) and opens the **waitlist sheet**. No CTA copy variants.
3. **No direct path to the bot.** Every direct-WhatsApp link (wa.me / api.whatsapp.com / whatsapp://
   / "Chat on WhatsApp" / "Message Gogo on WhatsApp") is **rewired to open the sheet**. After this
   change **no path on askgogo.in may reach the WhatsApp bot directly.** (In this repo the only such
   link is `app/page.tsx:5-8,29,32`; see 02-TRD §2 and the report 0b.)
4. **Existing users are never blocked.** Keep **"Already using AskGogo? Open your dashboard"** linking
   to **https://app.askgogo.in**. This is the one outbound link that is *not* the sheet.
5. **No pricing, anywhere public.** Remove all pricing sections/plan cards/prices; **no replacement
   line**. Pricing URLs **301-redirect to `/`** via `vercel.json`; remove them from the sitemap and
   from nav/footer. (In this repo there is no public pricing to remove — see §0 and report 0c.)
6. **Fail-safe on submit.** A number already on the list shows the **same success state** — never
   reveal whether a number is registered.

## 4. The three states (from the mockup)

| State | Trigger | What the user sees |
|---|---|---|
| **S1 — Site** | Arrival | The full site, fully browsable, no overlay, no gate. Header shows a "Join Gogo" pill; hero shows a "Join Gogo" button and the "Open your dashboard" link. |
| **S2 — Form** | Tap any "Join Gogo" CTA (or any rewired ex-WhatsApp link) | A **bottom sheet** (mobile) / **centred modal** (≥768px) slides up over the **dimmed** site, containing the waitlist form (country + WhatsApp number, email, opt-in checkbox, consent line, submit). |
| **S3 — Done** | Successful submit (incl. already-registered) | The same sheet swaps its body to **"You're on the list"** confirmation. Site remains dimmed behind; closing returns to S1. |

## 5. Hero copy (exact — bold first paragraph, then two regular paragraphs)

> **P1 (bold):** AskGogo is a personal assistant that understands what is on your plate and what
> matters to you. It connects to what you already use: WhatsApp, email, your calendar and your
> documents.
>
> P2: There is nothing new to learn and nothing to install. It lives in WhatsApp, and you talk to it
> the way you would text a friend.
>
> P3: It is built for the small, personal details that fill a day: reminding you before a bill is
> due, briefing you every morning, keeping your tickets and receipts where you can find them,
> tracking what you spend, and making sure the things you meant to do actually get done.

**PENDING VERIFICATION — the word "email" in P1.** P1 claims AskGogo "connects to … email". This
must be verified against the shipped Gmail capability before launch. If the Gmail check **fails**,
**remove the word "email"** from P1 (and only that word), leaving: "…what you already use: WhatsApp,
your calendar and your documents." Evidence for the check: OAuth connect is wired
(`verify-google-workspace-oauth.mts`), Gmail read/draft exist (`lib/services/google-gmail.ts`,
`lib/bot/handlers/email-actions.ts`), but the **send path is untested** and **production OAuth-scope
verification is an open launch blocker** (capability audit §2D). The go/no-go on the word "email" is
the owner's call at launch, not this doc's.

## 6. The waitlist form (product spec; validation detail in 05-BACKEND-SCHEMA)

**Fields (both required):**
- **WhatsApp number** with a **country select**: **+91 India (default)** and **+971 UAE**.
- **Email.**

**Rules (enforced client-side for UX *and* server-side as the source of truth — 02-TRD §3):**
- India: **10 digits starting 6–9**. UAE mobile: **9 digits starting 5**. Store as **E.164**.
- Email: **standard format**, **lowercased**, **trimmed**.

**WhatsApp opt-in checkbox — UNTICKED by default:** "Message me on WhatsApp when my invite is ready."
**We never message anyone on WhatsApp who did not tick it.** (Stored as `whatsapp_opt_in`.)

**Consent line under the button (exact):** "By joining you agree to our Terms and acknowledge our
Privacy Policy. You can ask us to delete your details at any time." (Stored consent version — 05.)

**Behaviour:**
- **Inline errors per field.**
- **Already-registered number → same success state** (never reveal membership).
- **Hidden honeypot field** for bots (server rejects if filled — silently returns success shape).
- **No phone verification code** at this stage.

## 7. Success criteria (testable — full matrix in 06 Phase 5)

- Site loads with **no gate**; every "Join Gogo" opens the sheet; the dashboard link still goes to
  app.askgogo.in.
- **Zero** direct-to-bot links remain reachable from askgogo.in.
- Valid IN and UAE submissions write one row each to `public.waitlist` (E.164, correct `country`).
- Invalid inputs show inline errors and **do not** submit.
- Duplicate number returns success and **updates** email/opt-in (upsert), no duplicate row.
- Honeypot-filled submission returns the success shape and writes **nothing**.
- No pricing is reachable publicly; pricing URLs 301 to `/`; sitemap has no pricing entry.
- Rendered at **375px** and at **≥768px** per 04-UI-UX-BRIEF, including keyboard/focus behaviour.

## 8. Open dependencies (do not decide here — see report questions)

1. **Where is the askgogo.in marketing-site source?** Not in this repo. The site-side phases (P3/P4)
   need it. (Report Q1.)
2. **Same-origin or cross-origin POST?** If the site is served from this repo → same-origin
   `/api/waitlist`. If it is a separate deployment → the site POSTs cross-origin to
   `https://app.askgogo.in/api/waitlist`, which needs a CORS allowlist for `https://askgogo.in`.
   (02-TRD §4; Report Q2.)
3. **Plan-name mismatch:** the task named plans "Free, Lite, Pro, Power"; the repo's actual India
   plans are **Essential ₹249 / Plus ₹499 / Pro ₹999** (`app/pay/page.tsx:7-9`,
   `lib/pricing/gogo-plans.ts`). Pricing removal is unaffected, but flagged. (Report Q3.)
4. **Terms / Privacy Policy pages** must exist for the consent line to link to. Not found in this
   repo. (Report Q4.)
