import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

  if (lower.includes('hourly_between')) {
    next.setHours(next.getHours() + 1)
    return next
  }

  if (lower.includes('every day') || lower.includes('daily')) {
    next.setDate(next.getDate() + 1)
  } else if (lower.includes('every week') || lower.includes('weekly')) {
    next.setDate(next.getDate() + 7)
  } else if (lower.includes('monday')) {
    next.setDate(next.getDate() + ((1 + 7 - next.getDay()) % 7 || 7))
  } else if (lower.includes('tuesday')) {
    next.setDate(next.getDate() + ((2 + 7 - next.getDay()) % 7 || 7))
  } else if (lower.includes('wednesday')) {
    next.setDate(next.getDate() + ((3 + 7 - next.getDay()) % 7 || 7))
  } else if (lower.includes('thursday')) {
    next.setDate(next.getDate() + ((4 + 7 - next.getDay()) % 7 || 7))
  } else if (lower.includes('friday')) {
    next.setDate(next.getDate() + ((5 + 7 - next.getDay()) % 7 || 7))
  } else if (lower.includes('saturday')) {
    next.setDate(next.getDate() + ((6 + 7 - next.getDay()) % 7 || 7))
  } else if (lower.includes('sunday')) {
    next.setDate(next.getDate() + ((0 + 7 - next.getDay()) % 7 || 7))
  } else {
    next.setDate(next.getDate() + 1)
  }

  return next
}

async function sendTelegram(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    throw new Error('Missing TELEGRAM_BOT_TOKEN')
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })

  const body = await res.text()

  if (!res.ok) {
    throw new Error(`Telegram send failed: ${res.status} ${body}`)
  }

  return body
}

async function findWhatsAppForReminder(reminder: any): Promise<string | null> {
  if (reminder.whatsapp_to) {
    return reminder.whatsapp_to
  }

  if (!reminder.telegram_id) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('whatsapp_id')
    .eq('telegram_id', reminder.telegram_id)
    .maybeSingle()

  if (error) {
    console.error('FIND_WHATSAPP_USER_FAILED:', error)
    return null
  }

  return data?.whatsapp_id || null
}

async function markReminderSent(id: string | number) {
  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ sent: true })
    .eq('id', id)

  if (error) {
    throw new Error(`Failed to mark reminder sent: ${error.message}`)
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
    return NextResponse.json(
      {
        ok: false,
        error: dueError.message,
      },
      { status: 500 }
    )
  }

  const results: any[] = []

  for (const reminder of due || []) {
    const reminderText = `⏰ *Reminder*\n\n${String(reminder.message || 'Reminder').replace(/^to\\s+/i, '').trim()}\n\nQuick actions:\n• snooze 10 mins\n• move it to 8 pm\n• done${reminder.is_recurring ? `\n\nRepeats: ${reminder.recurring_pattern}` : ''}`

    try {
      const whatsappTo = await findWhatsAppForReminder(reminder)

      if (whatsappTo) {
        await sendWhatsApp(whatsappTo, reminderText)

        results.push({
          id: reminder.id,
          channel: 'whatsapp',
          to: whatsappTo,
          message: reminder.message,
          status: 'sent',
        })
      } else if (reminder.chat_id && Number(reminder.chat_id) > 0) {
        await sendTelegram(Number(reminder.chat_id), reminderText)

        results.push({
          id: reminder.id,
          channel: 'telegram',
          to: reminder.chat_id,
          message: reminder.message,
          status: 'sent',
        })
      } else {
        throw new Error(
          `No delivery target found. whatsapp_to=${reminder.whatsapp_to || ''}, telegram_id=${reminder.telegram_id || ''}, chat_id=${reminder.chat_id || ''}`
        )
      }

      if (reminder.is_recurring && reminder.recurring_pattern) {
        const nextDate = getNextOccurrence(
          reminder.recurring_pattern,
          new Date(reminder.remind_at)
        )

        const { error: recurringError } = await supabaseAdmin.from('reminders').insert({
          telegram_id: reminder.telegram_id,
          chat_id: reminder.chat_id,
          whatsapp_to: reminder.whatsapp_to || null,
          message: reminder.message,
          remind_at: nextDate.toISOString(),
          sent: false,
          is_recurring: true,
          recurring_pattern: reminder.recurring_pattern,
        })

        if (recurringError) {
          console.error('RECURRING_REMINDER_INSERT_FAILED:', recurringError)
        }
      }

      await markReminderSent(reminder.id)
    } catch (error: any) {
      const message = error?.message || String(error)

      console.error('REMINDER_SEND_FAILED:', {
        id: reminder.id,
        message: reminder.message,
        whatsapp_to: reminder.whatsapp_to,
        telegram_id: reminder.telegram_id,
        chat_id: reminder.chat_id,
        error: message,
      })

      results.push({
        id: reminder.id,
        channel: reminder.whatsapp_to ? 'whatsapp' : 'unknown',
        to: reminder.whatsapp_to || reminder.chat_id || null,
        message: reminder.message,
        status: 'failed',
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
    results,
  })
}
