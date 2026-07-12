import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/bot/resolve-user'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function istNowParts() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  }
}

function addIstDays(parts: { year: number; month: number; day: number }, daysToAdd: number) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd, 0, 0, 0))
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }
}

function istWallTimeToUtcIso(year: number, month: number, day: number, hour: number, minute: number) {
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0)).toISOString()
}

function formatIstDate(iso: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const phone = String(body.phone || '').trim()

    if (!phone) {
      return NextResponse.json({ ok: false, error: 'phone required' }, { status: 400 })
    }

    const resolvedUser = await resolveUser({
      channel: 'whatsapp',
      externalUserId: phone,
      userName: 'Friend',
    })

    const nowIst = istNowParts()
    const targetDate = addIstDays(nowIst, 14)
    const remindAtIso = istWallTimeToUtcIso(targetDate.year, targetDate.month, targetDate.day, 9, 0)
    const message = 'Do your next AskGogo Skin Check selfie'

    const { error } = await supabaseAdmin.from('reminders').insert({
      telegram_id: resolvedUser.telegramId,
      chat_id: resolvedUser.telegramId,
      whatsapp_to: phone,
      message,
      remind_at: remindAtIso,
      sent: false,
      timezone: resolvedUser.timezone || 'Asia/Kolkata',
    })

    if (error) throw error

    const displayTime = formatIstDate(remindAtIso)

    return NextResponse.json({
      ok: true,
      reply:
        `✅ *Skin Check reminder set*\n\n` +
        `I’ll remind you in 2 weeks at *9:00 AM* to take your next Skin Check selfie.\n\n` +
        `Scheduled for: ${displayTime}\n\n` +
        `Tip: take the next selfie in similar lighting for cleaner progress tracking.`,
    })
  } catch (error: any) {
    console.error('[skin-reminder] failed:', error?.message || error)
    return NextResponse.json(
      {
        ok: false,
        reply: `I couldn't create the Skin Check reminder right now. Please try: *remind me at 9 AM after 2 weeks to do skin check*`,
        error: error?.message || 'failed',
      },
      { status: 500 }
    )
  }
}
