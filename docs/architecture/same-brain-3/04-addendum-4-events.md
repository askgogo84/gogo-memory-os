# Addendum 4: AskGogo Events (10 Nov 2026)

Status of this document: step 1 (audit and boundaries) and step 2 (schema and rules) of the owner's ten steps.
Nothing here is live: the migration is prepared and not applied, and the feature flag is off.

## 1. What already exists and is reused

| Need | Existing piece | How Events uses it |
|---|---|---|
| Organizer identity | `resolveAgentActor` (`lib/agent/actor.ts`), exact-string owner ids | Every event belongs to one `owner_telegram_id` (text) |
| Feature flag pattern | `proceduresEnabledFor`, `GOGO_*_OWNERS` | `eventsEnabledFor`, `GOGO_EVENTS_OWNERS`, off by default |
| Approval before anything leaves | `agent_approvals` and the dashboard approval card | Sending invitations or reminders will be one approval listing recipients, channel, text and cost |
| WhatsApp sending | `lib/whatsapp.ts` (Twilio today, Meta provider layer merged and inert) | Invitations and reminders go through the same functions, leak filter and delivery tracking |
| Delivery status | `delivery_receipts`, `ingest_delivery_callback` | A notification row stores the provider id; status comes from the provider, never assumed |
| Scheduling | reminders cron and durable procedure runtime (`lib/procedures`) | Bounded, one-off reminder jobs; no open-ended loops |
| Opt-out | `reminder_optout` / STOP handling in the WhatsApp pipeline | A guest who opted out is skipped and shown as skipped |
| Calendar | `lib/google-calendar.ts` and calendar approval | Create, update and cancel with the organizer's permission; provider id recorded |
| Invitation card art | `lib/agent/occasion-invite.ts`, `/api/invite-card`, `/e/[id]` | The existing card styles become the first invitation templates |
| Schema conventions | `gogo_spaces`, `secondbrain_workspaces` migrations | RLS on with no policies, service role only, rollback file, PGlite test |
| Personal to-dos for an event | existing reminders | "Remind me to confirm the cake tomorrow" stays an ordinary reminder; no new table |

Existing overlap: the occasion invite (5 Nov) draws a card the person forwards themselves after a table booking. It has
no guest list and no RSVP. Events does not replace it; the card renderer is reused.

Route: `/e/[id]` is taken by the shared occasion card, so the public RSVP page is `/rsvp/[token]`.

## 2. Decisions

1. AskGogo's own tables are the source of truth. No claim of creating or reading native WhatsApp Events: the
   Business Platform does not offer that. WhatsApp Flows for in-chat RSVP is a later option to evaluate, not built.
2. Two ways for a guest to answer: a personal link (for a guest the organizer named), or the event's share link,
   which the organizer forwards themselves; the guest adds their name and gets a personal link for edits.
   The share link is the default channel because it needs no message from AskGogo to anyone.
3. AskGogo messages a guest directly only when the organizer approved that exact recipient list and text, the
   guest has not opted out, and WhatsApp's rules allow it (an approved template outside the 24-hour window).
   Having a contact is never permission to message them.
4. Tokens are 256 random bits; only the SHA-256 hash is stored; per-guest revocation; share link rotation.
5. RSVPs go through one database function that locks the event row (capacity cannot be oversold, changes are not
   lost) and appends to a history. Headcount counts people: going invitations plus plus-ones.
6. The exact address and online link are shown to a guest only if the organizer chose "everyone", or the guest is going.
7. Enterprise: `workspace_id` exists on the event for later organization-scoped events. Not built now. Personal
   events are never visible to a workspace.

## 3. Schema (prepared, not applied)

`supabase/migrations/20261110150000_gogo_events.sql` and its `.rollback.sql`:
`gogo_events`, `gogo_event_guests`, `gogo_event_rsvp_history`, `gogo_event_notifications`, `gogo_event_audit`,
functions `gogo_event_rsvp`, `gogo_event_join`, `gogo_event_headcount`.
Tested on an in-memory Postgres by `scripts/verify-events-schema-core-nov10.mts` (apply twice, rollback, re-apply).
Not tested: true concurrent sessions (the test uses one connection) and the live Supabase project.

## 4. Build order from here

| Step | Work | Depends on |
|---|---|---|
| 3 | Organizer store (`lib/events/store.ts`) and Same Brain tools: create, edit, move, cancel, add guests, headcount, who has not replied | Migration applied |
| 4 | Public page `/rsvp/[token]` and its API: answer, plus-ones, dietary, comment, edit, add to calendar | Owner approves the page mock |
| 5 | Dashboard Events section | Owner approves the screens mock |
| 6 | Approved WhatsApp invitations and reminders | A guest-facing template approved by Meta; provider decision |
| 7 | Calendar create, update, cancel | Step 3 |
| 8 | Bounded follow-ups with verified reporting | Steps 6 and 7 |
| 9, 10 | End-to-end, security and regression runs; demonstration | All above |

## 5. Mandatory tests: where each one stands

Covered at the data layer by this step: 6 (secure invitation generation), 7 (unauthenticated RSVP, data rules),
8 (duplicates), 9 (plus-one headcount), 10 (RSVP updates), 11 (after closing), 12 (revoked links),
13 (guest view exposes no guest list or ids), 14 (owner isolation and default-deny), 29 (several events),
30 (deletion cascades), 32 (share-link and edit bounds).
Not yet covered: 1 to 5, 15 to 28, 31. They belong to steps 3 to 8.

## 6. What the owner must do

- Run the migration in the Supabase SQL editor (project `qenhjcooyecmatwducpu`) when ready; verification query in the PR.
- Approve the RSVP page and Events screens mock before those are built.
- For AskGogo to message guests directly: create and get approved a guest-facing invitation template and a
  reminder template. Until then the organizer forwards the share link themselves.
