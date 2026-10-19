# Wajo ("Fo") — REA teardown

> Observation-only teardown of **wajo.ai**, whose assistant is branded **"Fo"**, run against my own logged-in
> session on 2026-10-19. Read-only: no bookings, purchases, payments, sends, or account-setting changes were
> completed. The one flow that reached a real booking (UC1) was **stopped and cancelled** before submission.
> Personal data redacted (`<redacted-phone>` etc.). No cookies/tokens/credentials captured.

## Screenshots note
The Claude-in-Chrome bridge could not persist PNG screenshots of the logged-in session to disk (`save_to_disk`
did not write a reachable file; a separate devtools browser would not share the Wajo login). Evidence is therefore
captured as **verbatim text transcripts** (via page-text extraction) plus redacted network samples — richer than a
PNG. See `docs/rea/network/wajo-serverfn-samples.json`.

---

## Product shape (applies to all use cases)

- **Assistant persona:** "Fo", casual first-person voice; account "Goverdhan MD" on the **Mini** tier. Fo also has
  its own phone number `<redacted-phone>` (used for "Make a call for me").
- **Home screen** offers an "Ask Fo anything…" box + 3 shortcuts: *Make a call for me*, *Book an appointment or
  service*, *Help with a subscription or bill*.
- **Task inbox (the core differentiator).** The home screen carries a three-tab async-task dashboard:
  - **Need your input (N)** — blocking questions Fo is waiting on, each tagged *Information needed* with a one-line
    reason (e.g. "What are your date of birth, gender (as on the passport)…" / "Who should I call, and what should I
    ask or arrange for you?").
  - **On radar (N)** — scheduled / recurring background tasks with a **Next run** timestamp
    (e.g. "Jailer 2 at PVR Orion Mall, 9:45 PM tonight — Next run: Oct 19, 8:00 PM"; "Price watch: Sony WH-1000XM5
    below ₹24,000 — Next run: Oct 20, 9:03 AM").
  - **Last Activity (N)** — a log where **every request becomes a named task** with a status line
    (e.g. "iPhone 16 Price Comparison — Kiwi.com flight checkout started, waiting on your passport"; "Check Amazon
    Order — waiting on your sign-in"; "Current Work Inquiry — Finished Oct 19, 3:23 PM").
- **Step trace.** Each answer shows a collapsible "Completed N steps" / "N done" trace of the tool steps taken, in
  plain language (e.g. "Earlier notes pulled up", "Task list checked for Jailer", "Reservation page opened and checked").
- **Memory is pervasive and silent.** Fo recalls diet (veg), price targets ("under ₹24,000, bank offers ignored, as
  you like"), prior tasks (Jailer 2 booking + booking ID), and location (Bangalore) without being re-told and without
  asking permission to save.
- **Execution model.** Fo acts **immediately** — it does not present a plan and wait for OK. For real-world actions it
  spins up a **server-side browser agent** ("Fo is working in a browser") and **pauses for a code or an approval**
  before finalizing. Long tasks run async; the user can leave and get notified.
- **Backend:** TanStack Start server functions (`wajo.ai/_serverFn/<hash>`, GET=query POST=mutation, seroval-style
  typed payloads), session state via polling keyed by `sessionId`+`orgId`. See network sample.
- **Footer disclaimer on every reply:** "Wajo agents can make mistakes, so double-check."

---

## UC4 — "What are you working on?"

**a) First reply (verbatim):**
> Right now it's mostly quiet background stuff: the nightly heartbeat check-in, and the Sony WH-1000XM5 price watch,
> since I'm still holding out for a base price under ₹24,000 (bank offers ignored, as you like).
>
> Tonight's the movie though: Jailer 2 at PVR Orion, 9:45 PM. Want me to check traffic time to the mall closer to
> evening, or grab some dinner plans before it?

**b) Understanding:** No clarifying questions. Interprets "working on" as its live background tasks + today's commitments.
**c) Plan/approval:** None needed; informational. Ends with a proactive offer (traffic / dinner).
**d) Progress/timing:** "Thinking…" indicator → full reply in ~3–4 s.
**e) Tools/sites:** Reads its own task store (On-radar + reminders). Also surfaced on the home dashboard as
  "Current Work Inquiry — Finished".
**f) Approval screen:** none.
**g) Final reply:** 2 short paragraphs (~5 lines), conversational prose, ends in a question. No bullets/cards/links.
**h) Failure handling:** n/a.
**i) Memory:** Heavy — price target + "bank offers ignored, as you like" (prior preference), Jailer 2 booking, Sony
  watch. Did not ask before using/saving.

## UC5 — "Any update on the Jailer 2 task?"

**a) First reply (verbatim):**
> All set on that front: Jailer 2 is booked for tonight, 9:45 PM, three seats in Audi 04 at PVR Orion
> (booking ID TSAJKDX), and your reminder goes off at 8:00 PM, suggesting you leave by 9:00. Nothing left pending on my
> side. Want me to check the drive time to Orion closer to evening?

**b) Understanding:** Resolves "the Jailer 2 task" to the specific booked task from memory; no clarification asked.
**c) Plan/approval:** none; status read-out + follow-up offer.
**d) Progress/timing:** Progress line "Flipping back through the Jailer 2 notes" (~3 s) → reply (~8–10 s total).
**e) Tools/sites:** Step trace "Completed 3 steps": **1. "Earlier notes pulled up" → 2. "Task list checked for Jailer"
  → 3. "Past chats looked through for Jailer 2"** — i.e. memory + task-store + past-conversation retrieval.
  Conversation auto-named "Jailer 2 Task Update".
