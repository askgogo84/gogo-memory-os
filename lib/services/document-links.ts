/**
 * Document short-links — a branded, privacy-preserving indirection in front of
 * Supabase signed URLs.
 *
 * Retrieval replies used to paste the raw Supabase signed URL: very long, and it
 * leaks the storage path plus a signed token straight into chat. Instead we mint a
 * short OPAQUE token mapped to a document id in `document_links`, and hand out
 *   https://app.askgogo.in/f/<token>
 * On GET, /f/<token> resolves the token, re-scopes to the owner's row, and
 * generates a FRESH short-lived signed URL to redirect to. The signed URL is never
 * stored — only the token -> document mapping is.
 *
 * Privacy invariants:
 *  - The token is random (crypto.randomBytes) and encodes NO user/document metadata.
 *  - The signed Supabase URL is never persisted; only the token row is.
 *  - Tokens carry an expiry (sensitive 15m / normal 30d) and support revocation.
 *
 * Best-effort + non-fatal: a mint failure returns null so the caller can fall back
 * to a plain signed URL — retrieval still works, just with the ugly link.
 */

import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDocumentSignedUrl } from '@/lib/services/document-store'

const TABLE = 'document_links'

// Fresh Supabase signed-URL TTL used on every redirect. Deliberately short: each
// generated storage URL dies in ~2 min even while the branded token is still valid.
const SIGNED_URL_TTL_SECONDS = 120

// Token-level expiry windows. Sensitive documents are bearer links to high-risk
// material, so keep them short; users can ask again later to mint a fresh token.
const EXPIRY_MINUTES_SENSITIVE = 15
const EXPIRY_DAYS_NORMAL = 30

const BASE_URL = (
  process.env.NEXT_PUBLIC_SHORTLINK_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  'https://app.askgogo.in'
).replace(/\/+$/, '')

// Opaque, unguessable, non-sequential: 16 random bytes -> ~22-char base64url. No
// metadata is encoded — the token is meaningless without its `document_links` row.
function mintToken(): string {
  return randomBytes(16).toString('base64url')
}

export function shortLinkUrl(token: string): string {
  return `${BASE_URL}/f/${token}`
}

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Mint (or reuse) a short link for a document. Reuses an existing non-revoked,
 * non-expired token for the same (telegram_id, document_id) so repeat retrievals
 * don't bloat the table; otherwise inserts a fresh row with the right expiry
 * window. Returns the token, or null on any failure (caller falls back to the raw
 * signed URL).
 */
export async function createDocumentShortLink(params: {
  telegramId: number
  documentId: string
  sensitive: boolean
}): Promise<string | null> {
  try {
    if (!params.documentId) return null
    const nowIso = new Date().toISOString()

    // Reuse a still-valid token for this doc if one exists.
    const { data: existing } = await supabaseAdmin
      .from(TABLE)
      .select('token')
      .eq('telegram_id', params.telegramId)
      .eq('document_id', params.documentId)
      .is('revoked_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing?.token) return existing.token as string

    const token = mintToken()
    const expiresAt = params.sensitive
      ? isoMinutesFromNow(EXPIRY_MINUTES_SENSITIVE)
      : isoDaysFromNow(EXPIRY_DAYS_NORMAL)
    const { error } = await supabaseAdmin.from(TABLE).insert({
      token,
      document_id: params.documentId,
      telegram_id: params.telegramId,
      expires_at: expiresAt,
    })
    if (error) {
      console.error('SHORTLINK_INSERT_FAILED:', error.message)
      return null
    }
    return token
  } catch (err: any) {
    console.error('SHORTLINK_CREATE_FAILED:', err?.message || err)
    return null
  }
}

/**
 * Resolve a token to a FRESH short-lived Supabase signed URL, enforcing validity
 * (exists, not revoked, not expired) and re-scoping to the owner's document row.
 * Returns null on any miss/invalid so the route can emit a generic 404. Never
 * returns or persists the signed URL beyond the single redirect.
 */
export async function resolveShortLinkToSignedUrl(token: string): Promise<string | null> {
  try {
    const t = (token || '').trim()
    if (!t) return null

    const { data: link } = await supabaseAdmin
      .from(TABLE)
      .select('document_id, telegram_id, expires_at, revoked_at, accessed_count')
      .eq('token', t)
      .maybeSingle()
    if (!link) return null
    if (link.revoked_at) return null
    if (link.expires_at && new Date(link.expires_at as string).getTime() < Date.now()) return null

    // Re-scope to the owner's row; only this row's storage_path is ever signed.
    const { data: doc } = await supabaseAdmin
      .from('documents')
      .select('storage_path')
      .eq('id', link.document_id)
      .eq('telegram_id', link.telegram_id)
      .maybeSingle()
    const storagePath = (doc?.storage_path as string | null) || null
    if (!storagePath) return null

    const url = await getDocumentSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
    if (!url) return null

    // Best-effort access accounting — never blocks or fails the redirect.
    try {
      await supabaseAdmin
        .from(TABLE)
        .update({
          accessed_count: (Number((link as any).accessed_count) || 0) + 1,
          last_accessed_at: new Date().toISOString(),
        })
        .eq('token', t)
    } catch {
      /* non-fatal */
    }

    return url
  } catch (err: any) {
    console.error('SHORTLINK_RESOLVE_FAILED:', err?.message || err)
    return null
  }
}

/**
 * Revoke a short link (revocation support). Best-effort, non-fatal. Kept for
 * completeness so a token can be killed without deleting the row/audit trail.
 */
export async function revokeShortLink(token: string): Promise<void> {
  try {
    if (!token) return
    await supabaseAdmin.from(TABLE).update({ revoked_at: new Date().toISOString() }).eq('token', token)
  } catch (err: any) {
    console.error('SHORTLINK_REVOKE_FAILED:', err?.message || err)
  }
}
