# AskGogo.in — Website Redesign Brief
_Goal: a landing site that clearly beats memorae.ai — same feature story, better proof, India-first, and it shows off the 6 things Memorae can't do. Current landing is `app/page.tsx` (65 lines, minimal)._

## 1. Positioning
- **Headline promise:** "India runs on WhatsApp. So should your day."
- **One-liner:** Your AI assistant that lives in WhatsApp — reminders, memory, calendar, money, health — no app, no login, just a message.
- **Wedge vs Memorae:** everything they gate behind ₹325–₹1950/mo, AskGogo does on **free or ₹99/mo**, and it also does **split bills, food-calories, expenses, meeting notes, translation, and skin checks** — which Memorae does not.
- **CTA everywhere:** a `wa.me` deep link with a pre-filled "Hi" → straight into the bot. Never "sign up".

## 2. Why we can beat memorae.ai (design targets)
Memorae's site: dark, "memory layer" cosmic branding (Origin/Supernova/Big Bang tiers), heavy jargon, gated features. Beat it by being:
- **Concrete, not cosmic** — show real WhatsApp chat bubbles doing real tasks (screenshots we already have).
- **Proof-first** — live-feeling phone mockups with actual bot replies for each feature.
- **Honest pricing** — one simple ₹99 number, a clear "free tier is genuinely useful" table, and a side-by-side "their ₹650 plan = our free + ₹99" comparison.
- **India-native** — ₹, Hinglish examples, UPI/flight/thali visuals, WhatsApp-green accents.
- **Fast + accessible** — static, image-light, mobile-first, WCAG AA.

## 3. Page structure (single-page + a few subpages)
1. **Hero** — headline, sub, animated WhatsApp chat demo (typing → reply), `wa.me` CTA, "no app · no login" trust line.
2. **Feature showcase** (chat-bubble mockups), grouped:
   - Remember everything — semantic memory search, throwback, topic buckets, shared buckets
   - Never forget — NL reminders (incl. "27th"/"18 June"), recurring, friend-to-friend reminders
   - Run your day — daily + weekly briefing (customizable), calendar, plan-my-day
   - Money — split bills, expense tracking (₹), payment logging
   - Health — food photo → calories/macros, skin check
   - Work — Gmail check, meeting notes + diarization, translation, web search, standing preferences ("call my wife DW")
3. **AskGogo vs Memorae** — comparison table (feature · Memorae tier/price · AskGogo tier). Emphasize the 6 exclusives + price.
4. **Pricing** — Free vs Pro ₹99/mo (₹999/yr). "Start for free, upgrade when you love it."
5. **How it works** — 3 steps: Say hi on WhatsApp → talk normally → it just works. No download.
6. **Social proof / use-cases** — Goa trip split, thali calories, "remind Divya to pay me", Lisbon travel bucket shared with family.
7. **FAQ** — privacy, "is my data safe", cancel anytime, languages, what it can't do.
8. **Footer** — wa.me CTA, links, contact.

## 4. Feature list to showcase (everything AskGogo does)
Reminders (one-time/recurring/absolute-date/voice) · follow-ups · lists/tasks · semantic memory search · throwback · topic buckets · **shared memory** · friend-to-friend reminders · preference rules · daily + **weekly + customizable** briefings · Google Calendar (add/free-busy/agenda) · Gmail (check + draft reply) · web search · voice→actions · photo/OCR notes · image intelligence (poster→event, ticket→reminder) · **food calories+macros** · **split bills + itemize** · **expense tracking ₹** · **meeting notes + speaker diarization** · **translation (text/image/voice)** · **skin check** · topic scheduled digest · clean-up/forget.
(Bold = Memorae does NOT have these.)

## 5. Tech approach
- Build in the existing Next.js app (`app/page.tsx` + new `app/(marketing)/…` routes, or components under `app/`).
- Tailwind (already in repo via globals.css) — or inline. Keep it a static server component; no client JS beyond a small chat-animation.
- Reuse real screenshots (the WhatsApp test captures) as the feature proofs — put them in `public/`.
- Brand: WhatsApp green (#25D366) as accent, clean light theme (contrast vs Memorae's dark cosmic), Indian-rupee framing. Logo/colors: ask the user for assets ([LOGO], [BRAND COLORS]); use placeholders until provided.
- Keep the `wa.me` link configurable (one constant).

## 6. First deliverable for the new chat
Build a new hero + feature-showcase + comparison + pricing single page in `app/page.tsx` (replacing the 65-line stub), mobile-first, with placeholder brand tokens and real feature copy from section 4. Then iterate section by section. Deploy via `git push` (Vercel).

## 7. Assets to ask the user for
- Logo (SVG/PNG) and brand colors
- The `wa.me` number / deep link
- Permission to use their WhatsApp screenshots as proof
- Any real testimonials / user counts
- Confirm final pricing (₹99/mo, ₹999/yr) and the free-tier limits
