# TRD — AskGogo First-Message Onboarding

**Track:** Onboarding (doc 2 of 6)
**Status:** Draft for review
**Date:** 10 Aug 2026
**Reads with:** `PRD-01-askgogo-onboarding.md`

---

## 1. Decisions this TRD implements

| Decision | Value |
|---|---|
| Magic prompt delivery | Trigger word, no template, ship now |
| First action | Offer both voice and typed text |
| Email capture | End of message 2, via existing dashboard magic link |
| New templates required | None |

## 2. The constraint that shapes everything

`routeFeatureIntent` (`app/api/webhooks/whatsapp/route.ts:836`) runs and returns
early at `:842` — roughly 253 lines before `processIncomingMessage` /
`detectIntent` at `:1095`. Three production bugs have now come from a matcher
upstream claiming a message it could not service:

- nutrition matched by substring (`rice` ⊂ "price")
- the list matcher anchored on `startsWith('add ')`
- the split parser's lazy prefix `/^(.+?)\s+(?:balance|balances)$/i`

**Therefore:** onboarding must be checked at the very top of the webhook handler,
*before* `routeFeatureIntent` — not added as another matcher in the chain. A
trigger word is exactly the kind of short token that gets swallowed.

Placement, in order:

```
POST /api/webhooks/whatsapp
  1. Twilio signature / auth
  2. Parse inbound
  3. → STOP handling            (reserved for the F2F track, same principle)
  4. → ONBOARDING CHECK         (this doc)
  5. routeFeatureIntent         (:836)
  6. processIncomingMessage → detectIntent  (:1095)
```

## 3. First-message detection

**Requirement:** definitive, single indexed lookup, and it must not add
meaningful latency to *every* inbound message.

**Do not** infer "new user" from a missing profile row — profiles are created by
several paths and a missing row does not mean no history. Use an explicit
onboarding state column, defaulting to null, so the check is one indexed read
and the answer is unambiguous.

```
users.onboarding_stage  text  null
```

Values: `null` (never onboarded) → `welcomed` → `capability_sent` →
`first_action_done` → `complete`.

The check is `onboarding_stage IS NULL` for the welcome branch. Once set, the
branch is skipped on every subsequent message, so the cost for existing users is
one indexed column read that is already being fetched with the user row — no
additional query.

**Migration** (hand-applied on `qenhjcooyecmatwducpu`, confirmed with a SELECT
before any code ships — this is the standing rule, and it was violated once
already on 10 Aug):

```sql
alter table public.users
  add column if not exists onboarding_stage text,
  add column if not exists onboarding_started_at timestamptz;
```

Confirming SELECT:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'users'
  and column_name in ('onboarding_stage','onboarding_started_at')
order by column_name;
-- expect exactly 2 rows
```

**Backfill decision:** every existing user must be marked so nobody who already
uses AskGogo receives a welcome. Run immediately after the migration, before the
flag is enabled:

```sql
update public.users set onboarding_stage = 'complete'
where onboarding_stage is null;
```

This is the single most important step in the whole track. Getting it wrong
sends a "welcome to AskGogo" to the entire existing user base.

## 4. Trigger word

**Hazard:** a short token is the most hijackable thing in this codebase.

**Rules:**

- Matched by **exact equality** on the trimmed, lowercased message — not
  substring, not regex with a lazy prefix.
- Checked at position 4 above, before any feature matcher runs.
- Only honoured when `onboarding_stage = 'welcomed'`. Outside that state the
  word falls through to normal routing, so it can never shadow a real command
  for an established user.

That state gate is what makes the trigger safe: it is not a global keyword, it
is a one-time answer to a question we just asked.

**Word choice:** to be fixed in the UI/UX brief. It must be short enough to type
on mobile, unambiguous in a transcript, and must not collide with an existing
command. Candidates to test against the real pipeline before choosing.

**Voice path:** the same trigger must work when spoken, which means matching the
*transcript*. Two known problems, both accepted for v1:

- Whisper may return punctuation or capitalisation — handled by trim + lowercase
  + strip trailing punctuation.
- A non-English speaker will say the word in their own language and the
  transcript will not match. Known gap, consistent with the wider language-routing
  issue. v1 mitigation: message 1 also accepts any message while
  `onboarding_stage = 'welcomed'` as an implicit "yes" if it is not a recognised
  command — see §5.

## 5. Fallback: don't trap the user

If the user is in `welcomed` state and sends something that is *not* the trigger
word:

- If it parses as a real command (a reminder, a list add), **honour it**, mark
  `onboarding_stage = 'first_action_done'`, and skip the capability response.
  A user who already knows what they want must never be blocked by onboarding.
- If it does not parse, treat it as the trigger and send the capability
  response.

This is what prevents the flow from becoming a modal dialog in a chat window.

## 6. Capability response generation

Generated per-request rather than a static string, so it can use whatever is
known (first name, time of day, language).

**Constraint against drift:** generation must be given a fixed, explicit list of
capabilities and the ten example phrasings. The model composes tone and
ordering; it must not invent features. Any example it emits must come from the
supplied list verbatim — the list is the contract, not a suggestion.

**Verification requirement:** every one of the ten phrasings must be tested
against the *real pipeline order* (routeFeatureIntent then detectIntent), not
against matchers in isolation. `scripts/verify-creditiq-routing.mjs` passed 22/22
while production routed `my card balance` to bill-split. A new
`scripts/verify-onboarding-examples.mjs` follows the same two-stage harness
pattern and must pass before ship.

## 7. Email capture

Reuses the existing dashboard magic-link auth — no new auth surface.

At the end of message 2, append a one-line offer with the magic-link URL. When
the user completes the magic-link flow, the email is captured by the existing
path and `onboarding_stage` advances.

**No email is stored from the WhatsApp side.** The capture happens entirely in
the dashboard flow that already exists.

## 8. Files expected to change

| File | Change | Risk |
|---|---|---|
| `app/api/webhooks/whatsapp/route.ts` | Onboarding check inserted before `routeFeatureIntent` | **Highest.** This is the hottest path in the repo. No control-flow change for users with a non-null stage |
| `lib/bot/handlers/onboarding.ts` (new) | Welcome, capability response, state transitions | Low, new file |
| `lib/bot/onboarding-copy.ts` (new) | The fixed capability list and ten examples | Low, data only |
| `scripts/verify-onboarding-examples.mjs` (new) | Two-stage routing harness | None, test only |
| migration `supabase/onboarding-v1.sql` (new) | §3 DDL, hand-applied | None to running code |

## 9. Feature gate

`ONBOARDING_ENABLED`. When unset:

- The onboarding check returns immediately without a DB read.
- No state is written.
- Behaviour is byte-identical to HEAD.

Unsetting the variable and redeploying is a complete rollback with no code
change — the same pattern that made the TIER 1A rollout safe.

## 10. Ordering of work

1. Migration + confirming SELECT + **backfill existing users to `complete`**
2. Copy fixed in the UI/UX brief, trigger word chosen
3. `verify-onboarding-examples.mjs` written and passing against the real pipeline
4. Handler built, gate off
5. Deploy with gate off, confirm nothing changes
6. Enable gate, test from a genuinely new number
7. Confirm no existing user received a welcome

Step 7 is the one that cannot be skipped.

## 11. Open items for later docs

- Trigger word choice → UI/UX brief
- Exact copy for all three messages → UI/UX brief
- The ten example phrasings → UI/UX brief, then the harness
- Re-offer behaviour (richer capability response once state exists) → App Flow
