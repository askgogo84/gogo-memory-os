import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function normaliseEmail(value: unknown) {
  const email = String(value || '').trim().toLowerCase()
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null
  return email
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const tg = Number(session.telegramId)
  if (!Number.isFinite(tg)) return NextResponse.json({ ok: false }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('email, daily_brief_email_enabled, briefing_time')
    .eq('telegram_id', tg)
    .maybeSingle()

  if (error) {
    console.error('DAILY_BRIEF_EMAIL_PREF_READ_FAILED:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    email: data?.email || '',
    enabled: data?.daily_brief_email_enabled === true,
    briefingTime: data?.briefing_time || '08:00',
  })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const tg = Number(session.telegramId)
  if (!Number.isFinite(tg)) return NextResponse.json({ ok: false }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const email = normaliseEmail(body?.email)
  if (!email) return NextResponse.json({ ok: false, error: 'Enter a valid email address.' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('users')
    .update({ email, daily_brief_email_enabled: true })
    .eq('telegram_id', tg)

  if (error) {
    console.error('DAILY_BRIEF_EMAIL_PREF_UPDATE_FAILED:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({ ok: true, email, enabled: true })
}

export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const tg = Number(session.telegramId)
  if (!Number.isFinite(tg)) return NextResponse.json({ ok: false }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('users')
    .update({ daily_brief_email_enabled: false })
    .eq('telegram_id', tg)

  if (error) {
    console.error('DAILY_BRIEF_EMAIL_PREF_DISABLE_FAILED:', error)
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  return NextResponse.json({ ok: true, enabled: false })
}
