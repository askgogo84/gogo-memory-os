# AskGogo — Complete Test Checklist + Memorae Parity
_Everything to test on WhatsApp, plus a feature-by-feature comparison with Memorae's 28 features._

---

# PART A — COMPLETE TEST CHECKLIST

Tick each as you test on your bot. Grouped by area. (S) = shipped this session, (E) = already existed in repo.

## 1. Reminders  (E + Phase 0 fixes S)
- [ ] `remind me to drink water in 2 minutes` → fires in 2 min
- [ ] `remind me on 27th to go to airport` → 27th, 9 AM IST, task "go to airport"  (S)
- [ ] `remind me on 18 June at 5pm` → 18 Jun 5 PM  (S)
- [ ] `reminder Dec 25 at 8am gift` → 25 Dec 8 AM, task "gift"  (S)
- [ ] `every monday at 9am review goals` → recurring
- [ ] `show my reminders` → lists pending
- [ ] `done 1` / `snooze 1 for 10 minutes` → mark done / snooze
- [ ] `remind me tomorrow` , `in 5 days at 10am` → still work (regression)

## 2. Lists  (E)
- [ ] `add milk, eggs to shopping` → list updated
- [ ] `show shopping list` → shows items
- [ ] `check milk` → marks done
- [ ] `clear shopping` → clears

## 3. Semantic Memory (1A)  (S)
- [ ] `Remember my flight to Kolkata is on SpiceJet SG-101` → saved (em-dash reply)
- [ ] `what did I save about my travel` → returns the flight (word never typed)
- [ ] `what did I note about my health` → returns doctor/vitamin note by meaning
- [ ] `forget my note about <x>` → deletes it
- [ ] nonsense query → graceful "couldn't find"

## 4. Throwback (1B)  (S)
- [ ] `test throwback` → resurfaces an old save, "reply keep or forget"
- [ ] reply `forget` → deletes it; `keep` → keeps
- [ ] (auto) appears in Sunday briefing for saves >21 days old

## 5. Friend Reminders (1C)  (S)
- [ ] `remind Priya to call me in 2 minutes` → asks for Priya's number
- [ ] reply with a number (active-chat number) → "Saved Priya's number…" → that number gets the ping
- [ ] `remind Priya to buy milk tomorrow` → straight to "Done…"
- [ ] `remind me to …` still works for yourself
- [ ] ⚠️ cold numbers need a Twilio template (config) to receive

## 6. Preference Rules (1D)  (S)
- [ ] `from now on address me as boss` → saved; next normal chat calls you "boss"
- [ ] `always keep my lists in capitals` → saved
- [ ] `my rules` → lists them
- [ ] `forget rule about capitals` → "Removed 1 preference."

