# 01 — PRD: askgogo.in waitlist (two-repo)

**Status:** draft for build · **Docs-only run:** 19 Sep 2026 · no code/config/content changed in
either repo. · **Supersedes** the single-repo v1 of this doc (commit `dadffad`).
**Approved mockup (flow, fields, copy):** https://claude.ai/artifact/HQaGjw9gB8gfg3jjU3XXPF —
three states: (1) site fully browsable, no gate; (2) any "Join Gogo" CTA opens a bottom sheet over
the dimmed site with the waitlist form; (3) the same sheet shows "You're on the list".

---

## 0. The two-repo split (the correction this rewrite encodes)

| Concern | Repo | Deploys to |
|---|---|---|
| **Backend** — migration + `POST /api/waitlist` + CORS + validator test | **`askgogo84/gogo-memory-os`** (THIS repo) | `app.askgogo.in` |
| **Front end** — sheet, CTA rewiring, copy, pricing removal, redirects, sitemap | **`askgogo84/askgogo-main`** (`C:\Users\gover\askgogo-main`) | `askgogo.in` (a push to its `main` deploys the site) |

The endpoint lives on **app.askgogo.in**; the site is **askgogo.in** → the browser call is
**cross-origin** (02-TRD §4, 05 §6). `askgogo-main` is **never edited, committed or pushed** by these
docs; all site changes are specified here and executed there on a branch, verified on its Vercel
preview, then merged by the owner.

## 1. Goal & principles

Convert askgogo.in from "message the bot now" into a **waitlist front door** without gating the site.

1. **Site-first. No gate on arrival.** Every visitor browses the whole immersive page.
2. **One CTA, one destination.** Every call-to-action reads **"Join Gogo"** and opens the **waitlist
   sheet**. Every direct-WhatsApp link found in the survey (§Report 1b) is **rewired to open the
   sheet**. After this, **no path on askgogo.in reaches the WhatsApp bot directly** (subject to the
   OPEN DECISION in §6).
3. **Existing users are never blocked.** Keep **"Open dashboard"** → `https://app.askgogo.in`
   (`part-00.htmlfrag:63,78`). That is the one link that is not the sheet.
4. **No pricing on the marketing site.** Remove the pricing chapter/cards/prices, **no replacement
   line**; 301 pricing URLs to `/`; drop pricing from the sitemap and the nav menu. **App pricing
   (`/pay`, `/upgrade`, dashboard usage in THIS repo) is UNTOUCHED** — existing users need it.
5. **The app.askgogo.in root CTA is also a bypass and is repointed** (§Report 1h): `app/page.tsx`
   wa.me CTA → `https://askgogo.in` (Phase 5).
6. **Fail-safe submit.** A number already on the list shows the **same success state** — never reveal
   whether a number is registered.

## 2. The three states (from the mockup)

| State | Trigger | What the user sees |
|---|---|---|
| **S1 — Site** | Arrival | The full immersive 16-chapter page, browsable, no overlay. Header shows a "Join Gogo" pill + "Open dashboard". |
| **S2 — Form** | Tap any "Join Gogo" CTA (or any rewired ex-WhatsApp CTA) | **Bottom sheet** (mobile) / **centred modal** (≥768px) over the dimmed site: country select (+91/+971), WhatsApp number, email, opt-in checkbox, "Join Gogo" submit, consent line. |
| **S3 — Done** | Successful submit (incl. already-registered) | The same sheet swaps its body to **"You're on the list"**. Closing returns to S1. |

## 3. Hero copy (exact — bold P1, then two regular paragraphs)

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

**PENDING VERIFICATION — the word "email" in P1.** Verify against the shipped Gmail capability before
launch. If the Gmail check **fails**, remove only the word "email" → "…what you already use:
WhatsApp, your calendar and your documents." Evidence in the app repo: OAuth wired
(`verify-google-workspace-oauth.mts`), read/draft exist, **send path untested**, production OAuth
scope is an open launch blocker (capability audit §2D). Owner's go/no-go at launch.

**Placement is an OPEN PROPOSAL — see 04-UI-UX-BRIEF §8** (two options against the real chapter
structure; not decided here).

## 4. Form (product spec; validation in 05)

- **Fields (both required):** WhatsApp number with **country select — +91 India (default), +971 UAE**;
  and **email**.
- **Rules:** IN = 10 digits starting 6–9; UAE = 9 digits starting 5; store **E.164**. Email standard
  format, **lowercased, trimmed**.
- **WhatsApp opt-in checkbox — UNTICKED by default:** "Message me on WhatsApp when my invite is
  ready." **Never message anyone on WhatsApp who did not tick it.**
- **Consent line under the button (exact):** "By joining you agree to our Terms and acknowledge our
  Privacy Policy. You can ask us to delete your details at any time." — **Terms** →
  `https://askgogo.in/terms/`, **Privacy Policy** → `https://askgogo.in/privacy/` (§Report 1f).
- **Inline errors per field.** **Already-registered number → same success state.** **Hidden honeypot
  field** for bots. **No phone-verification code** at this stage. **JS is required** (the page
  already requires JS to render — §Report 1a — so this is acceptable).

## 5. Data captured

Table `public.waitlist` (05 §1). Notable values fixed by decision:
- `source = 'askgogo.in:<cta-id>'`, e.g. `'askgogo.in:header'`, `'askgogo.in:hero'`,
  `'askgogo.in:menu'` — identifies which CTA opened the sheet.
- `consent_version = '2026-09-19'`.
- **No IP address stored.**

## 6. OPEN DECISION — record, do not decide

> **The WhatsApp number `17605483659` is public.** It appears in `og:`/noscript fallbacks, in the
> site's data model (`stage-07.htmlfrag:2` `links.whatsapp`), across legacy pages, and anyone who has
> ever messaged it — or reads it anywhere — can message the bot **directly, regardless of the
> website.** The waitlist gates **website visitors only.**
>
> **Undecided:** should the WhatsApp bot **reply fully to numbers that are not on the waitlist / not
> invited?**
> - **If yes** — the waitlist is a *website* funnel only; direct messagers get the full product. The
>   throttle is soft.
> - **If no** — the bot must check inbound numbers against `public.waitlist` / an invite state and
>   hold non-invited numbers (e.g. "You're on the list — we'll message you when your invite is
>   ready"). That is bot-side work in THIS repo's webhook path, **out of scope** for this build, and
>   would need its own spec.
>
> This decision changes what "waitlist" means. **Left to the owner.** (See Report Q.)

## 7. Open dependencies / questions (see Report)

1. Copy placement (two options, 04 §8) — not decided.
2. Legacy `.dc.html` pages: rewire vs 301 per page (02-TRD §3, Report) — not decided.
3. Pricing removal method on the immersive page: fragment edit vs injected CSS/JS hide (02-TRD §5) —
   not decided.
4. The OPEN DECISION in §6.
5. noscript/error-fallback WhatsApp links in `index.html:36,59` — cannot open a JS sheet; repoint or
   leave? (02-TRD §2.)
