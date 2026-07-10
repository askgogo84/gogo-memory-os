# AskGogo × Memorae — Build Status (end of session)

## Shipped & deployed this session
| Item | Status |
|---|---|
| Phase 0 — absolute-date reminders + clean task text | ✅ live, verified |
| 1A — semantic memory search (embed + backfill + retrieval) | ✅ live, verified |
| 1B — Throwback (weekly + `test throwback`, keep/forget) | ✅ live, verified |
| 1C — friend-to-friend reminders (+contact save flow) | ✅ live (delivery gated by Twilio session/template) |
| 1D — standing preference rules (injected into prompt) | ✅ live, verified |
| 1E — weekly brief toggle + `preview weekly brief` | ✅ live |
| #3 — contacts vs memory disambiguation | ✅ live, verified |
| #27 — Clean Up / "forget" (memory + throwback) | ✅ live |
| 1.5 — Shared Memory (topic buckets + share) | ✅ live |

## Already present in the repo (pre-existing, not rebuilt)
| Item | Where |
|---|---|
| Phase 2 — Google Calendar (connect, actions) | `lib/bot/handlers/calendar-actions.ts`, `connect_calendar` |
| Phase 3 — Gmail (connect, read, email actions) | `lib/bot/handlers/email-actions.ts`, `read_gmail` |
| Phase 4A — Web search in chat | `lib/web-search.ts`, `SEARCH:` in Claude prompt |
| #22 — task tracker (pending view + mark done) | reminders: `show my reminders`/`done N`; lists: check/show/clear |

## Deliberately parked (need scoping or external config — NOT blind-built)
| Item | Why parked |
|---|---|
| 1C cold-number delivery | Needs a Twilio approved message template (account config, not code) |
| #17 Channel-escalation reminders | Needs an email channel; single-channel re-nudge is a possible cheap add |
| #24 Full web dashboard | Real build (app.askgogo.in shell exists) |
| 4B Telegram channel revival | Do last, only after WhatsApp is boringly reliable |
| #25 Password vault | Deliberate skip (security) — do not clone |

## New DB objects created this session (all migrations run in Supabase)
- `memory_embeddings` (+ `match_memories` RPC, `resurfaced_at`)
- `user_preferences`
- `friend_contacts`
- `users.weekly_brief` column

## Suggested next steps (when ready, scoped deliberately)
1. Configure a Twilio approved template so 1C reaches cold numbers.
2. Shared Memory (1.5): add topic tags to saves, then grant a contact read access to a topic.
3. Single-channel follow-up escalation (#17-lite): re-nudge a reminder if not marked done in X hours.
4. Telegram channel adapter (4B) once WhatsApp is stable.
