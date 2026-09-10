import { NextRequest, NextResponse } from 'next/server'
import { consumeGmailOauthState, exchangeGmailCode, getGoogleEmail } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') || ''
    const telegramId = consumeGmailOauthState(state)

    if (!code || !telegramId) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or expired Google authorization' },
        { status: 400 }
      )
    }

    const tokens = await exchangeGmailCode(code)

    if (!tokens?.access_token) {
      return NextResponse.json(
        { ok: false, error: 'Failed to exchange code' },
        { status: 400 }
      )
    }

    const email = await getGoogleEmail(tokens.access_token)
    if (!email) {
      return NextResponse.json(
        { ok: false, error: 'Could not verify the connected Google account' },
        { status: 400 }
      )
    }

    const payload: any = {
      gmail_access_token: tokens.access_token,
      gmail_connected: true,
      gmail_connected_at: new Date().toISOString(),
      gmail_email: email,
    }

    if (tokens.refresh_token) payload.gmail_refresh_token = tokens.refresh_token

    const { error } = await supabaseAdmin
      .from('users')
      .update(payload)
      .eq('telegram_id', telegramId)

    if (error) {
      console.error('Save Gmail tokens failed:', error)
      return NextResponse.json(
        { ok: false, error: 'Could not save Google connection' },
        { status: 500 }
      )
    }

    return new NextResponse(
      `<!doctype html>
      <html>
        <head>
          <title>Google connected · AskGogo</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="theme-color" content="#F6F1E8" />
          <style>
            *{box-sizing:border-box}body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F6F1E8;color:#16130F;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}.card{max-width:560px;width:100%;background:#FFFDF9;border:1px solid rgba(22,19,15,.09);border-radius:28px;padding:34px;box-shadow:0 24px 70px rgba(45,32,22,.08)}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#157A6E}.mark{width:58px;height:58px;border-radius:18px;background:#FFF0E5;display:grid;place-items:center;font-size:28px;margin-bottom:24px}h1{font-family:Georgia,serif;font-weight:400;font-size:38px;letter-spacing:-.03em;margin:8px 0 12px}p{line-height:1.65;color:#5C554C;margin:0 0 14px}.ok{color:#157A6E;font-weight:700}.privacy{margin-top:22px;padding:16px 18px;border-radius:18px;background:#F0EEE8;font-size:13px}.email{font-weight:700;color:#16130F}
          </style>
        </head>
        <body>
          <div class="card">
            <div class="mark">✓</div>
            <div class="eyebrow">One Gogo · connected</div>
            <h1>Google Workspace is ready.</h1>
            <p class="ok">Gogo now has the read-only Google access you approved.</p>
            <p>Connected account: <span class="email">${email.replace(/[<>&"']/g, '')}</span></p>
            <div class="privacy">Gogo can read the approved Gmail, Contacts and Drive context to help with your requests. Sending email, changing files, scheduling, booking or spending still requires the appropriate permission and approval boundary.</div>
            <p style="margin-top:22px">You can close this window and return to AskGogo.</p>
          </div>
        </body>
      </html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    )
  } catch (err: any) {
    console.error('Gmail callback error:', err)
    return NextResponse.json(
      { ok: false, error: 'Google connection failed' },
      { status: 500 }
    )
  }
}
