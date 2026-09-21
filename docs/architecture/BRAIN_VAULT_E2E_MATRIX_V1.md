# AskGogo Brain + Vault E2E Journey Matrix v1

Each journey must be exercised from at least WhatsApp and one non-WhatsApp surface where applicable.

| ID | Journey | Expected state/evidence |
|---|---|---|
| J01 | Share flight PDF -> ask “what time do I land?” | Same Trip object, factual answer from saved evidence |
| J02 | Share flight PDF -> “save it my calendar” -> approve | Same Trip -> calendar step -> event ID evidence |
| J03 | Share flight PDF -> “monitor it” | Watch linked to Trip; watcher ID evidence |
| J04 | Share flight PDF -> “check travel requirements” | Same Trip; asks only genuinely missing traveler inputs |
| J05 | Research hotels -> “book the second one” | Selected Hotel preserved; approval required |
| J06 | Booking site login -> Vault active | Credential metadata used; plaintext only in broker/sandbox |
| J07 | Booking site login -> wrong password | Vault status needs_reauth; same mission paused |
| J08 | Provider asks OTP | Take Control; same mission resumes after handoff |
| J09 | Booking completes | Confirmation/terminal evidence required before success claim |
| J10 | Check-in request | Boarding pass or terminal check-in evidence required |
| J11 | Product link -> “monitor price” | Product object + watcher |
| J12 | Product watcher fires -> “buy it” | Same Product; approval/payment boundary |
| J13 | Order screenshot -> “where is it?” | Same Order object; no new unrelated search |
| J14 | Document upload -> “when does this expire?” | Same Document object; extracted expiry evidence |
| J15 | Document -> “remind me one month before” | Reminder linked to Document; reminder row evidence |
| J16 | Meeting note -> “send this to Ravi” | Context preserved; draft/approval/send evidence |
| J17 | Calendar event -> “move it to 4” | Same event; approval and provider event evidence |
| J18 | “Watch my inbox for offer letter” | Inbox watcher linked to mission |
| J19 | Watcher finds offer -> “save it” | Same artifact/doc object |
| J20 | WhatsApp share -> Dashboard follow-up | Same canonical world object |
| J21 | Dashboard research -> WhatsApp “continue” | Same Mission |
| J22 | Two hotels active -> “book it” | Clarification; zero mutation |
| J23 | Old paused browser + new flight PDF -> “monitor it” | New Trip wins salience |
| J24 | Duplicate “add it to calendar” delivery | One event only |
| J25 | Duplicate reminder request | One reminder only |
| J26 | Claude unavailable | Planner fallback; deterministic capabilities continue |
| J27 | Both planner providers unavailable | Honest pause/failure; no fabricated execution |
| J28 | Provider access blocked | Mission paused; Take Control; no false result |
| J29 | Calendar disconnected | Connection request; mission preserved |
| J30 | Browser permission disabled mid-mission | Resume blocked by fresh policy evaluation |
| J31 | Approval granted then target changes | Old approval invalid |
| J32 | Vault has two accounts for provider | User chooses account label; no secret shown |
| J33 | Vault revoked | Brain sees unavailable/revoked metadata; no broker resolution |
| J34 | Signed provider URL in error | query values/fragments redacted |
| J35 | Raw secret-shaped text in memory path | redacted/rejected; never reaches world model |
| J36 | Watcher event arrives while user chatting | Updates same object without stealing unrelated focus |
| J37 | Life Event check-in window opens | mission resumes/proposes action |
| J38 | User says “stop monitoring this” | Correct watcher resolved and disabled |
| J39 | User says “forget this credential” | Vault mutation via secure UI/command; mission references invalidated safely |
| J40 | User asks “what are you doing for me?” | Active missions/watches summarized from state, not chat guess |

## Required negative assertions

Every journey with consequential action must also assert:
- no mutation before approval
- no secret plaintext in prompts/logs/activity
- no success claim without evidence
- no duplicate mutation on replay
- no cross-user state access
- no fallback to plain general_chat when an agent executor throws

## Performance targets

- context-only turns: p95 < 1.5s before executor latency
- safe deterministic reads: p95 < 3s where provider/network not involved
- WhatsApp browser budget remains bounded
- context resolution should avoid LLM call when deterministic salience is sufficient

## Observability

Each journey should emit:
- event_id
- resolved focus refs
- mission_id
- step_id
- capability
- policy decision
- approval id if applicable
- evidence ids
- final mission status

No secret values may be present in these fields.
