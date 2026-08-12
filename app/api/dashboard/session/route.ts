import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  redeemToken,
  redeemCode,
  createSession,
  endSession,
  hashIp,
  isRedeemLocked,
  registerRedeemFail,
  clearRedeemThrottle,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'

// Per-request: we read the client IP from headers, so this must never cache.
export const dynamic = 'force-dynamic'

// POST — exchange a magic-link token OR a typed one-time code for a session.
// The magic-link redeemer (app/dashboard/page.tsx) calls this with a POST,
// deliberately: a GET route would be fetched — and thus burned — by WhatsApp's
// link-preview crawler before the user ever taps the link. The code form on the
// same page POSTs here too. See that file.
//
// ONE generic failure for EVERY case — malformed body, wrong / expired / used
// credential, throttle lockout, or a throttle-store error. Never reveal which:
// the difference is exactly the oracle a code-brute-forcer needs.
function genericFailure() {
  return NextResponse.json({ ok: false }, { status: 401 })
}

// Client IP for the throttle key — MUST be a value the platform sets, never one
// the client can set. Getting this wrong makes the whole rate limit decorative:
// if we trusted a client-controllable header, an attacker would just vary it and
// get a fresh bucket per request.
//
//  - x-real-ip is set by Vercel to the real connecting IP (single value); Vercel
//    overwrites any client-supplied copy. This is the primary source.
//  - x-forwarded-for: Vercel OVERWRITES it and does NOT forward client-supplied
//    XFF (per Vercel request-headers docs — spoof-safe on non-Enterprise). As a
//    fallback we take the LAST entry, never the first: the trailing entry is the
//    platform-appended connecting IP; only the leading entries could ever be
//    client-influenced. Taking [0] here would be the spoofable mistake.
function clientIp(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim()
  if (real) return real
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',')
    return parts[parts.length - 1].trim()
  }
  return ''
}

export async function POST(request: Request) {
  // Credential: magic-link token OR typed code — same route, same throttle.
  let token: string | null = null
  let code: string | null = null
  try {
    const body = await request.json()
    if (typeof body?.token === 'string') token = body.token
    if (typeof body?.code === 'string') code = body.code
  } catch {
    // no parseable body → no credential; falls through to generic failure
  }
  if (!token && !code) return genericFailure()

  // Peppered IP hash. Missing pepper → fail closed. Never bare-hash an IP.
  const ipHash = hashIp(clientIp(request))
  if (!ipHash) return genericFailure()

  // 1. Lockout check FIRST — before hashing input or touching the credential.
  //    Any throttle-store error fails closed (isRedeemLocked throws).
  try {
    if (await isRedeemLocked(ipHash)) return genericFailure()
  } catch {
    return genericFailure()
  }

  // 2. Only now hash the input and attempt the atomic burn. Token and code are
  //    mutually exclusive at input; prefer the token if a client sends both.
  const telegramId = token ? await redeemToken(token) : await redeemCode(code as string)

  // 3. Failure → register the attempt (drives the lockout), then fail generically.
  if (!telegramId) {
    await registerRedeemFail(ipHash)
    return genericFailure()
  }

  // 4. Success → best-effort clear the throttle, then mint the session.
  await clearRedeemThrottle(ipHash)

  const sessionId = await createSession(telegramId)
  // Post-burn infra failure (row already consumed). Distinct from a credential
  // failure — not an oracle — so a plain 500 is fine; the user requests a fresh one.
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
// Same-origin guarded like every other dashboard mutation (Phase 6): sign-out is
// low-stakes (idempotent, unauthenticated), but the posture is uniform on purpose —
// every state-changing dashboard route runs verifySameOrigin first, no exceptions.
export async function DELETE(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

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
