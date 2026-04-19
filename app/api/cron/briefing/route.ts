import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get current IST hour and minute
  const now = new Date()
  const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const currentHour = istTime.getHours()
  const currentMinute = istTime.getMinutes()

  // Only run between 6:55 and 7:05 IST
  if (currentHour !== 7 || currentMinute > 5) {
    return NextResponse.json({ status: 'not briefing time', hour: currentHour, minute: currentMinute })
  }

  // Get all users with briefing enabled
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id, name, tier, platform')
    .eq('briefing_enabled', true)

  if (!users || users.length === 0) {
    return NextResponse.json({ sent: 0 })
  }

  let sentCount = 0

  for (const user of users as any[]) {
    const userId = user.telegram_id

    // Get today's reminders
    const todayStart = new Date(istTime)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(istTime)
    todayEnd.setHours(23, 59, 59, 999)

    const { data: todayReminders } = await supabaseAdmin
      .from('reminders')
      .select('message, remind_at')
      .eq('telegram_id', userId)
      .eq('sent', false)
      .gte('remind_at', todayStart.toISOString())
      .lte('remind_at', todayEnd.toISOString())
      .order('remind_at', { ascending: true })

    // Get memories count
    const { count: memoryCount } = await supabaseAdmin
      .from('memories')
      .select('*', { count: 'exact', head: true })
      .eq('telegram_id', userId)

    // Get lists
    const { data: lists } = await supabaseAdmin
      .from('lists')
      .select('list_name, items')
      .eq('telegram_id', userId)

    // Build briefing message
    const greeting = getGreeting(user.name || 'Friend')
    let briefing = `${greeting}\n\n`

    // Reminders section
    if (todayReminders && todayReminders.length > 0) {
      briefing += `*Today's reminders (${todayReminders.length}):*\n`
      for (const r of todayReminders) {
        const time = new Date(r.remind_at).toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
        })
        briefing += `- ${time} -- ${r.message}\n`
      }
      briefing += '\n'
    } else {
      briefing += `No reminders today. A clear day ahead!\n\n`
    }

    // Lists section
    if (lists && lists.length > 0) {
      const pendingLists = lists.filter((l: any) => {
        const items = l.items || []
        return items.some((i: any) => !i.done)
      })
      if (pendingLists.length > 0) {
        briefing += `*Lists with pending items:*\n`
        for (const l of pendingLists as any[]) {
          const pending = (l.items || []).filter((i: any) => !i.done).length
          briefing += `- ${l.list_name} -- ${pending} pending\n`
        }
        briefing += '\n'
      }
    }

    // Memory count
    briefing += `*Memory bank:* ${memoryCount || 0} facts stored\n\n`

    // Motivational footer
    briefing += getMotivation()

    // Send via appropriate channel
    if (user.whatsapp_id) {
      await sendWhatsApp(user.whatsapp_id, briefing)
      sentCount++
    }
    if (user.telegram_id && user.telegram_id > 0) {
      await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: user.telegram_id,
          text: briefing,
          parse_mode: 'Markdown',
        }),
      })
      sentCount++
    }
  }

  return NextResponse.json({ sent: sentCount })
}

function getGreeting(name: string): string {
  const day = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  return `Good morning, ${name}! Today is ${day}.`
}

function getMotivation(): string {
  const quotes = [
    'Have a productive day!',
    'Make today count!',
    'One step at a time.',
    'Focus on what matters most today.',
    'You have got this!',
    'Small progress is still progress.',
    'Today is full of possibilities.',
    'Start strong, finish stronger.',
  ]
  return quotes[Math.floor(Math.random() * quotes.length)]
}