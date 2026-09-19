# Instinct AI — OBSERVED tier

**Source:** screenshots of a live WhatsApp thread with Instinct, captured 19 Sep 2026, 09:16–10:00 IST, by Gogo.
**Evidence tier:** OBSERVED. Everything below is visible in the transcript. Nothing here is inferred from marketing material.
**Merge target:** the Observed section of `docs/architecture/02-instinct-teardown.md`. The Reported and Inferred tiers are produced separately from public sources.

This is the highest-value evidence available for Run 2, because the task chosen — Bangalore to Mysore by train — is the exact task AskGogo spent 17–18 Sep on, so the two products can be compared move for move.

**Note on sections 8b–8e:** sections 1–8 were written from the 09:16–09:32 screenshots with per-message timestamps. Sections 8b–8e cover 09:32–10:00 and were recorded from the same thread in the session handover; exact per-message timestamps were not captured for them.

---

## 1. Surface and interaction model

| Observation | Evidence |
|---|---|
| Runs inside ordinary WhatsApp. No app, no dashboard visible at any point in the chat itself. | The screenshots show the WhatsApp UI |
| Opens with a proactive prompt rather than waiting silently | 09:16 — "What should I take off your plate first?" |
| Acknowledges user messages with a 👍 reaction instead of a reply | 09:25, 09:27, 09:28, 09:31 |
| Splits one response across several bubbles rather than one long message | 09:24 pair, 09:25 pair, 09:30 pair |
| Handles three separate tasks interleaved in one linear chat | mail triage, day summary, and train booking all live between 09:16 and 09:32 |

## 2. Quoted-reply threading — the strongest pattern here

Every agent reply that belongs to a task quotes the originating user message above it, styled as a WhatsApp reply block labelled "You".

- 09:20 reply quotes "Chk k my mails.."
- 09:21 reply quotes "How's my day looking"
- 09:24, 09:30 replies quote "Find a train from Bangalore to Mysore on 21st and book it"

The threading is **bidirectional**: the user also quote-replies to specific agent questions, and the agent picks up the right task from the quoted message.

This is how a single linear chat stays legible while three long-running tasks are in flight. It costs nothing architecturally and solves a problem AskGogo has today.

## 3. Connector-on-demand

At 09:17, asked to check mail with no mailbox connected, it did not error:

1. Stated the gap plainly — no email account connected yet
2. Rendered an inline link card, "Connect Google to Instinct", pointing at app.instinct.com
3. Offered the alternative in the next bubble — if the user uses Outlook, it will send the right link

A missing integration is presented as a next step, not a failure.

## 4. Email triage output shape

At 09:20, after connection, it reported on the user's work mailbox as **three numbered things that matter**, each naming the person and the blocking state:

1. A security assessment thread, with who wants a call and who is free when
2. Someone waiting on the user to confirm updated URLs
3. An outbound email that **bounced because the address wasn't found**

Then a one-line dismissal of the remainder (mostly newsletters or FYI threads) and an offer of the next action: draft the confirmation, or dig into the other thread.

Catching the bounce is the notable part. That is a fact the user could not have known without the mailbox being read.

## 5. Calendar summary

At 09:21: the calendar is completely open today, no meetings or conflicts, rest of Saturday free. Stated as a conclusion, not a list of events.

## 6. Slot-filling that tracks its own state

| Time | Move |
|---|---|
| 09:24 | Returns six direct trains with times, then asks two questions: which train and class, and who is travelling — full ticket name, age, and gender |
| 09:25 | User gives names and class only. Agent restates what it has (AC Chair Car for Goverdhan and Divya), re-asks the missing train, and re-asks for the passenger fields exactly as they should appear on the booking |
| 09:27 | User gives names and ages. Agent: "Got the names and ages. I still need two things" — numbered: which train, and gender |
| 09:28 | User answers. Agent resolves gender per passenger, then **disambiguates rather than guessing**: there are two Vande Bharat trains, which one — with both departure times |
| 09:29 | User: "10.05" |

It never re-asks for something already supplied, and it never assumes when two options match the user's words.

## 7. Credential boundary

At 09:30, before checkout, two bubbles:

- Confirm Goverdhan's gender is male, and send the IRCTC username.
- "Don't send the password here. If it's needed, I'll give you a secure link for it."

