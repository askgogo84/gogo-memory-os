import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  // Simple secret check via query param instead of header
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')
  
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()
  const { data: due, error } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('sent', false)
    .lte('remind_at', now)

  console.log(`Cron ran at ${now}, found ${due?.length || 0} due reminders`)

  if (!due || due.length === 0) {
    return NextResponse.json({ sent: 0, checked_at: now })
  }

  await Promise.all(due.map(async (r) => {
    await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: r.chat_id,
          text: `⏰ *Reminder:* ${r.message}`,
          parse_mode: 'Markdown',
        }),
      }
    )
    await supabaseAdmin
      .from('reminders')
      .update({ sent: true })
      .eq('id', r.id)
  }))

  return NextResponse.json({ sent: due.length })
}