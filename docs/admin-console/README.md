# Admin console v1

Approved mock: "AskGogo Admin Console" (Claude design canvas, 21 Oct 2026). Approved decisions (Goverdhan, 21 Oct):
schema changes go ahead; every new number waits on the waitlist until an admin approves it, however many join.

## 1. Product (PRD)

One place at `app.askgogo.in/admin` for everything about AskGogo:

| Tab | What it answers |
|---|---|
| Overview | Waiting, approved, users, active, revenue, tasks today, spend, cost per active user; funnel; what needs attention |
| Waitlist | Who is waiting; approve (sends the invite), block, unblock, bulk actions, CSV export, sources |
| Users | Everyone with access: plan, status, messages, tasks, 30-day cost, paid, budget used; block/unblock |
| User detail | Tasks by type, cost breakdown, daily cost, connected apps, counts of what AskGogo holds (no contents), plan change |
| Tasks | Live feed (cancel), success by task type, failure reasons |
| Costs | Usage cost by day, category, service and user; revenue against cost by plan; editable rate card |
| Tools and APIs | Every vendor, what it does, plan, this month / last month, where the number comes from; invoices |
| System health | 15 background jobs (heartbeats, run now), access gate, metering, keys configured, failed calls, deploys |
| Architecture | The Archify map (served only to unlocked admins) |
| Access and audit | Admins and roles, password and sessions, the audit log |

## 2. Technical design (TRD)

- **Access gate** `lib/access/gate.ts`, called in the WhatsApp webhook after STOP handling and before `resolveUser`
  (so a held number never gets a users row). Existing users pass; `users.access_status='blocked'` is held;
  a new number is inserted into `waitlist` (`source='whatsapp'`) and gets one holding reply a day; `invited`
  rows pass and become `joined`. Admin numbers always pass. Any lookup error lets the message through
  (fail-open, logged). Kill switch: `ACCESS_GATE_ENABLED=false`.
- **Dashboard**: blocked accounts get no OTP and `createSession` refuses them; blocking deletes their sessions.
- **Console security**: step 1 is the existing dashboard session on an admin number (`ADMIN_WHATSAPP_NUMBERS`,
  owners) or an active `admin_members` row; step 2 is the admin password (scrypt hash in `admin_settings`, or
  `ADMIN_CONSOLE_PASSWORD_HASH` in Vercel). Unlock sets `askgogo_admin`, an HMAC cookie bound to the phone and the
  password hash (changing the password ends every console session), httpOnly, secure, SameSite=strict, 12 hours.
  5 wrong passwords in 15 minutes lock the console. Roles: viewer < operator < owner, checked on every action.
  Every action, sign-in, wrong password and lock goes to `admin_audit_log`.
- **Metering** `instrumentation.ts` → `lib/metering/fetch-meter.ts` wraps the global fetch once and records paid
  calls (Anthropic, OpenAI, Mercury, Tavily, Serper, Bolna, Browserbase, AssemblyAI, Resend) into
  `admin_cost_events`, with tokens read from a response clone. Outbound WhatsApp is metered in `lib/whatsapp.ts`.
  Attribution: `meterAs(telegramId)` (AsyncLocalStorage) in the WhatsApp webhook and dashboard chat; calls from
  scheduled jobs are `system` for now. Prices come from `admin_rate_card` (seeded estimates; owners edit them).
  Kept separate from `gogo_cost_events` so the cost guard's budgets do not change. Kill switch:
  `ADMIN_METERING_ENABLED=false`.
- **Tools and APIs**: `admin_tools` register (21 rows) + `admin_tool_costs` (invoices). Twilio comes from its usage
  API; metered vendors from `admin_cost_events`; the rest from invoices.
- **Health**: `proxy.ts` records a heartbeat (`admin_cron_heartbeat`) for each genuine cron call.

## 3. App flow

New number messages AskGogo → waitlist + holding reply → admin approves → invite (free text inside WhatsApp's
24-hour window, or the `TWILIO_INVITE_CONTENT_SID` template) → their next message gets them in → `joined`.
Admin opens `/admin` → signs in with number (dashboard) → password (first time: owner sets it) → console.

## 4. UI brief

Light, white ground, hairlines, one muted green accent, Instrument Sans, no italics, tap targets ≥ 44px, works at
375px (rail stacks above content, tables scroll inside their box).

## 5. Backend schema

`supabase/migrations/20261021150000_admin_console_v1.sql` (project qenhjcooyecmatwducpu): users access columns;
waitlist lifecycle columns (email/consent/country now optional for WhatsApp signups); admin_members,
admin_audit_log, admin_cost_events, admin_rate_card, admin_tools, admin_tool_costs, cron_heartbeats,
admin_login_attempts, admin_settings (RLS on, service role only, explicit grants); aggregate RPCs.

## 6. Implementation plan and tests

Shipped as one PR (#724). Tests: `scripts/verify-admin-console.mts` (wiring, cookie/password crypto, metering
classification and pricing), `scripts/verify-access-gate.mts` (gate behaviour on a fake database).
Known limits: scheduled-job usage is not yet attributed to a person; Vercel/Supabase/Browserbase/Plivo bills come
from invoices; invites to website signups need an approved WhatsApp template to be delivered.
