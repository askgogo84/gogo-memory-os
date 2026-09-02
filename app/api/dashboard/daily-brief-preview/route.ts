import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildMorningBriefing } from '@/lib/bot/handlers/morning-briefing'
import { renderDailyBriefEmail } from '@/lib/email/daily-brief'

export const dynamic = 'force-dynamic'

function todayIst() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const telegramId = Number(session.telegramId)
  if (!Number.isFinite(telegramId)) return NextResponse.json({ ok: false }, { status: 400 })

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('name')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  const name = (user?.name || 'Gogo').trim().split(/\s+/)[0] || 'Gogo'
  const briefing = await buildMorningBriefing(telegramId, name)
  const rendered = renderDailyBriefEmail({
    firstName: name,
    briefing,
    localDate: todayIst(),
    unsubscribeUrl: 'https://app.askgogo.in/dashboard/you',
  })

  return new NextResponse(rendered.html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