## 7. Briefings (1E + E)
- [ ] `set my briefing to 7:30am` → time set  (E)
- [ ] daily briefing arrives at the set time  (E)
- [ ] `enable weekly brief` → on  (S)
- [ ] `preview weekly brief` → next-7-days reminders  (S)
- [ ] (auto) Sunday briefing shows week-ahead + throwback  (S)
- [ ] `briefing should include reminders and tasks` → only those sections show; `reset briefing` → all  (#20)
- [ ] `send me my <topic> bucket every day` → schedules a recurring topic digest  (#18)

## 8. Shared Memory (1.5)  (S)  — needs 2 users
- [ ] `remember for Lisbon trip: flight is TAP 704 at 6pm` → saved to bucket
- [ ] `remember for Lisbon trip: hotel Casa Boma checkin 3pm`
- [ ] `share my Lisbon trip bucket with <friend>` → shared
- [ ] friend asks `what did I save about Lisbon` → sees "📂 Shared with you"

## 9. Contacts vs Memory (#3)  (S)
- [ ] `Remember Divya trip to Goa was amazing` → MEMORY (searchable)
- [ ] `Remember Ramesh number is 9876543210` → CONTACT

## 10. Calendar  (E)
- [ ] `connect calendar` → OAuth link
- [ ] `add lunch with Srini Friday 1pm` → event created
- [ ] `am I free Friday afternoon` → free/busy answer
- [ ] `what's on my calendar tomorrow` → agenda

## 11. Gmail  (E)
- [ ] `connect gmail` → OAuth link
- [ ] `check my latest emails` → summary
- [ ] `draft a reply to this email` → draft

## 12. Web search / chat AI  (E)
- [ ] `what's the latest on <topic>` → cited web answer
- [ ] general question → conversational reply

## 13. AskGogo-only extras (Memorae does NOT have these)  (E)
- [ ] Food photo → calories + macros
- [ ] Split bills (send a bill photo, itemize per person)
- [ ] Expense tracking (₹) + insights
- [ ] Meeting notes + speaker diarization
- [ ] Translation (text / image / voice)
- [ ] Skin check

---

# PART B — MEMORAE 28-FEATURE PARITY

| # | Memorae feature | AskGogo status |
|---|---|---|
| 1 | NL reminders (one-time/recurring/voice) | ✅ have (+quick actions) |
| 2 | Follow-up until done | ✅ have (done/snooze) |
| 3 | Lists | ✅ have |
| 4 | Voice → structured actions | ✅ have (Whisper) |
| 5 | Photo/media input | ✅ have (OCR) |
| 6 | Google Calendar sync | ✅ have |
| 7 | Availability queries | ✅ have |
| 8 | Outlook/Apple via Google | ⏭️ deliberate skip (v1) |
| 9 | Daily briefing | ✅ have — FREE (they paywall it) |
| 10 | Long-term memory retrieval | ✅ have (1A semantic) |
| 11 | Gmail / Workspace | ✅ have (read + draft reply) |
| 12 | Chat AI + web search | ✅ have |
| 13 | Unlimited image analysis | ✅ have (food/OCR/skin) |
| 14 | Friend-to-friend reminders | ✅ have (1C)* |
| 15 | Memory Bubbles / Serendipity | ✅ have (1B Throwback) |
| 16 | Native app / priorities / subtasks | ⏭️ deliberate skip (no-app thesis) |
| 17 | Channel-escalation reminders | 🅿️ pending (needs email channel) |
| 18 | Topic buckets + scheduled digest | ✅ have (1.5 buckets + #18 digest) |
| 19 | Personalization rules engine | ✅ have (1D) |
| 20 | Custom briefings (time/content/channel) | ✅ have (time + weekly + content flags) |
| 21 | Email classification + drafting | ⚠️ partial — read+draft-reply ✅; auto-classify + send ❌ |
| 22 | Task tracker (pending/priorities) | ✅ have (reminders + lists) |
| 23 | Shared memory | ✅ have (1.5) |
| 24 | Full web dashboard | 🅿️ pending (real front-end build) |
| 25 | Password vault (plaintext) | ⏭️ deliberate skip (security) |
| 26 | Advanced weekly brief | ✅ have (1E) |
| 27 | Clean Up ("forget this") | ✅ have |
| 28 | Shared memory bubbles (detail) | ✅ have (1.5) |

\* 1C delivery to cold numbers needs a Twilio approved template (account config).

**Parity score: 24 ✅ full · 1 ⚠️ partial · 3 🅿️ pending · 3 ⏭️ deliberate skip = 28/28 accounted for.**
(21 = read+draft-reply ✅, auto-classify/send deferred; the 3 pending are dashboard, Twilio template config, Telegram channel.)
Plus 6 features AskGogo has that Memorae does NOT (calories, split bills, expenses, meeting notes, translation, skin check).

---

# PART C — WHAT'S GENUINELY LEFT TO ADD

Only these are real "features to build" (the ⏭️ skips are intentional per strategy):

1. ✅ ~~Topic scheduled digest (#18)~~ — DONE ("send me my <topic> bucket every friday").
2. ✅ ~~Briefing content flags (#20)~~ — DONE ("briefing should include reminders and tasks").
3. **Email auto-classify + drafting depth (#21 tail)** — classify inbox into flights/deliveries/payments and auto-log payments; deeper drafting. Send scope stays deferred (safety). ~1–2 days.
4. **Web dashboard (#24)** — bulk-edit reminders/lists/briefings via magic-link login. Real front-end build. Multi-day.
5. **Twilio approved template** — config step to make 1C reach cold numbers reliably. Not code.
6. **Telegram channel (4B)** — adapter to run the same bot on Telegram. Do after WhatsApp is stable.

Deliberate skips (do NOT build): Outlook/Apple (#8), native app (#16), password vault (#25).
