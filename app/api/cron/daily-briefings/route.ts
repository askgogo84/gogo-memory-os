import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/security/cron-auth'
import { sendWhatsApp } from '@/lib/whatsapp'
import { deliverNotification, reconcileBriefingEmailReceipts } from '@/lib/services/notification-delivery'
import { isSuppressed } from '@/lib/bot/handlers/reminder-optout'
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
  return nowMinutes >= target
}

function normalizePhone(value: string | null | undefined) {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

async function alreadyWhatsappSentToday(telegramId: number, today: string) {
  const marker = `ASKGOGO_DAILY_BRIEFING_SENT:${today}`

  const { data, error } = await supabaseAdmin
    .from('memories')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('content', marker)
    .limit(1)

  if (error) throw new Error('legacy_briefing_marker_read_failed')
  return Boolean(data?.length)
}

async function markWhatsappSentToday(telegramId: number, today: string) {
  const { error } = await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content: `ASKGOGO_DAILY_BRIEFING_SENT:${today}`,
  })
  if (error) throw new Error('legacy_briefing_marker_write_failed')
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

function firstName(value: string | null | undefined) {
  return (value || 'there').trim().split(/\s+/)[0] || 'there'
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const deadline = Date.now() + 45000
  const now = nowIstParts()
  const nowMinutes = now.hour * 60 + now.minute
  const failures: { owner?: number; channel: string; status: string }[] = []
  let sentWhatsapp = 0, sentEmail = 0, checked = 0
  try {
    const receiptFailures = await reconcileBriefingEmailReceipts(Math.min(deadline, Date.now() + 8000))
    if (receiptFailures) failures.push({ channel: 'email_receipt', status: 'reconciliation_failed' })
    const { data: saved, error: cursorError } = await supabaseAdmin.from('delivery_scan_cursors').select('cursor_value').eq('source', 'briefing').maybeSingle()
    if (cursorError) throw new Error('briefing_cursor_read_failed')
    let cursor = Number(saved?.cursor_value ?? Number.MIN_SAFE_INTEGER)
    let exhausted = false
    while (Date.now() < deadline && checked < 500) {
      const { data: users, error } = await supabaseAdmin.from('users')
        .select('telegram_id, name, whatsapp_id, email, briefing_enabled, briefing_time, weekly_brief, daily_brief_email_enabled')
        .or('briefing_enabled.eq.true,daily_brief_email_enabled.eq.true').gt('telegram_id', cursor)
        .order('telegram_id', { ascending: true }).limit(50)
      if (error) throw new Error('briefing_users_read_failed')
      if (!users?.length) { exhausted = true; break }
      for (const user of users) {
        if (Date.now() >= deadline) break
        const owner = Number(user.telegram_id)
        let fullBriefing: string | null = null
        const prepare = async () => {
          if (fullBriefing !== null) return
          const briefing = await buildMorningBriefing(owner, user.name || 'there')
          const extras: string[] = []
          if (new Date(now.date + 'T12:00:00+05:30').getUTCDay() === 0) {
            if (user.weekly_brief) { const week = await weekAheadSummary(owner); if (week) extras.push(week) }
            const throwback = await buildThrowbackLine(owner); if (throwback) extras.push(throwback)
          }
          fullBriefing = [briefing, ...extras].filter(Boolean).join('\n\n')
        }
        const ready = async (channel: 'email' | 'whatsapp', target: string) => {
          const { data: fresh, error } = await supabaseAdmin.from('users')
            .select('whatsapp_id, email, briefing_enabled, briefing_time, daily_brief_email_enabled').eq('telegram_id', owner).maybeSingle()
          if (error) throw new Error('briefing_consent_read_failed')
          if (!fresh || nowIstParts().date !== now.date || !shouldRunForTime(fresh.briefing_time, nowMinutes)) return false
          return channel === 'email' ? fresh.daily_brief_email_enabled === true && String(fresh.email || '').trim().toLowerCase() === target
            : fresh.briefing_enabled === true && normalizePhone(fresh.whatsapp_id) === target && !await isSuppressed(owner, target)
        }
        try {
          if (shouldRunForTime(user.briefing_time, nowMinutes)) {
            const phone = normalizePhone(user.whatsapp_id)
            const email = String(user.email || '').trim().toLowerCase()
            // Legacy logs protect the rollout day; all new sends also use atomic jobs.
            if (user.briefing_enabled && phone && !await alreadyWhatsappSentToday(owner, now.date)) {
              const status = await deliverNotification({ key: 'briefing/' + owner + '/' + now.date + '/whatsapp', source: 'briefing', owner,
                channel: 'whatsapp', due: new Date().toISOString(), deadline, prepare, ready: () => ready('whatsapp', phone),
                send: async token => (await sendWhatsApp(phone, '☀️ *Good morning*\n\n' + fullBriefing + '\n\nReply *plan my day* to turn this into reminders.', null, token))?.sid || '',
                accepted: () => markWhatsappSentToday(owner, now.date) })
              if (status === 'provider_accepted') sentWhatsapp++
              if (['failed','outcome_unknown','persistence_failed'].includes(status)) failures.push({ owner, channel: 'whatsapp', status })
            }
            if (Date.now() < deadline && user.daily_brief_email_enabled && email && !await alreadyEmailSentToday(owner, now.date)) {
              let rendered: ReturnType<typeof renderDailyBriefEmail>
              let unsubscribeUrl: string
              const status = await deliverNotification({ key: 'briefing/' + owner + '/' + now.date + '/email', source: 'briefing', owner,
                channel: 'email', due: new Date().toISOString(), deadline,
                prepare: async () => { await prepare(); if (!process.env.RESEND_API_KEY) throw new Error('email_key_missing')
                  unsubscribeUrl = buildDailyBriefUnsubscribeUrl(owner, email)
                  rendered = renderDailyBriefEmail({ firstName: firstName(user.name), briefing: fullBriefing!, localDate: now.date, unsubscribeUrl }) },
                ready: () => ready('email', email),
                send: async token => {
                  const response = await sendAskGogoEmail({ to: email, ...rendered, unsubscribeUrl,
                    idempotencyKey: 'daily-brief/' + owner + '/' + now.date, stream: 'daily-brief' })
                  if (response.ok === false) throw Object.assign(new Error(response.error), { status: response.status })
                  if (!response.id) throw new Error('email_acceptance_id_missing')
                  return 'resend:' + response.id
                },
                accepted: async id => {
                  const { error } = await supabaseAdmin.from('daily_brief_email_log').insert({ telegram_id: owner,
                    local_date: now.date, email, subject: rendered.subject, provider_message_id: id.replace(/^resend:/, '') })
                  if (error && error.code !== '23505') throw new Error('email_log_write_failed')
                } })
              if (status === 'provider_accepted') sentEmail++
              if (['failed','outcome_unknown','persistence_failed'].includes(status)) failures.push({ owner, channel: 'email', status })
            }
          }
        } catch { failures.push({ owner, channel: 'prepare', status: 'failed' }) }
        cursor = owner; checked++
      }
    }
    const { error: saveError } = await supabaseAdmin.from('delivery_scan_cursors').upsert({ source: 'briefing', cursor_value: exhausted ? Number.MIN_SAFE_INTEGER : cursor })
    if (saveError) throw new Error('briefing_cursor_write_failed')
  } catch { failures.push({ channel: 'queue', status: 'failed' }) }
  return NextResponse.json({ ok: failures.length === 0, date: now.date, checked, acceptedWhatsapp: sentWhatsapp,
    acceptedEmail: sentEmail, sent: sentWhatsapp, sentWhatsapp, sentEmail, failures }, { status: failures.length ? 503 : 200 })
}
