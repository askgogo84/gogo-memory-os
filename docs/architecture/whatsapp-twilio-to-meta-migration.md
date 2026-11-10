# WhatsApp: moving from Twilio to Meta's Cloud API (plan, 10 Nov 2026)

Status: plan only. Nothing here is built or switched. Owner decisions needed are in section 6.

## 1. Why

Twilio charges its own fee on every WhatsApp message in both directions, on top of what Meta charges. At consumer
scale that fee is larger than the model bill.

| Cost per message | Amount | Source |
|---|---|---|
| Twilio fee, inbound and outbound | 0.005 USD each | twilio.com/en-us/whatsapp/pricing (read 10 Nov) |
| Meta, service reply (free-form, inside the 24 h window) | 0.115 INR after 1,000 free per business number per month | Meta rate card effective 1 Oct 2026, as reported by two independent guides (flowcall.co, dev.to/xreach51) |
| Meta, utility or authentication template | 0.115 INR | same |
| Meta, marketing template | 0.8631 INR | same |
| Meta, message from the user | free | same |

Not verified first-hand: Meta's own rate-card page could not be opened from the build session. Check it before
committing: developers.facebook.com/documentation/business-messaging/whatsapp/pricing. Rates exclude GST.

Worked example, one user exchanging 20 messages a day (600 in, 600 out a month), at an assumed 85 INR per USD:

| | Through Twilio | Direct to Meta |
|---|---|---|
| Twilio fee (1,200 messages) | about 510 INR | 0 |
| Meta fee (600 replies) | about 69 INR | about 69 INR |
| Total per user per month | about 579 INR | about 69 INR |

So going direct removes roughly 88% of the messaging cost. The remaining 69 INR per heavy user is Meta's own charge
since 1 October 2026 and applies whichever provider is used; the ways to reduce it are fewer bubbles per answer and
moving heavy use to the app and dashboard, which cost nothing per message.

## 2. What exists today (repo, 10 Nov)

- Consumer WhatsApp runs on Twilio: 44 files mention Twilio; 30 read `TWILIO_AUTH_TOKEN` (mostly media downloads);
  two reminder templates are Twilio Content SIDs; inbound is `app/api/webhooks/whatsapp/route.ts` (Twilio form fields:
  `Body`, `MediaUrl0`, `ButtonPayload`, `ListId`, `OriginalRepliedMessageSid`, `ProfileName`); delivery status is
  `app/api/webhooks/twilio-status`; signatures in `lib/security/webhook-signature.ts`.
- A Meta Cloud API sender, webhook handshake and signature check already exist for the Tipplr pilot:
  `lib/enterprise/tipplr/meta-whatsapp.ts` (text and up to three buttons, env `META_WA_*`).

## 3. Target design

One channel interface, two adapters, chosen by an env switch. No handler knows which provider is underneath.

```
lib/channels/whatsapp/
  types.ts      InboundMessage { id, from, profileName, text, media[], buttonPayload, listId, repliedToId, location, at }
                OutboundMessage { to, text | buttons | list | template | media, replyToId? }
  twilio.ts     today's behaviour, moved behind the interface
  meta.ts       Cloud API: send, typing/read receipt, media by id, templates, signature (X-Hub-Signature-256)
  index.ts      provider = GOGO_WA_PROVIDER ('twilio' default | 'meta'); per-number override for the pilot
app/api/webhooks/whatsapp-meta/route.ts   Meta inbound + status, idempotent on message id, same pipeline after parsing
```

Details that change:
- Media: Meta gives a media id; download is `GET graph.facebook.com/<id>` with the bearer token, then the returned
  URL. This replaces the five Twilio media helpers; the same size and type bounds apply. No Basic-auth secret travels.
- Templates: the two reminder templates are recreated in WhatsApp Manager as utility templates and approved by Meta.
- Quoted replies: Meta supports `context.message_id` on outbound, which Twilio does not (gap G6 in the Instinct notes).
- Status callbacks: sent, delivered, read and failed arrive on the same webhook.
- Idempotency, per-user serialization, signature checks and the quiet-WhatsApp policy stay exactly as they are.

## 4. Phases

| Phase | Work | Exit check |
|---|---|---|
| 0 | Owner inputs (section 6). Read Meta's migration rules for moving a number from a provider to Cloud API | Written confirmation of what carries over (display name, quality rating) and what does not (templates) |
| 1 | Channel interface; move Twilio behind it with no behaviour change | Full test chain green; production unchanged |
| 2 | Meta adapter and webhook, generalised from the Tipplr code; media by id; tests with recorded payloads | Fixture tests for text, buttons, list, voice note, photo, PDF, quoted reply, duplicate delivery, bad signature |
| 3 | Templates created and approved in WhatsApp Manager | Both reminder templates approved |
| 4 | Pilot on a second number registered directly on Cloud API; the owner's second phone talks to it for a week | The release-gate WhatsApp checks pass on the pilot number; cost per message read from Meta billing |
| 5 | Move the production number to Cloud API in a quiet hour; flip `GOGO_WA_PROVIDER=meta` | Voice note, photo, reminder, button reply and one template send verified live within 30 minutes |
| 6 | Keep the Twilio adapter for 30 days, then remove Twilio envs and code | No Twilio traffic for 30 days |

Rough effort: phases 1 to 3 are about one to two weeks of build and review; phase 3 also waits on Meta's template
approval. This is an estimate, not a commitment.

## 5. Risks

- Rollback after phase 5 is not instant. Once the number leaves Twilio, going back means migrating it again. The
  pilot week on a second number is what makes the cutover safe.
- The production number is a US number (+1 760 548 3659). Meta bills by the recipient's country, so India rates apply
  to Indian users, but confirm this for a non-Indian business number before the pilot.
- Meta's per-number messaging limits and quality rating now sit directly with AskGogo; a burst of blocked or reported
  messages affects the number with no provider in between.
- Twilio's typing indicator and Content API behaviours have Meta equivalents but not identical ones; phase 2 tests
  each.

## 6. Decisions and inputs needed from the owner

1. Go or no-go on the migration, after checking Meta's rate card.
2. Admin access to the Meta Business account that owns the AskGogo WhatsApp number, and its WABA id.
3. A system-user token for Cloud API (owner creates it; it is entered in Vercel by the owner, never shared in chat).
4. A second number for the pilot (the existing second phone number can be the tester; the business side needs a new
   or test number on Cloud API).
5. A quiet hour for the cutover.
