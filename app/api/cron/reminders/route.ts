import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// After this many consecutive failures, mark reminder sent=true to stop the infinite retry loop
const MAX_FAIL_ATTEMPTS = 3

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
    if (lower.includes('every day') || lower.includes('daily')) { next.setDate(next.getDate() + 1) }
    else if (lower.includes('every week') || lower.includes('weekly')) { next.setDate(next.getDate() + 7) }
    else if (lower.includes('monday')) { next.setDate(next.getDate() + ((1 + 7 - next.getDay()) % 7 || 7)) }
    else if (lower.includes('tuesday')) { next.setDate(next.getDate() + ((2 + 7 - next.getDay()) % 7 || 7)) }
    else if (lower.includes('wednesday')) { next.setDate(next.getDate() + ((3 + 7 - next.getDay()) % 7 || 7)) }
    else if (lower.includes('thursday')) { next.setDate(next.getDate() + ((4 + 7 - next.getDay()) % 7 || 7)) }
    else if (lower.includes('friday')) { next.setDate(next.getDate() + ((5 + 7 - next.getDay()) % 7 || 7)) }
    else if (lower.includes('saturday')) { next.setDate(next.getDate() + ((6 + 7 - next.getDay()) % 7 || 7)) }
    else if (lower.includes('sunday')) { next.setDate(next.getDate() + ((0 + 7 - next.getDay()) % 7 || 7)) }
    else { next.setDate(next.getDate() + 1) }
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
    if (error) throw new Error(`Failed to mark reminder sent: ${error.message}`)
}

async function incrementFailAt
