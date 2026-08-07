import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  redeemToken,
  createSession,
  endSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/dashboard/session'

// POST — exchange a magic-link token for a session cookie.
// The redeemer (app/dashboard/page.tsx) calls this from the client with a POST,
// deliberately: a GET route would be fetched — and thus burned — by WhatsApp's
// link-preview crawler before the user ever taps the link. See that file.
//
// All failure modes (missing/invalid/expired/used token) return the same 401 so
// the client shows one "expired link" screen and an attacker learns nothing.
export async function POST(request: Request) {
  let token: string | null = null
  try {
    const body = await request.json()
    token = typeof body?.token === 'string' ? body.token : null
  } catch {
    token = null
  }
  if (!token) return NextResponse.json({ ok: false }, { status: 400 })

  const telegramId = await redeemToken(token)
  if (!telegramId) return NextResponse.json({ ok: false }, { status: 401 })

  const sessionId = await createSession(telegramId)
  if (!sessionId) return NextResponse.json({ ok: false }, { status: 500 })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  return NextResponse.json({ ok: true })
}

// DELETE — sign out. Deletes the session row server-side, then expires the cookie.
export async function DELETE() {
  await endSession()

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })

  return NextResponse.json({ ok: true })
}
