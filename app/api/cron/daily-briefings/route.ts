import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildMorningBriefing } from '@/lib/bot/handlers/morning-briefing'
import { buildThrowbackLine } from '@/lib/bot/handlers/throwback'

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

async function weekAheadSummary(telegramId: number): Promise<string | null> {
  const nowIso = new Date().toISOString()
  const weekIso = new Date(Date.now() + 7 * 864e5).toISOString()
  const { data } = await supabaseAdmin
    .from('reminders')
    .select('message, remind_at')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .gte('remind_at', nowIso)
    .lte('remind_at', weekIso)
    .order('remind_at', { ascending: true })
    .limit(6)
  const rows = data || []
  if (!rows.length) return '🗓️ *Week ahead*: nothing scheduled yet — a clean slate.'
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso))
  const lines = rows.map((r: any) => `• ${fmt(r.remind_at)} — ${(r.message || 'Reminder')}`)
  return `🗓️ *Week ahead* (${rows.length} upcoming):\n${lines.join('\n')}`
}

function secretMatches(provided: string | null, expected: string) {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return true // no secret configured → open (matches prior behaviour)
  // Prefer the Authorization: Bearer header (keeps the secret out of URLs/logs).
  // The ?secret= query param is also accepted for parity with /api/cron/reminders
  // and cron-job.org jobs — see the security note; use the header if you can.
  const querySecret = new URL(req.url).searchParams.get('secret')
  const bearerSecret = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return secretMatches(bearerSecret, expected) || secretMatches(querySecret, expected)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowIstParts()
  const nowMinutes = now.hour * 60 + now.minute

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('telegram_id, name, whatsapp_id, briefing_enabled, briefing_time, weekly_brief')
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
      let reply = `☀️ *Good morning*\n\n${briefing}\n\nReply *plan my day* to turn this into reminders.`

      // Sunday extras (1B Throwback + 1E week-ahead)
      const istWeekday = new Date(`${now.date}T12:00:00+05:30`).getUTCDay() // 0 = Sunday
      if (istWeekday === 0) {
        if (user.weekly_brief) {
          const wk = await weekAheadSummary(Number(user.telegram_id))
          if (wk) reply += `\n\n${wk}`
        }
        const tb = await buildThrowbackLine(Number(user.telegram_id))
        if (tb) reply += `\n\n${tb}`
      }

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
