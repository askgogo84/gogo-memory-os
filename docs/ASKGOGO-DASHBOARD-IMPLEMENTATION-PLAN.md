# AskGogo Dashboard v0 — Implementation Plan
*Doc 5 of 6. Repo `C:\Users\gover\gogo-memory-os` → Vercel project `gogo-memory-os` (**not** `credit-iq`). Deploy: `git push` then `npx vercel --prod` — Gogo runs deploys, never the agent. PowerShell chains with `;` not `&&`.*

---

## Before anything

Three things are open and two of them touch this track:

- **`METER_ENABLED` is unresolved.** The usage surface has nothing real to show until it is. Phase 5 is blocked on it.
- **`/upgrade` still reads `?id=`.** Phase 2 closes that IDOR; until then the plan/upgrade links stay pointed at the marketing site.
- **Three prices are live at once.** The usage surface must not add a fourth.

Nothing here jumps ahead of those. Phases 0–4 can proceed in parallel with them.

---

## Phase 0 — Read-only investigation *(no code)*

`app/dashboard/page.tsx` already exists. Everything below assumes a greenfield build; that assumption has to be tested first.

Report:
1. What `app/dashboard/*` currently is — a real page, a stub, or dead code. Extend or replace, with a recommendation.
2. Any existing `app/api/dashboard/*` routes and what they do.
3. The lists tables — exact names and columns.
4. `wa_link_throttle`'s shape, and whether it can carry token-issue throttling as-is.
5. How the Google Calendar integration exposes events server-side, and where `google_calendar_connected` is read.
6. Confirm `reminders` columns available to the list view: label, emoji, due time, recurring pattern, done/sent flag.
7. Whether any styling system exists in this repo (Tailwind config, tokens, global CSS) that the UI/UX brief's palette should slot into rather than duplicate.

**Output:** a findings note with file:line. No files changed. Stop.

---

## Phase 1 — Migrations *(SQL only)*

Apply `dashboard_tokens` and `dashboard_sessions` per the Backend Schema, each confirmed with a SELECT that returns the object. Verify `wa_link_throttle`. Do not proceed until all three are eyeballed.

---

## Phase 2 — Auth end to end *(no UI)*

The riskiest part, built and proven before a single screen exists.

- `lib/dashboard/session.ts` — `issueToken`, `redeemToken`, `getSession`, `endSession`.
- `app/api/dashboard/session/route.ts` — POST redeem, DELETE sign out.
- Bot side: a `dashboard` intent that issues a token and replies with the link. Rate-limited, 5/hour.
- `/dashboard` route that redeems `?t=`, sets the cookie, and redirects to a clean URL.
- A bare `/dashboard/reminders` that renders nothing but *"Signed in as +91…"*.

**Also in this phase: migrate `/upgrade` off `?id=`** to read the session. The IDOR, the name leak into Razorpay, and the payment-misattribution vector close together. Leaving it for later means shipping a session system while the hole stays open.

**Test on phone:** link works once; second tap shows expired; a 16-minute-old link fails; six links in an hour throttles; sign-out then reload shows expired; `/upgrade` with no session shows the get-a-link screen rather than a payment page.

Deploy this phase alone. It's invisible to users but it's the part that must be right.

---

## Phase 3 — Shell and design system

- `app/dashboard/layout.tsx` — session guard, bottom tab bar, the expired-link screen.
- Palette, type scale and motion tokens from the UI/UX brief, wired into whatever styling system Phase 0 found. **Do not duplicate an existing token system.**
- `<WhatsAppChip>`, `<EmptyState>` (the figure), `<FloatLoader>` (the `gogo.gif` rhythm).
- The five routes exist and render placeholders.

Built at 375px first. Verify on the actual phone before moving on.

---

## Phase 4 — Read surfaces, one per commit

Order matters — highest value first, so a stall still leaves something useful shipped.

1. **Reminders** — list, filters, empty state, chip. No writes yet.
2. **Lists** — read only.
3. **Profile** — read only, plus sign out.
4. **Calendar** — month grid, connected / not-connected / empty-day states kept distinct.

All reads through `lib/dashboard/queries.ts`, all scoped by session telegram_id. Diff review per commit.

---

## Phase 5 — Usage *(blocked on `METER_ENABLED`)*

Three bars plus Unlimited reminders, via `getUsage` / `getPlan` / `getLimits`. **Never re-implement the counting** — dashboard and WhatsApp must agree exactly.

Verification: the numbers here match what `usage` returns in WhatsApp for the same user at the same moment. If they differ by one, stop and find out why before shipping.

---

## Phase 6 — The four writes

Edit reminder, delete reminder, create list, delete list item. Each API route re-reads the session and **re-verifies row ownership server-side** — never trusted from the body.

The recurring-delete prompt ("this one or the series?") is the one to get right; deleting a series someone built is not recoverable.

---

## Standing rules

1. Verify before build — the codebase has differed from assumption every session.
2. Migration-first, confirm with SELECT. Never trust "applied".
3. No changes to the reminder send path, the cron, `lib/data/limits.ts`, or `meter-core.ts`. The dashboard reads.
4. Ownership checked server-side on every read and every write. No identifier in any URL.
5. One surface per commit, diff-reviewed.
6. 375px first, real phone, before anything else.
7. `npx tsc --noEmit` shows 5 known pre-existing errors — only NEW ones matter.
8. Gogo deploys.

---

## Definition of done

- The only way in is a WhatsApp link, single-use, 15 minutes.
- No page can be opened for another account by editing a URL.
- Every card offers a chip that hands the user back to WhatsApp with the message prefilled.
- Usage matches WhatsApp exactly.
- `/upgrade` no longer accepts `?id=`.
- Every surface has a real empty state — no blank grids, no zeros standing in for unknowns.
