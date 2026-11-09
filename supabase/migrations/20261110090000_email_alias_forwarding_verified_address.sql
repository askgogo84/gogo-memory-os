-- red #1119: Gmail forwarding may only be marked active against a forwarding address recorded from Gmail's own
-- forwarding-confirmation email (from forwarding-noreply@google.com, carrying the confirmation code, addressed to the
-- owner's inbound alias). Nullable: rows without it are treated as "forwarding not confirmed".
alter table public.email_aliases add column if not exists forwarding_verified_address text;
