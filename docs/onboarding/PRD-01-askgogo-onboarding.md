# PRD — AskGogo First-Message Onboarding

**Track:** Onboarding (doc 1 of 6)
**Status:** Draft for review
**Date:** 10 Aug 2026
**Depends on:** nothing — fully unblocked
**Blocks:** email capture → lifecycle mailers

---

## 1. Problem

A brand-new user messages AskGogo for the first time and gets nothing. No
welcome, no orientation, no indication of what the assistant can do. They are
expected to discover a WhatsApp-first product by guessing at it.

Two consequences we can already observe:

- **Silent misroutes look like capability gaps.** When a phrasing misses a
  matcher, the LLM answers plausibly and the user never learns the feature
  existed. The CreditIQ cards bug on 9 Aug was exactly this — a linked user was
  repeatedly told to go link their cards.
- **No email address is ever captured**, so no lifecycle communication is
  possible at all.

## 2. Goal

A new user's first sixty seconds should end with them having *used* one feature,
not read about several.

**Primary metric:** % of new users who complete at least one real action
(reminder, list, expense) within 24h of first message.

**Secondary:** % of new users with a captured email address.

**Guardrail:** no increase in business-initiated message volume. Every message
in this flow is a reply inside the 24h session window, so none of it consumes
the 250/24h business-initiated cap.

## 3. Non-goals

- Not a gamified learning track (rewards, hats, progress bars) — that is a later
  track and mostly cost.
- Not a web onboarding quiz — that belongs to the dashboard track.
- Not a video series. AskGogo has no video assets and producing them is not on
  this critical path.
- No new WhatsApp templates. Everything here happens in-session as freeform
  replies, so nothing requires Meta approval.

## 4. The core mechanic: script the first message

The single highest-leverage move observed in the Memorae teardown is that they
**dictate the user's first utterance** rather than hoping for discovery. Their
onboarding tells the user to send a specific prompt, and the product is tuned to
answer that one prompt exceptionally well.

AskGogo adopts the same mechanic:

1. On first inbound message, reply with a short welcome that names one thing to
   send back.
2. Tune the response to that exact prompt to be the best output the product
   produces — a capability overview plus concrete, copy-paste-able examples.
3. Every example is a real command that works, so the next thing the user does
   is use a feature.

## 5. Flow

**Trigger:** an inbound WhatsApp message from a `telegram_id` / `whatsapp_to`
with no prior message history.

**Message 1 — Welcome (immediate)**

- Greets by name if WhatsApp provides a profile name, otherwise no name.
- One line on what AskGogo is.
- One instruction: send the magic prompt (or tap it — see open question 8.1).
- Nothing else. No feature list, no menu.

**Message 2 — Capability response (on receiving the magic prompt)**

Structure, adapted from the best output observed in the teardown:

1. Personal opener that acknowledges what they asked.
2. One short paragraph of positioning — what AskGogo is *for*, not a feature
   list.
3. Six to eight capabilities, each a bolded name plus a one-line explanation.
4. **Ten concrete things to say right now**, as exact phrasings.
5. One closing question — pick one and we'll do it.

**Message 3 — First-action acknowledgement**

When the user completes any real action from the list, confirm it warmly and by
name, and offer exactly one next step. Not a menu.

## 6. Personalisation

Memorae's examples are populated from stored state — the user's city, their
connected friend's name. That is what makes the output read as an assistant
rather than documentation.

On message one AskGogo knows almost nothing. What is available:

| Signal | Source | Available at first message |
|---|---|---|
| First name | WhatsApp profile name | Usually |
| Time of day | Server clock, IST | Always |
| Language | Transcript / message script | Yes, if non-English |
| City | Not available | No |
| Connected friends | Not available | No |

**Decision:** the capability response is generated fresh each time rather than
being a static string, so it can use whatever is known. The ten examples are
templated with slots that fall back to sensible defaults when a slot is empty.

**Re-offer:** once the user has done one thing, the same capability response, if
asked again, should be visibly richer — using their real reminder, their real
list name. This is the mechanism that makes the assistant feel like it is
learning.

## 7. Language

A non-English first message currently cannot reach any keyword-routed feature,
because transcripts stay in the original script and every matcher is English.
This is out of scope to fix here, but the welcome flow must not make it worse:

- The welcome and capability response reply in the language of the incoming
  message.
- The ten example phrasings are given in **English**, with a short note that
  they work in the user's language too — until routing is language-aware, the
  English forms are the ones guaranteed to match.

## 8. Open questions

**8.1 — How does the user send the magic prompt?**
Three options, decreasing friction and increasing build cost:

| Option | Friction | Cost | Note |
|---|---|---|---|
| Type it themselves | High | None | Long prompt, most will not |
| Quick-reply button | Lowest | New template + Meta approval | Blocked on approval cycle |
| Short trigger word ("start") | Low | None | Recommended for v1 |

**Recommendation:** v1 uses a short trigger word. The button becomes flow #5 of
the button campaign later.

**8.2 — Where is email captured?**
Not in this flow. Asking for an email in the first sixty seconds costs
activation. Proposal: capture it at the first moment there is a reason —
dashboard signup, or after the first completed action ("want this on your laptop
too?"). Deferred to the email-capture doc.

**8.3 — Voice-first?**
Memorae's first requested action is a voice note, which also seeds their
long-term memory immediately. AskGogo already handles voice. Worth testing as a
variant, but v1 stays text to keep the path simple.

## 9. Success criteria for v1

- A brand-new number messaging AskGogo receives the welcome within 5 seconds.
- Sending the trigger word returns the capability response.
- At least eight of the ten example phrasings, sent verbatim, route to the
  correct feature and are verified on a real phone.
- Existing users are unaffected — no welcome is ever sent to a number with prior
  history.
- Feature flag: unsetting it reverts to current behaviour with no code change.

## 10. Risks

| Risk | Mitigation |
|---|---|
| The ten examples include phrasings that do not actually route | Every example is phone-tested before ship; a regression script covers them, in the real pipeline order |
| Welcome fires for existing users | Gate on a definitive "no prior message" check, not on a missing profile row |
| Capability response is generated and drifts or hallucinates features | Constrain generation to a fixed capability list; never let it invent a feature |
| Adds latency to every inbound message | The "is this a first message" check must be a single indexed lookup |

## 11. Next docs in this track

2. TRD — where the first-message check lives in the pipeline, given
   `routeFeatureIntent` runs ~253 lines ahead of `detectIntent`
3. App Flow — message-by-message with branch cases
4. UI/UX Brief — exact copy for all three messages, mobile-first, light theme
5. Backend Schema — onboarding state, which columns, which migration
6. Implementation Plan — phased, gated, with the phone-test matrix
