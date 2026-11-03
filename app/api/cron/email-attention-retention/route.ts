// P1 privacy: private email-attention shown cards must expire even when the owner goes dormant.
// This service-role job is deliberately small, idempotent and cron-authenticated.
// No message contents, identities or recipient details are read or returned.
import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/security/cron-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RETENTION_DAYS = 30
const BATCH_LIMIT = 100
const DAY_MS = 86_400_000
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString()
  try {
    // A private shown card is useful for numbered "email 1" follow-ups for 24h,
    // but its saved sender/subject/snippet must not persist indefinitely.
    // Never read event payloads to perform cleanup.
    const { data: candidates, error: readError } = await supabaseAdmin
      .from('email_attention_events')
      .select('id')
      .eq('kind', 'shown')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(BATCH_LIMIT)

    if (readError || !Array.isArray(candidates)) {
      console.error('EMAIL_ATTENTION_RETENTION_READ_FAILED')
      return NextResponse.json({ ok: false, error: 'retention_read_failed' }, { status: 503 })
    }
    const ids = candidates.map((row: { id?: unknown }) => row?.id)
    if (ids.some((id: unknown) => typeof id !== 'string' || !UUID.test(id))) {
      console.error('EMAIL_ATTENTION_RETENTION_IDS_INVALID')
      return NextResponse.json({ ok: false, error: 'retention_ids_invalid' }, { status: 503 })
    }
    if (ids.length === 0) return NextResponse.json({ ok: true, examined: 0, deleted: 0, moreMayRemain: false })

    // Recheck BOTH the expiry and 'shown' predicate at mutation time.
    // A record updated after the read or changed to another kind must survive.
    const { data: removed, error: deleteError } = await supabaseAdmin
      .from('email_attention_events')
      .delete()
      .in('id', ids)
      .eq('kind', 'shown')
      .lt('created_at', cutoff)
      .select('id')

    if (deleteError || !Array.isArray(removed)) {
      console.error('EMAIL_ATTENTION_RETENTION_DELETE_FAILED')
      return NextResponse.json({ ok: false, error: 'retention_delete_failed' }, { status: 503 })
    }
    // Counts only; no row identifiers, personal content or arbitrary database errors in the response.
    return NextResponse.json({
      ok: true,
      examined: ids.length,
      deleted: removed.length,
      moreMayRemain: candidates.length === BATCH_LIMIT,
    })
  } catch {
    console.error('EMAIL_ATTENTION_RETENTION_UNEXPECTED_FAILURE')
    return NextResponse.json({ ok: false, error: 'retention_failed' }, { status: 503 })
  }
}
