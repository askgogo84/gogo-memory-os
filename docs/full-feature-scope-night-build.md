# AskGogo Full Feature Scope — Night Build

This is the complete implementation/test scope recovered from prior AskGogo work and product materials. Every item must be classified as LIVE, GATED, BUILDING, or NEXT; nothing disappears silently.

## Core personal OS
- Reminders: one-time, recurring, contextual, Done / Snooze / Move, duplicate guard, delivery/read tracking.
- Tasks and follow-ups.
- Named lists and shared/family lists.
- Notes + semantic memory retrieval.
- Sensitive personal-details vault with masking and explicit reveal.
- Document/image/PDF ingestion, classification, summarisation and retrieval by meaning.
- Date extraction from tickets, leases, policies, bills, warranties, licences, passports and subscriptions.
- Daily brief: weather + calendar + reminders/tasks/priorities.
- Voice notes: transcription + action routing, mixed language, 90+ input languages / India-first flows.
- Calendar: read + approval-gated create/update/delete.
- Expenses/receipt scan and group bill split.
- Travel: ticket parsing, reminders, research, itinerary/calendar, check-in lifecycle.

## Network / family
- Friend-to-friend reminders with recipient consent before activation.
- Per-sender STOP/opt-out on outbound shared reminders.
- Family mode: shared reminders, household tasks, bills and lists.
- People/circle view and contacts permission boundary.

## Proactive autonomous brain
- Same brain across WhatsApp and dashboard.
- Goals and proactive Ideas.
- Background Gogo watchers with relevance, dedupe, cooldown and daily cap.
- Self-learning preference engine with evidence + provenance.
- Universal Life Events: travel, events, appointments, reservations, purchases, deliveries, bills, subscriptions, applications, documents.
- Lifecycle deep links and proactive date-driven alerts.
- Background workers protected by CRON_SECRET.

## Workspace / founder mode
- Google OAuth with least privilege.
- Gmail read context.
- Google Drive context and binary document reading.
- Calendar meeting planning and approval.
- Meeting notes -> summary -> decisions -> tasks/follow-ups.
- Email drafting/sending only behind permission + approval.

## Secure Computer / external actions
- Browser read/draft/execute permission levels.
- Sentinel checks before browser work and before approved consequential execution.
- Human-auth stop for password, OTP, CAPTCHA, passkey, passport/identity auth and payment auth.
- No purchase/payment/new charge without explicit approval.
- Atomic execution and fail-closed uncertain state.
- Secure human takeover UI (NEXT until implemented).

## Travel autonomous lifecycle
- Flight ticket -> durable Life Event.
- Check-in open-time scheduling.
- Verified airline deep-link only.
- Draft check-in preparation.
- Explicit irreversible check-in approval.
- WhatsApp/dashboard approval parity.
- Free-seat allocation only by default.
- No paid seat/baggage/meal/upgrade/insurance without separate approval.
- Terminal confirmation evidence required for success.
- Boarding-pass Gmail watcher/executor (BUILDING/NEXT until implemented).
- Flight disruption watcher.
- DigiYatra / country capability packs (NEXT).

## Purchase / delivery lifecycle — BUILDING
- Order confirmation -> Life Event.
- Delivery tracking watcher.
- Notify only on meaningful status/ETA changes.
- Delivery-to-read-receipt lifecycle.
- Warranty-end extraction and proactive reminder.
- Return/refund deadline reminder when evidence exists.
- Planner/actions implemented; dedicated external delivery executor remains NEXT.

## Bills / subscriptions — BUILDING
- Bill due-date extraction and reminder.
- Renewal/subscription date extraction.
- Proactive renewal notice before charge.
- Payment stays approval-gated; no silent autopay.
- Cancellation/deadline watcher where supported.
- Planner/actions implemented; dedicated provider executor remains NEXT.

## Documents / identity lifecycle — BUILDING
- Semantic retrieval by meaning, not filename.
- Lease/policy/licence/passport/warranty expiry reminders.
- Personal details vault: encrypted/masked, explicit reveal, never fabricate missing value.
- 30-day + 7-day expiry actions and renewal-prep planning implemented for document Life Events.

## Health/wellness records
- Health documents/prescriptions can be classified and stored as documents.
- Medicine/refill/renewal reminders only when user-provided evidence exists.
- No autonomous medical diagnosis/treatment action.

## India-first UX
- Hindi/Hinglish and Indian-language voice/text routing.
- Short lock-screen-readable replies.
- Mobile dashboard parity.
- Timezone-aware scheduling and local-time greeting.

## Growth / monetisation platform
- Referral/deep-link flows.
- Razorpay subscription/payment flows.
- Usage/metering limits and Cost Guard.
- CreditIQ integration surface.

## Production contract
Each production build must retain tests for every LIVE/GATED autonomous safety boundary. Features marked NEXT must stay visible in the canonical matrix until they are replaced by executable tests and code.