# AskGogo — Test Checklist (session build)
Test each on WhatsApp with your bot. ✅ = expected pass. Notes flag caveats.

## Phase 0 — Reminders (absolute dates + clean text)  [LIVE, verified]
- `remind me on 27th to go to airport` → fires on the 27th, 9:00 AM IST, task "go to airport"
- `remind me on 18 June at 5pm` → 18 Jun 5:00 PM (next year if passed), clean confirmation
- `reminder Dec 25 at 8am gift` → 25 Dec 8:00 AM, task "gift"
- Regressions still OK: `remind me at 3`, `remind me tomorrow`, `every monday at 9am`, `in 5 days at 10am`

## 1A — Semantic memory search  [LIVE, verified]
- Save: `Remember my flight to Kolkata is on SpiceJet SG-101`
- Search by meaning: `what did I save about my travel` → returns the Kolkata flight (word "travel" never typed)
- `what did I note about my health` → returns a vitamin/doctor note by meaning
- Nothing found is graceful: `what did I save about quantum physics` → "couldn't find…"

## 1B — Throwback  [LIVE, verified]
- `test throwback` → "🎞️ Throwback: … ago you saved — '…'. Reply keep or forget."
- reply `forget` → deletes it (confirm with a search); reply `keep` → keeps it
- Auto: appears in the Sunday morning briefing for memories older than 21 days

## 1C — Friend reminders  [LIVE, test delivery]
- `remind Priya to call me in 2 minutes` → asks "What's Priya's WhatsApp number?"
- reply `+9198…` (use a number with an ACTIVE chat with the bot) → "Saved Priya's number. I'll remind Priya…"
- that number gets "⏰ Reminder from <you>: call me" at the time
- `remind Priya to buy milk tomorrow` → "Done — I'll remind Priya…" (number remembered)
- `remind me to …` still works for yourself (not treated as a friend)
- ⚠️ CAVEAT: Twilio only delivers to numbers inside a 24h session or via an approved template.
  Cold numbers won't receive until they message the bot. Production reach needs a Twilio template.

## 1D — Preference rules  [LIVE, verified except forget just fixed]
- `from now on address me as boss` → saved; then any chat (e.g. `breakfast idea`) → reply calls you "boss"
- `always keep my lists in capitals` → saved
- `my rules` → lists both
- `forget rule about capitals` → "Removed 1 preference." (this was the last fix — verify)

## 1E — Custom briefings  [LIVE, test]
- `set my briefing to 7:30am` → time updates (pre-existing feature)
- `enable weekly brief` → confirmation
- `preview weekly brief` → shows reminders scheduled in the next 7 days (testable any day)
- Auto: Sunday briefing includes the week-ahead block for users with weekly brief on

## #3 — Contacts vs memory routing  [LIVE, verified]
- `Remember Divya trip to Goa was amazing` → saved as MEMORY (searchable)
- `Remember Ramesh number is 9876543210` → saved as CONTACT (has a phone number)

## Already in repo (smoke-test these) — Phases 2/3/4
- Calendar: `connect calendar`, `am I free Friday afternoon`, add an event
- Gmail: `connect gmail`, `check my latest emails`
- Web search: `what's the latest on <topic>` / anything needing current info

## 1.5 — Shared Memory (topic buckets)  [LIVE, test with 2 users]
- Save with topic: `remember for Lisbon trip: our flight is TAP 704 at 6pm`
- Add more: `remember for Lisbon trip: hotel is Casa Boma, checkin 3pm`
- Ensure the friend is a saved contact (do one `remind <name> to …` + their number) and is an AskGogo user
- `share my Lisbon trip bucket with <name>` → "Shared your Lisbon trip bucket with …"
- On the FRIEND's phone: `what did I save about Lisbon` → they see a "📂 Shared with you" section
- ⚠️ Recipient must be an existing AskGogo user; topic saves use explicit "remember for <topic>:" phrasing
