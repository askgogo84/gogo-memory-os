# App Flow — AskGogo First-Message Onboarding

**Track:** Onboarding (doc 4 of 6)
**Status:** Draft for review
**Date:** 10 Aug 2026
**Reads with:** `PRD-01`, `TRD-02`, `UIUX-03`

---

## 1. State machine

```
null ──────► welcomed ──────► capability_sent ──────► first_action_done ──────► complete
 │              │                     │                        │
 │              └─ real command ──────┴────────────────────────┘
 │                 (skips capability response)
 │
 └─ existing users backfilled straight to `complete`
```

`complete` is terminal. Nothing in this flow ever fires again for that user.

## 2. Happy path

| # | Event | State before | Action | State after |
|---|---|---|---|---|
| 1 | First-ever inbound | `null` | Send M1 Welcome | `welcomed` |
| 2 | User sends `start` | `welcomed` | Send M2a, then M2b | `capability_sent` |
| 3 | User sends a real command | `capability_sent` | Normal handling, then M3 | `first_action_done` |
| 4 | Any later message | `first_action_done` | Normal handling; mark `complete` | `complete` |

## 3. Branch cases

### 3.1 User acts immediately, ignoring the trigger

State `welcomed`, message parses as a real command.

**Behaviour:** honour the command normally, send M3, jump to
`first_action_done`. The capability response is skipped entirely.

Rationale: a user who already knows what they want must never be made to sit
through onboarding. This is the single most important branch in the flow.

### 3.2 User sends something unrecognised

State `welcomed`, message is not the trigger and does not parse as a command.

**Behaviour:** treat as the trigger. Send M2a + M2b, advance to
`capability_sent`.

This is what makes the flow language-proof — a Hindi or Kannada speaker who
cannot naturally type `start` still gets the capability response by sending
anything at all.

### 3.3 User never responds after the welcome

State stays `welcomed` indefinitely. No follow-up, no nudge, no second message.

Rationale: a follow-up would be business-initiated, requiring a template and
consuming the 250/24h cap. Not worth it for v1. Revisit only after the
display-name verification clears.

### 3.4 First inbound is media, not text

Photo, PDF, voice note, or forwarded ticket as the very first message.

**Behaviour:** send M1 Welcome **and** process the media normally. Do not make
the user re-send it.

State goes `null` → `welcomed`. If the media processing constitutes a real
action (a ticket parsed, a meal logged), advance to `first_action_done` and send
M3 instead of waiting.

### 3.5 First inbound is a voice note

Same as 3.4. Transcribe, then evaluate the transcript against the same rules as
3.1 / 3.2. The welcome still goes out first so the user has context for whatever
comes back.

### 3.6 User sends several messages in quick succession

Two inbound messages arrive before the first has finished processing.

**Behaviour:** the state write must be the thing that guards, not an in-memory
check. Set `welcomed` as part of the same write that decides to send M1, so a
second concurrent message reads the already-advanced state and takes the normal
path.

Consequence if this is done wrong: two welcome messages. Test explicitly by
sending two messages within a second from a fresh number.

### 3.7 User says `start` after onboarding is complete

State `first_action_done` or `complete`.

**Behaviour:** falls through to normal routing. `start` is not a global keyword —
it only means anything in `welcomed` state. It will most likely reach the LLM and
get a conversational reply, which is correct.

### 3.8 Existing user, never onboarded, backfill missed them

Should be impossible after the backfill, but if a `null` stage reaches an
established user they receive a welcome message they do not need.

**Mitigation:** the backfill in TRD §3 runs before the gate is enabled, and step
7 of the ordering explicitly verifies no existing user received a welcome. This
branch exists to be prevented, not handled.

### 3.9 CreditIQ-linked vs unlinked users

M2a lists "Your cards" as one of five capabilities. For a user with no CreditIQ
link this is a feature they cannot use, occupying one of only five slots.

**Open decision (UIUX §8.4):** either show it to everyone as a discovery hook, or
swap it for a sixth capability when `wa_creditiq_links` has no row for that
number. Recommend showing it — discovery is the point — but flag it.

## 4. Message 3 trigger conditions

M3 fires on the **first real action**, defined as any of:

- a reminder created
- a list created or an item added
- an expense logged
- a document or ticket successfully parsed and stored

It does **not** fire on:

- a web search or gold price lookup (information, not a stored action)
- a conversational LLM reply
- a failed or ambiguous parse

Rationale: M3 says "that's your first one". It should follow something the user
will still see value from tomorrow.

## 5. Interaction with existing flows

| Existing flow | Interaction |
|---|---|
| `routeFeatureIntent` | Onboarding check sits **before** it. When state is non-null and not `welcomed`, the check returns immediately and routing is untouched |
| Reminder creation | Unaffected. M3 is appended after the normal confirmation, as a separate message |
| CreditIQ link handshake | If the first-ever message is `link creditiq <code>`, treat as 3.1 — honour it, send M3 |
| Bill-split, nutrition, lists | Unaffected. All sit downstream of the onboarding check |
| Delivery-truth tracking | Unaffected. Onboarding messages are in-session freeform replies, not tracked reminders |

## 6. Failure handling

Every failure in this flow must **fail open** — an onboarding error must never
prevent a user's actual message from being handled.

| Failure | Behaviour |
|---|---|
| State read fails | Skip onboarding entirely, process message normally |
| State write fails | Still send the message; log it. Worst case the user sees a welcome twice |
| Capability generation fails or times out | Fall back to a static version of M2a/M2b held in `onboarding-copy.ts` |
| Message send fails | Log; do not retry. Do not block the user's own message |

The static fallback in row 3 is not optional. A generated capability response
that times out on message two of a new user's first experience is worse than a
slightly less personal static one.

## 7. Test matrix

Every row tested on a real phone from a genuinely new number.

| # | Scenario | Expected |
|---|---|---|
| 1 | New number sends "hey" | M1 only |
| 2 | Then sends `start` | M2a + M2b |
| 3 | Then sends a reminder | Reminder confirmed, then M3 |
| 4 | New number sends a reminder as first message | M1, reminder confirmed, M3 — no capability response |
| 5 | New number sends "asdfgh" as second message | M2a + M2b (3.2) |
| 6 | New number sends a voice note first | M1 + transcript handled |
| 7 | Two messages within one second from a new number | Exactly one M1 |
| 8 | Existing user sends anything | No onboarding message of any kind |
| 9 | Existing user sends `start` | Normal routing, no capability response |
| 10 | Gate unset, new number messages | No onboarding message; behaviour identical to today |

Row 8 is the one that matters most. Row 10 proves the rollback.