**f) Approval screen:** none.
**g) Final reply:** 1 paragraph (~4 lines) + collapsible step trace; ends with a question. Specific facts (seats, audi,
  booking ID, reminder time).
**h) Failure handling:** n/a (task existed).
**i) Memory:** Core to the answer — recalled booking ID, seat count, screen, reminder.

## UC2 — "Alert me when 22K gold in Bangalore drops 10%"

**a) First substantive line (verbatim):**
> Let me grab today's 22K gold rate in Bangalore first so I know what a 10% drop actually means.
**Then (verbatim):**
> Current 22K rate in Bangalore is about ₹13,540 per gram (₹1.35 lakh for 10g), so I'm setting the alert at ₹12,186 per
> gram, which is a 10% drop from today. Setting up a daily check now.

**b) Understanding:** No clarifying question. Took purity (22K) and city (Bangalore) as given; **computed the absolute
  threshold itself** (13,540 → 12,186 = −10%). Chose a daily cadence as the default.
**c) Plan/approval:** Narrated its plan inline ("grab today's rate first… then set the alert") but did **not** wait for
  OK — executed straight through.
**d) Progress/timing:** "Setting up a gold price alert" (~0–11 s) → "Completed 1 step" (fetch rate) → final card
  (~19 s total). Two visible step milestones.
**e) Tools/sites:** Live gold-rate lookup (web/data tool) + recurring-task scheduler.
**f) Approval screen:** none.
**g) Final reply:** A **task card**: "**Gold alert: 22K Bangalore below ₹12,186/g** — Recurring: Daily at 10:00 AM
  (Asia/Calcutta)". ~2 lines prose + card.
**h) Failure handling:** n/a.
**i) Memory:** Minimal here; created a new On-radar task (like the existing Sony price watch).

## UC1 — "Book a table for 2 at Toit Indiranagar tomorrow at 7pm"  *(stopped & cancelled)*

**a) First reply (verbatim):**
> On it, booking Toit Indiranagar for 2, tomorrow at 7pm. Their reservations are online only, so let me handle it
> through their booking page.

**b) Understanding:** **No clarifying questions.** Assumed defaults: party 2 / tomorrow / 7pm (all given), and
  silently proceeded to execute without asking for the diner's name or contact up front.
**c) Plan/approval:** **No plan shown, no wait for OK** — it immediately launched a browser agent.
**d) Progress/timing:** "Looking for a table for two at Toit" → growing step trace every few seconds:
  "Reservation page opened and checked" → "Opening the reservation page at Toit Indiranagar" → "Page snapshot taken" →
  "Opening the reservation form at Toit" (reached "6 done" in ~30 s).
**e) Tools/sites:** A **real server-side browser agent** navigating Toit's actual reservation page. A toast appeared:
  **"Fo is working in a browser — These runs usually stop partway for a code or an approval. Turn on notifications and
  you will hear about it from any tab."** (I chose *Not now* — no settings change.)
**f) Approval/confirmation model:** Fo is designed to **pause for "a code or an approval"** before finalizing (OTP /
  confirm step). I pre-empted it with a stop instruction; Fo queued it ("Fo will get to this next") and then confirmed:
  > Stopped. Nothing was submitted, no reservation was made. I'd only gotten as far as opening Toit's booking page;
  > I closed it and I'm leaving the task there. If you want the table another time (different restaurant, date, or a
  > day-of walk-in), just say the word.
**g) Final reply:** (cancelled) — graceful stop, offers alternatives.
**h) Failure handling:** Clean cancel; no partial booking; proposes fallbacks (different restaurant/date, day-of walk-in).
**i) Memory:** n/a (new task). Conversation auto-named "Restaurant Table Booking".

## UC12 — "plan my weekend"  *(vague request)*

**a) First reply (verbatim):**
> Here's a starting sketch for Sat 25 and Sun 26 (Jailer 2's tonight, so the weekend's still free):
>
> Sat: slow morning, Nandi Hills sunrise if you want to move, then Orion Mall in the evening with a veg dinner pick
> nearby. Sun: Lalbagh walk in the morning, long veg lunch, and nothing else scheduled.
>
> Should it lean chill or full-on going out? Say the word and I'll line up the bookings.

**b) Understanding:** Did **not** ask "which weekend / what do you like" up front — inferred the dates, used **memory**
  (veg diet, Bangalore, Jailer 2 is tonight so weekend is free) to produce a concrete draft, then asked **one**
  steering question (chill vs going out).
**c) Plan/approval:** Presents a draft plan and offers to "line up the bookings" on confirmation — so here it *does*
  defer the side-effectful part to a yes, unlike UC1.
**d) Progress/timing:** "Sketching out your weekend plans" (~0–16 s) → "Completed 1 step" → full plan (~26 s).
**e) Tools/sites:** Memory/profile + local-knowledge (Bangalore spots). No external booking yet.
**f) Approval screen:** none (would come when bookings are lined up).
**g) Final reply:** ~3 short paragraphs (~6 lines), prose with an embedded Sat/Sun structure; ends with a question.
**h) Failure handling:** n/a.
**i) Memory:** Heavy — diet (veg), city, and the Jailer 2 calendar context all used unprompted.

---

## Batch 2 (UC3, 6, 7, 8, 9, 10, 11) — pending
To be appended after Batch 1 is pushed.
