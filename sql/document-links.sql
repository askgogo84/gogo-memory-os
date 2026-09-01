-- ============================================================
-- Document short-links: opaque token -> document mapping behind a branded,
-- privacy-preserving file link (https://app.askgogo.in/f/<token>).
-- Paste this whole file into the Supabase SQL editor and Run.
-- Safe to run more than once (idempotent).
-- ============================================================

-- One row per issued short link. The token is random and opaque (no metadata),
-- the signed Supabase URL is NEVER stored here — only the token -> document map.
-- expires_at gives per-token expiry (sensitive 7d / normal 30d, set in code);
-- revoked_at gives revocation. document_id is text (matches how the app treats
-- documents.id as a string); resolution re-fetches the row and scopes by owner.
create table if not exists public.document_links (
  token            text primary key,
  document_id      text not null,
  telegram_id      bigint not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  accessed_count   integer not null default 0,
  last_accessed_at timestamptz
);

-- Reuse lookup: the latest still-valid token for a given (owner, document), so
-- repeat retrievals reuse one token instead of bloating the table.
create index if not exists document_links_owner_doc_idx
  on public.document_links (telegram_id, document_id);
