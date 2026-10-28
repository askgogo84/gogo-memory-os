# Kill switches

Environment variables that turn a whole capability off for everyone, at once, with no code change.
Each refusal tells the person honestly that nothing was done.

## How to flip one in Vercel

1. Vercel dashboard → the AskGogo app project (app.askgogo.in) → **Settings → Environment Variables**.
2. Add (or edit) the variable for the **Production** environment, e.g. `GOGO_BOOKING` = `off`.
3. **Redeploy** the current production deployment (Deployments → ⋯ → Redeploy). Env changes only reach new deployments.
4. To turn it back on, delete the variable (or set any value other than `off`) and redeploy again.

For the three capability switches, `off`, `0`, `false`, `paused` and `disabled` all mean off (case-insensitive).

## Switches

| Variable | When set to `off` | Choke points |
|---|---|---|
| `GOGO_BOOKING` | Flight and provider bookings refuse **before** any approval or browser run is created: "Booking is paused right now… Here is the search link to book yourself: …". An APPROVE on a booking card that was already pending is not recorded and nothing runs. Approved booking runs still queued are closed as failed (`capability_paused:booking`) before a browser opens. Restaurant reservation-release approvals are refused too. | `lib/agent/flight-booking.ts` (`runFlightBooking`, `createBookingApproval`), `lib/agent/browser-command.ts` (`runBrowserCommand`, `executeBrowser`), `lib/agent/approval-guard.ts` (`guardApprovalCapability`, used by the WhatsApp bridge and `app/api/agent/approvals/[id]`), `lib/agent/secure-computer.ts` (`runSecureBrowser` backstop) |
| `GOGO_VOICE_CALLS` | No call plan is made and no call is placed, including a "yes" to a plan shown before the switch was flipped. "No" still clears a plan. Results of calls already placed are still reported. | `lib/agent/voice-call.ts` (`tryVoiceCall`, the only caller of `placeCall`) |
| `GOGO_LOGGED_IN_BROWSER` | Anything that acts in the person's signed-in browser refuses: cart actions, form submits, bookings, external account creation, saved Vault logins, reads of account sites (Vault provider domains), signed-in commerce sessions, product-watch add-to-cart, and Settings site sign-in. Plain public reads (Google Flights search, public pages, price comparisons) still work, but public-only: no saved login is filled and no phone sign-in is attempted. | `lib/agent/browser-command.ts` (`runBrowserCommand`, `executeBrowser`), `lib/agent/approval-guard.ts`, `lib/agent/secure-computer.ts`, `lib/agent/watchers.ts`, `lib/dashboard/site-sessions.ts` |
| `GOGO_BRAIN` | Turns the Gogo brain canary off for everyone; messages use the existing routing pipeline. (`GOGO_BRAIN_USERS` lists the canary numbers.) | `lib/agent/brain.ts` (`brainEnabledFor`), `app/api/webhooks/whatsapp/route.ts`, `app/api/dashboard/chat/route.ts` |
| `UNDERSTAND_FIRST_LIVE` | Understand-first stays in shadow only: it records its reading but never answers live (default on). | `lib/agent/understand-first.ts` |

The shared helper for the three capability switches is `capabilityPaused(name, env)` in `lib/agent/policy.ts`
(with `pausedBrowserCapability` and `capabilityPausedText`). Tests: `scripts/verify-capability-kill-switches-oct28.mts`.
