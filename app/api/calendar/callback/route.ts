import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { consumeCalendarOauthState, exchangeCode } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

function failedPageHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#F6F1E8"/><title>Calendar connection failed · AskGogo</title><style>*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F6F1E8;color:#16130F;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:100%;max-width:480px;background:#FFFDF9;border:1px solid rgba(22,19,15,.09);border-radius:28px;padding:34px;box-shadow:0 24px 70px rgba(45,32,22,.08);text-align:center}.mark{width:58px;height:58px;border-radius:18px;margin:0 auto 20px;background:#FFF0E5;display:grid;place-items:center;font-size:26px}h1{font-family:Georgia,serif;font-weight:400;font-size:36px;letter-spacing:-.03em;margin:0 0 12px}p{margin:0 0 14px;line-height:1.6;color:#5C554C}.pill{display:inline-block;margin-top:8px;padding:12px 20px;border-radius:999px;background:#157A6E;color:white;font-weight:800;font-size:14px}</style></head><body><div class="card"><div class="mark">!</div><h1>Calendar wasn’t connected.</h1><p>The Google authorization was missing, expired or could not be verified.</p><p>Return to Gogo and request a fresh Calendar connection link.</p><div class="pill">Connect calendar</div></div></body></html>`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const telegramId = consumeCalendarOauthState(searchParams.get('state') || '')

  if (!code || !telegramId) {
    return new NextResponse(failedPageHtml(), { status:400, headers:{'Content-Type':'text/html; charset=utf-8'} })
  }

  const tokens = await exchangeCode(code)
  if (!tokens?.refresh_token) {
    return new NextResponse(failedPageHtml(), { status:400, headers:{'Content-Type':'text/html; charset=utf-8'} })
  }

  const { error } = await supabaseAdmin.from('users').update({
    google_refresh_token: tokens.refresh_token,
    google_calendar_connected: true,
  }).eq('telegram_id', telegramId)

  if (error) {
    console.error('CALENDAR_CONNECTION_SAVE_FAILED:', error.message)
    return new NextResponse(failedPageHtml(), { status:500, headers:{'Content-Type':'text/html; charset=utf-8'} })
  }

  return NextResponse.redirect(new URL('/calendar-connected.html', req.url), 303)
}
