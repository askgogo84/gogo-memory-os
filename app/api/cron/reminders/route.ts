import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function getNextOccurrence(pattern: string, fromDate: Date): Date {
  const next = new Date(fromDate)
  const lower = pattern.toLowerCase()

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  const { data: due, error: dueError } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('sent', false)
    .lte('remind_at', now)
    .order('remind_at', { ascending: true })
    .limit(25)

  if (dueError) {
    console.error('CRON_REMINDERS_SELECT_FAILED:', dueError)
    return NextResponse.json(
      { ok: false, error: dueError.message },
      { status: 500 }
    )
  }

  const results: any[] = []

  for (const r of due || []) {
    const reminderText = `⏰ *Reminder*\n\n${r.message}${
      r.is_recurring ? `\n\nRepeats: ${r.recurring_pattern}` : ''
    }`

    try {
      if (r.whatsapp_to) {
        await sendWhatsApp(r.whatsapp_to, reminderText)

        results.push({
          id: r.id,
          channel: 'whatsapp',
          to: r.whatsapp_to,
          message: r.message,
          status: 'sent',
        })
      } else if (r.chat_id && Number(r.chat_id) > 0) {
        await sendTelegram(Number(r.chat_id), reminderText)

        results.push({
          id: r.id,
          channel: 'telegram',
          to: r.chat_id,
          message: r.message,
          status: 'sent',
        })
      } else {
        throw new Error(
          `No valid delivery target. whatsapp_to=${r.whatsapp_to || ''}, chat_id=${r.chat_id || ''}`
        )
      }

      if (r.is_recurring && r.recurring_pattern) {
        const nextDate = getNextOccurrence(r.recurring_pattern, new Date(r.remind_at))

        const { error: recurringError } = await supabaseAdmin.from('reminders').insert({
          telegram_id: r.telegram_id,
          chat_id: r.chat_id,
          whatsapp_to: r.whatsapp_to,
          message: r.message,
          remind_at: nextDate.toISOString(),
          sent: false,
          is_recurring: true,
          recurring_pattern: r.recurring_pattern,
        })

        if (recurringError) {
          console.error('RECURRING_REMINDER_INSERT_FAILED:', recurringError)
        }
      }

      const { error: updateError } = await supabaseAdmin
        .from('reminders')
        .update({ sent: true })
        .eq('id', r.id)

      if (updateError) {
        throw new Error(`Reminder sent but failed to mark sent: ${updateError.message}`)
      }
    } catch (error: any) {
      console.error('REMINDER_SEND_FAILED:', {
        id: r.id,
        message: r.message,
        whatsapp_to: r.whatsapp_to,
        chat_id: r.chat_id,
        error: error?.message || error,
      })

      results.push({
        id: r.id,
        channel: r.whatsapp_to ? 'whatsapp' : 'telegram',
        to: r.whatsapp_to || r.chat_id || null,
        message: r.message,
        status: 'failed',
        error: error?.message || String(error),
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
