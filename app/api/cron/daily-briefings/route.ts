import { NextRequest, NextResponse } from 'next/server'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildMorningBriefing } from '@/lib/bot/handlers/morning-briefing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function nowIstParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

function minutesSinceMidnight(timeValue: string | null | undefined) {
  const [hh, mm] = (timeValue || '08:00').split(':')
  return Number(hh || 8) * 60 + Number(mm || 0)
}

function shouldRunForTime(timeValue: string | null | undefined, nowMinutes: number) {
  const target = minutesSinceMidnight(timeValue)
  return nowMinutes >= target && nowMinutes <= target + 14
}

function normalizePhone(value: string | null | undefined) {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

async function alreadySentToday(telegramId: number, today: string) {
  const marker = `ASKGOGO_DAILY_BRIEFING_SENT:${today}`

  const { data } = await supabaseAdmin
    .from('memories')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('content', marker)
    .limit(1)

  return Boolean(data?.length)
}

async function markSentToday(telegramId: number, today: string) {
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content: `ASKGOGO_DAILY_BRIEFING_SENT:${today}`,
  })
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : ''

  if (expected && auth !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowIstParts()
  const nowMinutes = now.hour * 60 + now.minute

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('telegram_id, name, whatsapp_id, briefing_enabled, briefing_time')
    .eq('briefing_enabled', true)
    .not('whatsapp_id', 'is', null)
    .limit(100)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let sent = 0
  let skipped = 0
  const failures: any[] = []

  for (const user of users || []) {
    try {
      if (!shouldRunForTime(user.briefing_time, nowMinutes)) {
        skipped++
        continue
      }

      if (await alreadySentToday(Number(user.telegram_id), now.date)) {
        skipped++
        continue
      }

      const phone = normalizePhone(user.whatsapp_id)
      if (!phone) {
        skipped++
        continue
      }

      const briefing = await buildMorningBriefing(Number(user.telegram_id), user.name || 'there')
      const reply = `☀️ *Good morning*\n\n${briefing}\n\nReply *plan my day* to turn this into reminders.`

      await sendWhatsAppMessage(phone, reply)
      await markSentToday(Number(user.telegram_id), now.date)
      sent++
    } catch (err: any) {
      failures.push({ telegram_id: user.telegram_id, error: err?.message || String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    date: now.date,
    istTime: `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`,
    sent,
    skipped,
    failures,
  })
}
