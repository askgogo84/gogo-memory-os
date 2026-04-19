    import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exchangeCode } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const telegramId = searchParams.get('state')

  if (!code || !telegramId) {
    return NextResponse.redirect('https://bot.askgogo.in/?status=calendar-failed')
  }

  const tokens = await exchangeCode(code)
  if (!tokens || !tokens.refresh_token) {
    return NextResponse.redirect('https://bot.askgogo.in/?status=calendar-failed')
  }

  // Save refresh token
  await supabaseAdmin
    .from('users')
    .update({
      google_refresh_token: tokens.refresh_token,
      google_calendar_connected: true,
    })
    .eq('telegram_id', parseInt(telegramId))

  // Notify user via Telegram
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: parseInt(telegramId),
      text: `*Google Calendar connected!*\n\nYour calendar is now synced. Try:\n- _"Add meeting with Rahul Friday 3pm"_\n- _"What is on my calendar today?"_\n- Your daily briefing now includes calendar events!`,
      parse_mode: 'Markdown',
    }),
  })

  return NextResponse.redirect('https://bot.askgogo.in/?status=calendar-success')
}