A clear split: identifier in chat, secret never in chat, secure link if required. Stated in one sentence a non-technical user understands. This is the same boundary as AskGogo's `human_auth_required` path, expressed as product language rather than architecture.

## 8. Where the first half stopped

09:31 — user: "I don't have a account"
09:32 — "That's okay. I'll check the IRCTC signup path and keep the train details ready."

## 8b. Credential vault (09:32–10:00)

For setting a password out of chat, it pointed to an **Instinct vault** at app.instinct.com. The secure link promised at 09:30 is a web surface, not a chat flow.

## 8c. Initiative on delegation (09:32–10:00)

When asked to pick something on the user's behalf and the user replied "U choose", it did not bounce the decision back: "I'll try goverdhanmd first and use a close variation if it's taken." It states the choice it is making and the fallback, then proceeds.

## 8d. Offer to create an account in the user's name (09:32–10:00)

It offered to **create an IRCTC account for the user**, using his real email address and WhatsApp number, with a chat confirmation as the consent step.

## 8e. The Akamai wall and the fallback (09:32–10:00)

It hit the **same IRCTC Akamai block** AskGogo hit on 18 Sep (datacenter IP reputation), and fell back to a device handoff in words: please create and activate the account yourself in the official IRCTC site or app; tell me when it's active and I'll pick up the 10:05 Vande Bharat booking from there.

**No booking completed.** The run ended at the account wall, holding state (the chosen train survives), with a stated next step. Nobody has solved IRCTC from a datacenter; the observable difference between products is how gracefully they stop.

---

## 9. OPEN QUESTION — provenance of the six train timings

At 09:24, three minutes after the request, it produced six trains with departure and arrival times. The transcript contains:

- no statement that it read IRCTC or any other source
- no browser step, screenshot, tool-call indicator, or citation
- no "checking now" message before the answer

Several of the named services are real Bangalore–Mysuru trains. That is not the question. The question is whether the **times for 21 Sep** were read from a live source or generated from model knowledge.

This matters because it is the exact failure AskGogo eliminated on 18 Sep in commit `35e9aed`: the general planner inventing train numbers with departure times when the provider read failed. AskGogo now refuses rather than inventing.

It is also notable alongside 8e: the same run that could not reach IRCTC produced a timetable without saying where it came from.

**Unresolved.** Do not record a conclusion either way in the teardown until tested. The test is to ask Instinct directly where the timings came from and whether it can show the source. If it turns out to be model knowledge presented as availability, that is a genuine differentiator for AskGogo and belongs in Run 3 under DIFFERENTIATE.

---

## 10. Provisional dispositions for Run 3

Run 3 decides these. Recorded here so the evidence and the decision stay together.

| Capability | Provisional | Why |
|---|---|---|
| Quoted-reply threading (bidirectional) | **COPY** | Cheap, solves a real problem in a linear chat, no architecture change |
| Connector-on-demand with inline link | **COPY** | Turns a dead end into a next step |
| 👍 acknowledgement reactions | **COPY** | Removes noise from long threads |
| Triage as "three things that matter" + dismissal of the rest | **ADAPT** | Good shape for the existing briefing |
| Slot-filling with explicit "I still need two things" | **COPY** | Directly applicable to train, flight and appointment specialists |
| Disambiguate rather than guess between two matches | **COPY** | Matches the fail-closed rule already in force |
| Credential boundary wording | **COPY** | Better phrasing of a boundary AskGogo already enforces |
| Credential vault as a web surface | **ADAPT** | Fits the dashboard; must never route a secret through WhatsApp |
| Initiative on "U choose" with a stated fallback | **ADAPT** | Good for low-stakes picks; must not extend to money or identity decisions |
| Creating an account in the user's name | **DIFFERENTIATE** | Identity creation; for AskGogo needs DPDP-grade explicit consent, not a chat "Yes" |
| Graceful stop at the account/IP wall, holding state | **ADAPT** | AskGogo's device handoff already does this; the wording is what to borrow |
| Answering without showing provenance | **DIFFERENTIATE** — pending §9 | AskGogo's verified-or-refuse behaviour is the opposite bet |

---

## 11. Comparison axes

The capability audit's section 7 defines seven axes for scoring Instinct against AskGogo. Fill them from that document rather than inventing a second set here — the point of the axes is that both sides are scored on the same scale.
