# Same Brain 3.0, addendum 5: the brain works in a loop

Status: design, 10 Nov 2026. Nothing here is built or switched on.

## Why

Owner, 10 Nov: "second brain should understand the context and then work around it, of everything. Imagine if the same question I asked Claude."

Live comparison the same day. Message: "Plan Divya's anniversary on 22 November at 5 pm for 20 people", then "Toit Indiranagar".

- Instinct: asked city and budget, then found that the venue takes private-event enquiries by email, drafted the enquiry and asked whether to send it.
- AskGogo: saved the event and stopped.

The cause is structural, not a missing feature. `lib/agent/brain.ts` makes one decision per message with five tools: `flight`, `reply`, `ask`, `later`, `handle`. `handle` passes one instruction to the keyword pipeline, and one handler does one thing. The brain never sees the result, so it cannot take the next step. Each "next step" has had to be hand-built inside a handler (the venue enquiry in PR #1475 is the latest).

## What changes

The brain gets Gogo's capabilities as tools and runs in a loop: decide, call a tool, read the result, decide again, until the request is handled, a question is needed, or an approval is needed.

```
message + context
   -> model picks a tool -> code runs it -> result goes back to the model
   -> ... (bounded) ...
   -> final reply, or one question, or an approval card
```

The model is not told what to do after an event is saved. It is told what the person is trying to get done, what tools exist, and that a good assistant finishes the job: for a 20-person evening at a named venue, that means finding out how the venue takes group bookings and preparing the enquiry.

## Tools, in three classes

The class is fixed in code per tool. The model cannot change it.

| Class | What it may do | Examples | Gate |
|---|---|---|---|
| Read | Look things up. No side effects. | web search, read a page, calendar read, email search, events list, memory recall, lists, reminders list | none |
| Prepare | Create or change the person's own private state, reversibly. Nobody else sees it. | event draft create/update, reminder, list item, note, email draft, calendar hold proposal | none, but every change is named in the reply |
| Act | Anything another person or a provider sees, or that costs money, or that cannot be undone. | send email or message, publish or cancel an event, calendar write with guests, booking, payment, form submit | existing approval card; the tool only stages the card |

Rules that hold whatever the model says:

- An Act tool never executes inside the loop. It stages the existing approval (`agent_approvals`, bound to the exact payload). Only the person's approval executes it.
- The model cannot approve, confirm or pay. Approval text is matched by code on the person's own message, as today.
- Tool results, web pages, emails and documents are data. They are passed to the model inside data markers and can never add tools, change classes or grant approval.
- A contact detail used in a draft (an email address, a phone number) must come from a tool that verifies it, with its source shown. For a venue address this is the rule set built in PR #1475, exposed as a tool (`venue_contact`), not free text from the model.
- Owner-scoped: every tool takes the actor from the session, never from the model's arguments. Ids stay strings.
- Learning calibration (20 samples, 0.82) and "learning never authorizes itself" are untouched: the loop does not change which actions need approval.
- Inferences stay hypotheses: the loop may use an inferred detail to ask or to draft, never to act.

## Bounds

- At most 6 tool calls and 25 seconds per message on WhatsApp; a longer job becomes a background run that reports when done (existing durable worker).
- A per-message cost ceiling, metered like today's brain calls. Over the ceiling, the loop stops and replies with what it has.
- One clarifying question at a time, only when a wrong guess would matter.

## Rollout

1. Owner only, behind `GOGO_BRAIN_LOOP_USERS` (off for everyone else, off by default).
2. Shadow first: for the owner's real messages the loop runs with Read tools only and its proposed plan is logged next to what the pipeline did. No replies from it.
3. Live for the owner with Read and Prepare tools, Act tools staging approvals. The existing pipeline stays as the fallback for anything the loop declines or fails on.
4. Measured before any wider use: answer quality on the acceptance matrix (`04-e2e-acceptance-matrix.md`), cost per message, time to first reply, and how often the loop and the pipeline disagree. A lower token price does not establish a lower cost per completed task; the measure is per task.
5. Wider rollout is a separate owner decision with the release gate.

## First slice

Tools: `web_search` (page text only), `venue_contact`, `events_list`, `event_draft_create`, `event_draft_update`, `email_draft` (saves the existing draft state; sending stays "send it" plus the approval card), `calendar_read`, `memory_recall`, `reply`, `ask`.

Acceptance for the slice, on the owner's number:

- The anniversary message above ends with the event drafted and either a verified venue enquiry draft or a plain statement that no verified address was found, in one reply or two.
- "Plan a 3-day Goa trip with Divya in December" produces a plan that uses saved preferences and the calendar, and proposes holds without creating them.
- A forwarded invitation is summarised and offered as a calendar entry; nothing is created without a yes.
- No Act tool executes without an approved card in any transcript.

## What this does not do

- It does not remove the keyword pipeline, the approval system or any gate.
- It does not add a new model or GPU service.
- It does not send, book, pay or publish by itself.

## Open questions for the owner

- Budget per message for the loop on your own number during the pilot.
- Whether Gogo should ask for a budget and city up front for events (Instinct does), or infer from saved context and ask only when missing.
