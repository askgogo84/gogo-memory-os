import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildMorningBriefing } from '@/lib/bot/handlers/morning-briefing'
import { sendTelegramMessage } from '@/lib/channels/telegram'

export const dynamic = 'force-dynamic'

function currentIstTimeKey() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

function todayIstDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function GET(_req: NextRequest) {
  const nowKey = currentIstTimeKey()
  const todayKey = todayIstDateKey()

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('telegram_id, name, briefing_enabled, briefing_time, updated_at')
    .eq('briefing_enabled', true)
    .eq('platform', 'telegram')

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let sent = 0

  for (const user of users || []) {
    const briefingTime = user.briefing_time || '08:00'

    if (briefingTime !== nowKey) continue

    const marker = `briefing_sent:${todayKey}:${briefingTime}`
    const { data: existing } = await supabaseAdmin
      .from('memories')
      .select('id')
      .eq('telegram_id', user.telegram_id)
      .eq('content', marker)
      .limit(1)

    if (existing && existing.length) continue

    const reply = await buildMorningBriefing(user.telegram_id, user.name || undefined)
    await sendTelegramMessage(user.telegram_id, reply)

    await supabaseAdmin.from('memories').insert({
      telegram_id: user.telegram_id,
      content: marker,
    })

    sent++
  }

  return NextResponse.json({ ok: true, sent, nowKey })
}
