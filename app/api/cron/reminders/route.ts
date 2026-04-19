import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

function getNextOccurrence(pattern: string, fromDate: Date): Date {
  const next = new Date(fromDate)
  const lower = pattern.toLowerCase()
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  // === SEND DUE REMINDERS ===
  const { data: due } = await supabaseAdmin
    .from('reminders').select('*')
    .eq('sent', false).lte('remind_at', now)

  let sentCount = 0
  if (due && due.length > 0) {
    await Promise.all(due.map(async (r: any) => {
      const reminderText = `*Reminder:* ${r.message}${r.is_recurring ? `\n(repeats ${r.recurring_pattern})` : ''}`

      if (r.whatsapp_to) {
        await sendWhatsApp(r.whatsapp_to, reminderText)
      } else if (r.chat_id) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: r.chat_id, text: reminderText, parse_mode: 'Markdown' }),
        })
      }

      if (r.is_recurring && r.recurring_pattern) {
        const nextDate = getNextOccurrence(r.recurring_pattern, new Date(r.remind_at))
        await supabaseAdmin.from('reminders').insert({
          telegram_id: r.telegram_id, chat_id: r.chat_id, whatsapp_to: r.whatsapp_to,
          message: r.message, remind_at: nextDate.toISOString(),
          sent: false, is_recurring: true, recurring_pattern: r.recurring_pattern,
        })
      }

      await supabaseAdmin.from('reminders').update({ sent: true }).eq('id', r.id)
    }))
    sentCount = due.length
  }

  // === EXPIRE TRIALS ===
  const { data: expiredTrials } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id, name')
    .eq('is_trial', true)
    .lt('trial_ends_at', now)

  if (expiredTrials && expiredTrials.length > 0) {
    for (const user of expiredTrials as any[]) {
      await supabaseAdmin.from('users')
        .update({ tier: 'free', is_trial: false })
        .eq('telegram_id', user.telegram_id)

      if (user.telegram_id && user.telegram_id > 0) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegram_id,
            text: `Your 7-day Pro trial has ended.\n\nYou're on Free now (20 msgs/day). Memories are safe!\n\nUpgrade: /upgrade`,
            parse_mode: 'Markdown',
          }),
        })
      }
    }
  }

  // === DAY 6 WARNING ===
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowEnd = new Date(tomorrow)
  tomorrowEnd.setHours(23, 59, 59)

  const { data: expiringTrials } = await supabaseAdmin
    .from('users')
    .select('telegram_id, name')
    .eq('is_trial', true)
    .gte('trial_ends_at', tomorrow.toISOString())
    .lte('trial_ends_at', tomorrowEnd.toISOString())

  if (expiringTrials && expiringTrials.length > 0) {
    for (const user of expiringTrials as any[]) {
      if (user.telegram_id && user.telegram_id > 0) {
        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.telegram_id,
            text: `Hey ${user.name}! Your Pro trial ends *tomorrow*.\n\nContinue at Rs 299/month or stay on Free.\n\nType /upgrade to see plans.`,
            parse_mode: 'Markdown',
          }),
        })
      }
    }
  }

  return NextResponse.json({ sent: sentCount })
}