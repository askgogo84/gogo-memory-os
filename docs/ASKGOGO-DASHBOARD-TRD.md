# AskGogo Dashboard v0 — TRD
*Doc 2 of 6. Repo: `C:\Users\gover\gogo-memory-os` (Next.js App Router). DB: Supabase `qenhjcooyecmatwducpu` — **not** `yazpphublutdodahfwvr`. Vercel project `gogo-memory-os` — **not** `credit-iq`.*

---

## 0. Investigate before building

A `app/dashboard/page.tsx` already exists in this repo. **Read it first.** This track either extends it or replaces it, and that decision can't be made from a doc. Same for any existing `app/api/dashboard/*` routes.

---

## 1. Architecture

Next.js App Router, server components by default. The dashboard is a set of server-rendered pages reading Supabase through the service-role client, with the user identity coming from a session cookie — never from a query parameter.

```
app/
  dashboard/
    layout.tsx          session guard + bottom tab bar
    page.tsx            redirect → /dashboard/reminders
    reminders/page.tsx
    calendar/page.tsx
    lists/page.tsx
    usage/page.tsx
    profile/page.tsx
  api/
    dashboard/
      session/route.ts      POST: exchange token → cookie; DELETE: sign out
      reminders/route.ts    PATCH, DELETE
      lists/route.ts        POST, PATCH, DELETE
lib/
  dashboard/
    session.ts          issueToken, redeemToken, getSession, endSession
    queries.ts          all reads, one function per surface
```

Client components only where interaction demands it — the filter row, delete confirmations, the calendar month stepper. Everything else renders on the server.

---

## 2. Authentication

### Issuing

In the bot: a `dashboard` intent generates a token and replies with the link.

- Token: 32 bytes from `crypto.randomBytes`, base64url. **Not** derived from anything about the user.
- Stored as a **SHA-256 hash**, never in plaintext — a leaked table must not yield working links.
- TTL **15 minutes**, single use.
- Rate limit: 5 issues per telegram_id per hour, reusing the `wa_link_throttle` pattern already shipped for the CreditIQ handshake.

Link shape: `https://app.askgogo.in/dashboard?t=<token>`

### Redeeming

`layout.tsx` sees `?t=`, calls `POST /api/dashboard/session`, which:

1. Hashes the token, looks it up, rejects if missing, expired, or already used.
2. Marks it used (single-use burn — same discipline as the CreditIQ redeem).
3. Creates a session row, sets the cookie, redirects to the clean URL so the token never sits in history.

### The session cookie

`askgogo_session`, httpOnly, Secure, SameSite=Lax, 30-day expiry, value is a random session id (not a JWT, not the telegram_id). The mapping to telegram_id lives server-side only, so nothing about the user is inferable from the cookie.

`getSession()` returns `{ telegramId }` or null. Any dashboard page or API route without a session redirects to a page that says *"Message AskGogo on WhatsApp and send `dashboard` to get your link"* — with a wa.me link that prefills exactly that.

### What this replaces

`/upgrade?id=<telegramId>` reads the session instead of the query parameter. The query parameter is removed, closing the IDOR, the name leak into Razorpay, and the payment-misattribution vector in one change.

---

## 3. Data access

All reads go through `lib/dashboard/queries.ts`, one function per surface, each taking `telegramId` and returning exactly what the page renders. No Supabase calls inline in components — it makes the identity boundary auditable in one file.

| Surface | Source |
|---|---|
| Reminders | `reminders` filtered by telegram_id, IST-day aware |
| Calendar | Google Calendar via the existing integration + `reminders` with times |
| Lists | existing lists tables |
| Usage | `getUsage()` and `getPlan()` and `getLimits()` from `lib/services/meter.ts` |
| Profile | `users`, `user_plans`, `wa_creditiq_links` |

**Never re-implement the meter's counting.** The dashboard and WhatsApp must report identical numbers for the same user at the same moment; two implementations guarantee they eventually won't.

### Writes

Only four: edit reminder, delete reminder, create list, delete list item. Each is an API route that re-reads the session, re-checks the row belongs to that telegram_id, then acts. **Ownership is verified server-side on every write** — never trusted from the request body.

---

## 4. Deep-link chips

A shared `<WhatsAppChip>` component:

```
https://wa.me/15797006612?text=<urlencoded prefill>
```

The number is the AskGogo Twilio sender. Put it in one constant, not inline — it changes when the verified business number lands.

Chips are the only green elements in the dashboard (see the UI/UX brief).

---

## 5. Rendering and performance

- Server components fetch in parallel; no client-side data fetching on first paint.
- The five surfaces are separate routes, so each loads only its own data.
- No skeleton screens — use the float animation from `gogo.gif` (see UI/UX brief §4).
- Target: usable first paint under 1.5s on a mid-range Android over 4G. Test on the actual phone, not a throttled desktop.

---

## 6. Security requirements

1. Tokens hashed at rest, single-use, 15-minute TTL, rate-limited per user.
2. Session cookie httpOnly + Secure + SameSite=Lax; the value carries no user data.
3. Every read and write scoped by the session's telegram_id, verified server-side.
4. No user identifier ever in a URL or query string.
5. Sign-out deletes the session row, not just the cookie.
6. `/upgrade` migrated off `?id=` in the same release — leaving it behind means the IDOR survives the fix.

---

## 7. What this track does not touch

No changes to the reminder send path, the cron, `lib/data/limits.ts`, or `lib/services/meter-core.ts`. The dashboard is a reader. If a dashboard requirement seems to need a change in the bot's core paths, stop and raise it rather than making it.
