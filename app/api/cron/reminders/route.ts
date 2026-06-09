import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FAIL_ATTEMPTS = 3
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'

// Keywords that mean "send the actual morning briefing" not a dumb notification
const BRIEFING_KEYWORDS = /^(morning briefing|good morning|daily briefing|morning brief|briefing|my briefing)$/i

function isAuthorized(req: Request) {
  const { searchParams } = new URL(req.url)
  const querySecret = searchParams.get('secret')
  const authHeader = req.headers.get('authorization') || ''
  const bearerSecret = authHeader.replace(/^Bearer\s+/i, '').trim()
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return querySecret === expected || bearerSecret === expected
}

function getNextOccurrence(pattern: string, fromDate: Date): Date {
  const next = new Date(fromDate)
  const lower = pattern.toLowerCase()

  if (lower.includes('hourly_between')) { next.setHours(next.getHours() + 1); return next }
  if (lower.includes('every day') || lower.includes('daily')) next.setDate(next.getDate() + 1)
  else if (lower.includes('every week') || lower.includes('weekly')) next.setDate(next.getDate() + 7)
  else if (lower.includes('monday')) next.setDate(next.getDate() + ((1 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('tuesday')) next.setDate(next.getDate() + ((2 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('wednesday')) next.setDate(next.getDate() + ((3 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('thursday')) next.setDate(next.getDate() + ((4 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('friday')) next.setDate(next.getDate() + ((5 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('saturday')) next.setDate(next.getDate() + ((6 + 7 - next.getDay()) % 7 || 7))
  else if (lower.includes('sunday')) next.setDate(next.getDate() + ((0 + 7 - next.getDay()) % 7 || 7))
  else next.setDate(next.getDate() + 1)

  return next
}

async function sendTelegram(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN')
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${body}`)
  return body
}

async function findWhatsAppForReminder(reminder: any): Promise<string | null> {
  if (reminder.whatsapp_to) return reminder.whatsapp_to
  if (reminder.telegram_id) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('whatsapp_id, phone')
      .eq('telegram_id', reminder.telegram_id)
      .maybeSingle()
    if (data?.whatsapp_id) return data.whatsapp_id
    if (data?.phone) return data.phone
  }
  return null
}

async function markReminderSent(id: string) {
  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('Failed to mark reminder sent:', error.message)
}

async function incrementFailAttempts(id: string, current: number): Promise<number> {
  const next = (current || 0) + 1
  await supabaseAdmin
    .from('reminders')
    .update({ fail_attempts: next, last_failed_at: new Date().toISOString() })
    .eq('id', id)
  return next
}

// Fire the actual morning briefing for a user's WhatsApp number
async function triggerMorningBriefing(whatsappTo: string): Promise<boolean> {
  try {
    const res = await fetch(`${APP_URL}/api/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: whatsappTo }),
    })
    if (!res.ok) return false
    // POST returns { ok: true, reply } — we must send it to WhatsApp ourselves
    const data = await res.json()
    const briefingText = data?.reply
    if (briefingText) {
      await sendWhatsApp(whatsappTo, briefingText)
      console.log(`BRIEFING_SENT: ${whatsappTo}`)
    } else {
      console.error('BRIEFING_EMPTY_REPLY:', data)
      await sendWhatsApp(whatsappTo, '🌅 Good morning! Type *morning* to get your daily briefing.')
    }
    return true
  } catch (e) {
    console.error('BRIEFING_TRIGGER_FAILED:', e)
    return false
  }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const { data: due, error: dueError } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('sent', false)
    .lte('remind_at', now)
    .order('remind_at', { ascending: true })
    .limit(50)

  if (dueError) {
    console.error('CRON_REMINDERS_SELECT_FAILED:', dueError)
    return NextResponse.json({ ok: false, error: dueError.message }, { status: 500 })
  }

  const results: any[] = []

  for (const reminder of due || []) {
    const msgRaw = String(reminder.message || '').trim()
    const isBriefing = BRIEFING_KEYWORDS.test(msgRaw)
    const isFollowup = String(reminder.recurring_pattern || '').startsWith('followup:')

    // Build the reminder text
    const reminderText = isFollowup
      ? `🔔 *Follow-up reminder*\n\n📋 ${msgRaw}\n\nDid you hear back?\n• Reply *done* — mark as resolved\n• Reply *snooze 2 days* — remind again later\n• Reply *snooze friday* — remind on Friday`
      : `⏰ *Reminder*\n\n${msgRaw.replace(/^to\s+/i, '')}\n\nQuick actions:\n• snooze 10 mins\n• move it to 8 pm\n• done${reminder.is_recurring ? `\n\nRepeats: ${reminder.recurring_pattern}` : ''}`

    try {
      const whatsappTo = await findWhatsAppForReminder(reminder)

      if (whatsappTo) {
        if (isBriefing) {
          // Trigger the actual briefing instead of a dumb notification
          console.log(`BRIEFING_REMINDER: triggering actual briefing for ${whatsappTo}`)
          const ok = await triggerMorningBriefing(whatsappTo)
          if (!ok) {
            // Fallback: send a nudge if briefing API fails
            await sendWhatsApp(whatsappTo, '🌅 Good morning! Type *morning* to get your daily briefing.')
          }
        } else {
          await sendWhatsApp(whatsappTo, reminderText)
        }
        results.push({ id: reminder.id, channel: 'whatsapp', to: whatsappTo, message: msgRaw, status: 'sent', isBriefing })
      } else if (reminder.chat_id && Number(reminder.chat_id) > 0) {
        await sendTelegram(Number(reminder.chat_id), reminderText)
        results.push({ id: reminder.id, channel: 'telegram', to: reminder.chat_id, message: msgRaw, status: 'sent' })
      } else {
        throw new Error(`No delivery target. whatsapp_to=${reminder.whatsapp_to || ''}, telegram_id=${reminder.telegram_id || ''}, chat_id=${reminder.chat_id || ''}`)
      }

      if (reminder.is_recurring && reminder.recurring_pattern) {
        const nextDate = getNextOccurrence(reminder.recurring_pattern, new Date(reminder.remind_at))
        await supabaseAdmin.from('reminders').insert({
          telegram_id: reminder.telegram_id,
          chat_id: reminder.chat_id,
          whatsapp_to: reminder.whatsapp_to || null,
          message: reminder.message,
          remind_at: nextDate.toISOString(),
          sent: false,
          is_recurring: true,
          recurring_pattern: reminder.recurring_pattern,
        })
      }

      await markReminderSent(reminder.id)
    } catch (error: any) {
      const message = error?.message || String(error)
      const currentAttempts = reminder.fail_attempts || 0
      const newAttempts = await incrementFailAttempts(reminder.id, currentAttempts)

      console.error('REMINDER_SEND_FAILED:', {
        id: reminder.id, message: msgRaw,
        whatsapp_to: reminder.whatsapp_to, telegram_id: reminder.telegram_id,
        fail_attempts: newAttempts, error: message,
      })

      if (newAttempts >= MAX_FAIL_ATTEMPTS) {
        console.error(`REMINDER_ABANDONED id=${reminder.id} after ${newAttempts} attempts`)
        await markReminderSent(reminder.id)
      }

      results.push({
        id: reminder.id,
        channel: reminder.whatsapp_to ? 'whatsapp' : 'unknown',
        to: reminder.whatsapp_to || reminder.chat_id || null,
        message: msgRaw,
        status: newAttempts >= MAX_FAIL_ATTEMPTS ? 'abandoned' : 'failed',
        fail_attempts: newAttempts,
        error: message,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    checked_at: now,
    due_count: due?.length || 0,
    sent_count: results.filter((r) => r.status === 'sent').length,
    failed_count: results.filter((r) => r.status === 'failed').length,
    abandoned_count: results.filter((r) => r.status === 'abandoned').length,
    results,
  })
}

