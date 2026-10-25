import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  consumeGoogleState,
  exchangeGoogleDashboardCode,
  fetchGoogleIdentity,
  findTelegramIdForGoogle,
  linkGoogleIdentity,
  touchGoogleLogin,
} from '@/lib/dashboard/google-login'
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@/lib/dashboard/session'

export const dynamic = 'force-dynamic'

function dashboardUrl(req: NextRequest, status: string) {
  return new URL(`/dashboard?google=${encodeURIComponent(status)}`, req.url)
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const stateValue = req.nextUrl.searchParams.get('state')
  if (!code || !stateValue) return NextResponse.redirect(dashboardUrl(req, 'error'), 303)

  const state = await consumeGoogleState(stateValue)
  if (!state) return NextResponse.redirect(dashboardUrl(req, 'expired'), 303)

  const accessToken = await exchangeGoogleDashboardCode(code)
  if (!accessToken) return NextResponse.redirect(dashboardUrl(req, 'error'), 303)

  const identity = await fetchGoogleIdentity(accessToken)
  if (!identity) return NextResponse.redirect(dashboardUrl(req, 'error'), 303)

  let telegramId: string | null = null

  if (state.mode === 'link') {
    if (!state.telegramId) return NextResponse.redirect(dashboardUrl(req, 'error'), 303)
    const linked = await linkGoogleIdentity(state.telegramId, identity)
    if (!linked) return NextResponse.redirect(dashboardUrl(req, 'already-linked'), 303)
    telegramId = state.telegramId
  } else {
    telegramId = await findTelegramIdForGoogle(identity)
    if (!telegramId) return NextResponse.redirect(dashboardUrl(req, 'unlinked'), 303)
    await touchGoogleLogin(identity.sub)
  }

  const sessionId = await createSession(telegramId)
  if (!sessionId) return NextResponse.redirect(dashboardUrl(req, 'error'), 303)

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  return NextResponse.redirect(new URL('/dashboard/today', req.url), 303)
}
