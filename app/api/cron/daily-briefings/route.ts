import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildMorningBriefing } from '@/lib/bot/handlers/morning-briefing'
import { buildThrowbackLine } from '@/lib/bot/handlers/throwback'
import { sendAskGogoEmail } from '@/lib/email/resend'
import { renderDailyBriefEmail } from '@/lib/email/daily-brief'
import { buildDailyBriefUnsubscribeUrl } from '@/lib/email/daily-brief-unsubscribe'

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

async function alreadyWhatsappSentToday(telegramId: number, today: string) {
  const marker = `ASKGOGO_DAILY_BRIEFING_SENT:${today}`

  const { data } = await supabaseAdmin
    .from('memories')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('content', marker)
    .limit(1)

  return Boolean(data?.length)
}

async function markWhatsappSentToday(telegramId: number, today: string) {
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content: `ASKGOGO_DAILY_BRIEFING_SENT:${today}`,
  })
}

async function alreadyEmailSentToday(telegramId: number, today: string) {
  const { data, error } = await supabaseAdmin
    .from('daily_brief_email_log')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('local_date', today)
    .limit(1)

  if (error) throw new Error(`daily_brief_email_log read failed: ${error.message}`)
  return Boolean(data?.length)
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
  if (!expected) return true
  const querySecret = new URL(req.url).searchParams.get('secret')
  const bearerSecret = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return secretMatches(bearerSecret, expected) || secretMatches(querySecret, expected)
}

function firstName(value: string | null | undefined) {
  return (value || 'there').trim().split(/\s+/)[0] || 'there'
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowIstParts()
  const nowMinutes = now.hour * 60 + now.minute

  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('telegram_id, name, whatsapp_id, email, briefing_enabled, briefing_time, weekly_brief, daily_brief_email_enabled')
    .or('briefing_enabled.eq.true,daily_brief_email_enabled.eq.true')
    .limit(150)

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let sentWhatsapp = 0
  let sentEmail = 0
  let skipped = 0
  const failures: any[] = []

  for (const user of users || []) {
    const telegramId = Number(user.telegram_id)
    try {
      if (!shouldRunForTime(user.briefing_time, nowMinutes)) {
        skipped++
        continue
      }

      const phone = normalizePhone(user.whatsapp_id)
      const recipient = String(user.email || '').trim().toLowerCase()

      const whatsappEligible = user.briefing_enabled === true && Boolean(phone)
      const emailEligible = user.daily_brief_email_enabled === true && Boolean(recipient)

      const sendWhatsapp = whatsappEligible && !(await alreadyWhatsappSentToday(telegramId, now.date))
      const sendEmail = emailEligible && !(await alreadyEmailSentToday(telegramId, now.date))

      if (!sendWhatsapp && !sendEmail) {
        skipped++
        continue
      }

      const briefing = await buildMorningBriefing(telegramId, user.name || 'there')
      const extraBlocks: string[] = []

      // Sunday extras (Throwback + optional week-ahead) are shared by WhatsApp and email.
      const istWeekday = new Date(`${now.date}T12:00:00+05:30`).getUTCDay()
      if (istWeekday === 0) {
        if (user.weekly_brief) {
          const wk = await weekAheadSummary(telegramId)
          if (wk) extraBlocks.push(wk)
        }
        const tb = await buildThrowbackLine(telegramId)
        if (tb) extraBlocks.push(tb)
      }

      const fullBriefing = [briefing, ...extraBlocks].filter(Boolean).join('\n\n')

      if (sendWhatsapp) {
        try {
          const reply = `☀️ *Good morning*\n\n${fullBriefing}\n\nReply *plan my day* to turn this into reminders.`
          await sendWhatsAppMessage(phone, reply)
          await markWhatsappSentToday(telegramId, now.date)
          sentWhatsapp++
        } catch (err: any) {
          failures.push({ telegram_id: telegramId, channel: 'whatsapp', error: err?.message || String(err) })
        }
      }

      if (sendEmail) {
        try {
          const unsubscribeUrl = buildDailyBriefUnsubscribeUrl(telegramId, recipient)
          const rendered = renderDailyBriefEmail({
            firstName: firstName(user.name),
            briefing: fullBriefing,
            localDate: now.date,
            unsubscribeUrl,
          })

          const send = await sendAskGogoEmail({
            to: recipient,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            unsubscribeUrl,
            idempotencyKey: `daily-brief/${telegramId}/${now.date}`,
            stream: 'daily-brief',
          })

          if (!send.ok) throw new Error(send.error)

          const { error: logError } = await supabaseAdmin.from('daily_brief_email_log').insert({
            telegram_id: telegramId,
            local_date: now.date,
            email: recipient,
            subject: rendered.subject,
            provider_message_id: send.id,
          })

          if (logError && logError.code !== '23505') {
            throw new Error(`daily brief log insert failed: ${logError.message}`)
          }

          sentEmail++
        } catch (err: any) {
          failures.push({ telegram_id: telegramId, channel: 'email', error: err?.message || String(err) })
        }
      }
    } catch (err: any) {
      failures.push({ telegram_id: user.telegram_id, channel: 'prepare', error: err?.message || String(err) })
    }
  }

  return NextResponse.json({
    ok: true,
    date: now.date,
    istTime: `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`,
    sent: sentWhatsapp,
    sentWhatsapp,
    sentEmail,
    skipped,
    failures,
  })
}
