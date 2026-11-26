import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { consumeCalendarOauthState, exchangeCode, fetchPrimaryCalendarAccount, refreshAccessToken } from '@/lib/google-calendar'
import { saveExtraCalendarAccount } from '@/lib/services/google-calendar-accounts'
import { encryptGoogleToken, hasGoogleTokenEncryptionKey } from '@/lib/security/google-token-crypto'
import { clearOauthBindingCookie, oauthBindingMatches, readOauthBindingCookie } from '@/lib/security/oauth-browser-binding'

export const dynamic = 'force-dynamic'

function failedPageHtml(detail = 'The Google authorization was missing, expired or could not be verified.') {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#F6F1E8"/><title>Calendar connection failed · AskGogo</title><style>*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#F6F1E8;color:#16130F;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:100%;max-width:480px;background:#FFFDF9;border:1px solid rgba(22,19,15,.09);border-radius:28px;padding:34px;box-shadow:0 24px 70px rgba(45,32,22,.08);text-align:center}.mark{width:58px;height:58px;border-radius:18px;margin:0 auto 20px;background:#FFF0E5;display:grid;place-items:center;font-size:26px}h1{font-family:Georgia,serif;font-weight:400;font-size:36px;letter-spacing:-.03em;margin:0 0 12px}p{margin:0 0 14px;line-height:1.6;color:#5C554C}.pill{display:inline-block;margin-top:8px;padding:12px 20px;border-radius:999px;background:#157A6E;color:white;font-weight:800;font-size:14px}</style></head><body><div class="card"><div class="mark">!</div><h1>Calendar wasn’t connected.</h1><p>${detail}</p><p>Return to Gogo and request a fresh Calendar connection link.</p><div class="pill">Connect calendar</div></div></body></html>`
}

export async function GET(req: NextRequest) {
  return clearOauthBindingCookie(await handle(req), 'calendar')
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') || ''
  const telegramId = consumeCalendarOauthState(state)
  // Only the browser that opened the signed connect link (and got the cookie for THIS state) may finish the flow.
  // Checked before the code is exchanged, so nothing is saved for another browser.
  const boundToThisBrowser = oauthBindingMatches('calendar', state, readOauthBindingCookie(req, 'calendar'))

  if (!code || !telegramId || !boundToThisBrowser) {
    return new NextResponse(failedPageHtml(), { status:400, headers:{'Content-Type':'text/html; charset=utf-8'} })
  }

  const tokens = await exchangeCode(code)
  if (!tokens?.refresh_token) {
    return new NextResponse(failedPageHtml(), { status:400, headers:{'Content-Type':'text/html; charset=utf-8'} })
  }

  if (!hasGoogleTokenEncryptionKey()) {
    console.error('GOOGLE_TOKEN_ENCRYPTION_KEY_MISSING')
    return new NextResponse(failedPageHtml(), { status:503, headers:{'Content-Type':'text/html; charset=utf-8'} })
  }

  const encrypted = encryptGoogleToken(tokens.refresh_token)
  const savePrimary = async () => (await supabaseAdmin.from('users').update({
    google_refresh_token: encrypted,
    google_calendar_connected: true,
  }).eq('telegram_id', telegramId)).error

  // A second Google account is ADDED next to the first, never swapped in for it. The first
  // account stays primary; the same account connecting again just refreshes its token.
  const newEmail = (await fetchPrimaryCalendarAccount(tokens.access_token))?.toLowerCase() || null
  const { data: existing, error: lookupError } = await supabaseAdmin.from('users')
    .select('google_calendar_connected,google_refresh_token').eq('telegram_id', telegramId).maybeSingle()
  if (lookupError) {
    console.error('CALENDAR_CONNECTION_LOOKUP_FAILED:', lookupError.code)
    return new NextResponse(failedPageHtml('AskGogo could not check your existing Calendar connection.'), { status:503, headers:{'Content-Type':'text/html; charset=utf-8'} })
  }

  const primaryAccess = newEmail && existing?.google_calendar_connected && existing?.google_refresh_token
    ? await refreshAccessToken(String(existing.google_refresh_token))
    : null
  const primaryEmail = primaryAccess ? (await fetchPrimaryCalendarAccount(primaryAccess))?.toLowerCase() : null
  if (newEmail && primaryEmail && primaryEmail !== newEmail) {
    if (!await saveExtraCalendarAccount(telegramId, newEmail, encrypted)) {
      return new NextResponse(failedPageHtml('AskGogo could not save the additional calendar. Your primary calendar is still connected.'), { status:503, headers:{'Content-Type':'text/html; charset=utf-8'} })
    }
  } else {
    const error = await savePrimary()
    if (error) {
      console.error('CALENDAR_CONNECTION_SAVE_FAILED:', error.message)
      return new NextResponse(failedPageHtml(), { status:500, headers:{'Content-Type':'text/html; charset=utf-8'} })
    }
  }

  return NextResponse.redirect(new URL('/calendar-connected.html', req.url), 303)
}
