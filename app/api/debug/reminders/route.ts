import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function formatIst(iso: string | null) {
  if (!iso) return null

  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const secret = searchParams.get('secret')

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('reminders')
    .select('id, telegram_id, chat_id, whatsapp_to, message, remind_at, sent, is_recurring, recurring_pattern, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
      },
      { status: 500 }
    )
  }

  const reminders = (data || []).map((r: any) => ({
    id: r.id,
    message: r.message,
    sent: r.sent,
    whatsapp_to: r.whatsapp_to,
    chat_id: r.chat_id,
    telegram_id: r.telegram_id,
    remind_at_utc: r.remind_at,
    remind_at_ist: formatIst(r.remind_at),
    created_at_utc: r.created_at,
    created_at_ist: formatIst(r.created_at),
    is_due_now: !r.sent && r.remind_at <= nowIso,
    is_recurring: r.is_recurring,
    recurring_pattern: r.recurring_pattern,
  }))

  return NextResponse.json({
    ok: true,
    now_utc: nowIso,
    now_ist: formatIst(nowIso),
    count: reminders.length,
    reminders,
  })
}
