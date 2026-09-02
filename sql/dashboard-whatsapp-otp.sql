-- WhatsApp OTP login challenges for the AskGogo dashboard.
-- User-run migration. Safe to run more than once.
-- Preview refresh after Twilio credentials were enabled for the Preview environment.

create table if not exists public.dashboard_otp_challenges (
  challenge_id text primary key,
  whatsapp_id text not null,
  telegram_id text,
  otp_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts integer not null default 0,
  request_ip_hash text
);

create index if not exists dashboard_otp_phone_created_idx
  on public.dashboard_otp_challenges (whatsapp_id, created_at desc);

create index if not exists dashboard_otp_expiry_idx
  on public.dashboard_otp_challenges (expires_at);

alter table public.dashboard_otp_challenges enable row level security;

-- No client policies on purpose. The dashboard OTP endpoints use the service role.
