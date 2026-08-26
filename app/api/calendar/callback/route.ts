import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exchangeCode } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

// Success now redirects to the static /calendar-connected.html page; this markup
// only ever renders the failure case.
function failedPageHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Calendar connection failed</title>
  <style>
    body {
      margin: 0;
      font-family: Inter, Arial, sans-serif;
      background: #f8f6ef;
      color: #102018;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 460px;
      background: white;
      border-radius: 28px;
      padding: 34px 24px;
      box-shadow: 0 24px 70px rgba(0,0,0,0.08);
      text-align: center;
    }
    .logo {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      margin: 0 auto 18px;
      background: #FEE2E2;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 30px;
      letter-spacing: -0.04em;
    }
    p {
      margin: 0 0 16px;
      font-size: 17px;
      line-height: 1.55;
      color: #4b5a50;
    }
    .pill {
      display: inline-block;
      margin-top: 8px;
      padding: 14px 22px;
      border-radius: 999px;
      background: #0b6b35;
      color: white;
      font-weight: 800;
      font-size: 16px;
    }
    .small {
      margin-top: 20px;
      color: #7a827d;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">⚠️</div>
    <h1>Connection failed</h1>
    <p>Google Calendar could not be connected.</p>
    <p>Go back to WhatsApp and type:</p>
    <div class="pill">Connect calendar</div>
    <div class="small">Please try again once.</div>
  </div>
</body>
</html>`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const telegramId = searchParams.get('state')

  if (!code || !telegramId) {
    return new NextResponse(failedPageHtml(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const tokens = await exchangeCode(code)

  if (!tokens || !tokens.refresh_token) {
    return new NextResponse(failedPageHtml(), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  await supabaseAdmin
    .from('users')
    .update({
      google_refresh_token: tokens.refresh_token,
      google_calendar_connected: true,
    })
    .eq('telegram_id', parseInt(telegramId))

  // The OAuth scope is calendar-only (no openid/email), so the connected
  // account's email isn't available here — the static page falls back to
  // "your Google account" on its own, so we pass no ?email param.
  return NextResponse.redirect(new URL('/calendar-connected.html', req.url), 303)
}
