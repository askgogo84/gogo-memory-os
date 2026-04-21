import { NextRequest, NextResponse } from 'next/server'
import { exchangeGmailCode, getGoogleEmail } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!code || !state) {
      return NextResponse.json(
        { ok: false, error: 'Missing code or state' },
        { status: 400 }
      )
    }

    const telegramId = Number(state)
    const tokens = await exchangeGmailCode(code)

    if (!tokens?.access_token) {
      return NextResponse.json(
        { ok: false, error: 'Failed to exchange code' },
        { status: 400 }
      )
    }

    const email = await getGoogleEmail(tokens.access_token)

    const payload: any = {
      gmail_access_token: tokens.access_token,
      gmail_connected: true,
      gmail_connected_at: new Date().toISOString(),
    }

    if (tokens.refresh_token) payload.gmail_refresh_token = tokens.refresh_token
    if (email) payload.gmail_email = email

    const { error } = await supabaseAdmin
      .from('users')
      .update(payload)
      .eq('telegram_id', telegramId)

    if (error) {
      console.error('Save Gmail tokens failed:', error)
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return new NextResponse(
      `
      <html>
        <head>
          <title>Gmail Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #0f172a;
              color: white;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 24px;
            }
            .card {
              max-width: 520px;
              background: #111827;
              border: 1px solid #1f2937;
              border-radius: 16px;
              padding: 28px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.35);
            }
            h1 { margin-top: 0; font-size: 24px; }
            p { line-height: 1.6; color: #d1d5db; }
            .ok { color: #86efac; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ Gmail connected</h1>
            <p class="ok">Your Gmail account has been connected successfully.</p>
            <p>You can now go back to Telegram and continue using AskGogo.</p>
            ${email ? `<p>Connected email: <strong>${email}</strong></p>` : ''}
          </div>
        </body>
      </html>
      `,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }
    )
  } catch (err: any) {
    console.error('Gmail callback error:', err)
    return NextResponse.json(
      { ok: false, error: err?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}
