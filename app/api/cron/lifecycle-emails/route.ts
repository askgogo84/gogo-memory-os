import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { LIFECYCLE_EMAILS, renderLifecycleEmail } from '@/lib/email/lifecycle'
import { sendAskGogoEmail } from '@/lib/email/resend'
import { buildUnsubscribeUrl } from '@/lib/email/unsubscribe'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_GAP_MS = 20 * 60 * 60 * 1000
const MAX_SENDS_PER_RUN = 50

function secretMatches(provided: string | null, expected: string) {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return true
  const querySecret = new URL(req.url).searchParams.get('secret')
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return secretMatches(bearer, expected) || secretMatches(querySecret, expected)
}

function daysSince(iso: string | null | undefined) {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

function firstName(name: string | null | undefined) {
  return (name || 'there').trim().split(/\s+/)[0] || 'there'
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

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
  const candidates: Array<{ telegramId: number; key: string; email: string; subject: string }> = []
  const failures: Array<{ telegramId: number; key?: string; error: string }> = []

  for (const user of users || []) {
    if (sent >= MAX_SENDS_PER_RUN && !dryRun) break
    const telegramId = Number(user.telegram_id)
    const recipient = String(user.email || '').trim().toLowerCase()
    if (!Number.isFinite(telegramId) || !recipient || user.email_opt_out === true) {
      skipped++
      continue
    }

    const { data: logRows, error: logError } = await supabaseAdmin
      .from('lifecycle_email_log')
      .select('email_key, sent_at')
      .eq('telegram_id', telegramId)
      .order('sent_at', { ascending: false })
      .limit(100)

    if (logError) {
      failures.push({ telegramId, error: `lifecycle_email_log: ${logError.message}` })
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

    if (!send.ok) {
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
