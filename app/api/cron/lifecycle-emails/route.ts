import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/security/cron-auth'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LIFECYCLE_EMAILS, renderLifecycleEmail } from '@/lib/email/lifecycle'
import { sendAskGogoEmail } from '@/lib/email/resend'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribe'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_GAP_MS = 20 * 60 * 60 * 1000
const MAX_SENDS_PER_RUN = 50

// Supabase BIGINT owners must never pass through a lossy JavaScript Number.
// Keep the exact signed 64-bit decimal owner for private history, unsubscribe,
// provider idempotency and delivery receipts. Reject unsafe numeric DB echoes.
function exactLifecycleOwnerId(value: unknown): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') return null
  const owner = String(value)
  if (!/^-?[1-9]\d{0,18}$/.test(owner)) return null
  const signed = BigInt(owner)
  if (signed < BigInt('-9223372036854775808') || signed > BigInt('9223372036854775807')) return null
  return owner
}

function daysSince(value:unknown){
  const started=Date.parse(String(value||''))
  return Number.isFinite(started)?Math.floor((Date.now()-started)/86400000):-1
}

function firstName(name: string | null | undefined) {
  return (name || 'there').trim().split(/\s+/)[0] || 'there'
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const dryRun = ['1', 'true', 'yes'].includes((url.searchParams.get('dry') || '').toLowerCase())

  const { data: users, error: usersError } = await supabaseAdmin
    .from('users')
    .select('telegram_id, name, email, email_captured_at, email_opt_out, onboarding_started_at, created_at')
    .not('email', 'is', null)
    .order('email_captured_at', { ascending: true, nullsFirst: false })
    .limit(250)

  if (usersError) return NextResponse.json({ ok: false, error: usersError.message }, { status: 500 })

  let sent = 0
  let skipped = 0
  const candidates: Array<{ telegramId: string; key: string; email: string; subject: string }> = []
  const failures: Array<{ telegramId: string; key?: string; error: string }> = []

  for (const user of users || []) {
    if (sent >= MAX_SENDS_PER_RUN && !dryRun) break
    const telegramId = exactLifecycleOwnerId(user.telegram_id)
    const recipient = String(user.email || '').trim().toLowerCase()
    if (!telegramId || !recipient || user.email_opt_out === true) {
      skipped++
      continue
    }

    const { data: logRows, error: logError } = await supabaseAdmin
      .from('lifecycle_email_log')
      .select('telegram_id,email_key,sent_at')
      .eq('telegram_id', telegramId)
      .order('sent_at', { ascending: false })
      .limit(100)

    if (logError) {
      failures.push({ telegramId, error: `lifecycle_email_log: ${logError.message}` })
      continue
    }

    // An unverified or rounded returned owner must not authorize a send.
    // A DB adapter may surface a BIGINT as an already-unsafe Number; fail closed.
    if ((logRows || []).some((row: any) => exactLifecycleOwnerId(row.telegram_id) !== telegramId)) {
      failures.push({ telegramId, error: 'lifecycle_email_log: owner_verification_failed' })
      continue
    }

    const logs = logRows || []
    const latestSentAt = logs[0]?.sent_at ? new Date(logs[0].sent_at).getTime() : 0
    if (latestSentAt && Date.now() - latestSentAt < MIN_GAP_MS) {
      skipped++
      continue
    }

    const alreadySent = new Set(logs.map((row: any) => String(row.email_key)))
    const startIso = user.email_captured_at || user.onboarding_started_at || user.created_at
    const ageDays = daysSince(startIso)
    const next = LIFECYCLE_EMAILS.find((entry) => entry.day <= ageDays && !alreadySent.has(entry.key))
    if (!next) {
      skipped++
      continue
    }

    const name = firstName(user.name)
    const unsubscribeUrl = buildUnsubscribeUrl(telegramId, recipient)
    const rendered = renderLifecycleEmail({ email: next, firstName: name, unsubscribeUrl })
    candidates.push({ telegramId, key: next.key, email: recipient, subject: rendered.subject })

    if (dryRun) continue

    const send = await sendAskGogoEmail({
      to: recipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl,
      idempotencyKey: `lifecycle/${telegramId}/${next.key}`,
    })

    if (send.ok === false) {
      failures.push({ telegramId, key: next.key, error: send.error })
      continue
    }

    const { error: logInsertError } = await supabaseAdmin.from('lifecycle_email_log').insert({
      telegram_id: telegramId,
      email_key: next.key,
      email: recipient,
      subject: rendered.subject,
      provider_message_id: send.id,
    })

    // A unique violation here means a concurrent cron run already recorded the
    // same lifecycle step. Resend receives the same idempotency key, so the
    // provider side remains duplicate-safe as well.
    if (logInsertError && logInsertError.code !== '23505') {
      failures.push({ telegramId, key: next.key, error: `log insert: ${logInsertError.message}` })
      continue
    }

    sent++
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    scanned: (users || []).length,
    sent,
    skipped,
    candidates: candidates.slice(0, 100),
    failures,
  })
}

