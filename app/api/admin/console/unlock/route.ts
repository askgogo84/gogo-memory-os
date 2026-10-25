import { NextResponse } from 'next/server'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { ADMIN_COOKIE, ADMIN_SESSION_MS, LOCK_AFTER, adminIdentity, audit, hashPassword, recentFailures, recordAttempt, setPasswordHash, signConsoleCookie, storedPasswordHash, verifyPassword } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'

// POST { password } — unlock the console. POST { newPassword } — first-time setup (owners only, only when none is set).
export async function POST(req: Request) {
  const blocked = verifySameOrigin(req)
  if (blocked) return blocked
  const admin = await adminIdentity()
  if (!admin) return NextResponse.json({ ok: false, error: 'not_admin' }, { status: 403 })
  const body = await req.json().catch(() => null) as any
  let hash = await storedPasswordHash()

  if (!hash) {
    if (admin.role !== 'owner') return NextResponse.json({ ok: false, error: 'owner_must_set_password' }, { status: 403 })
    const pw = String(body?.newPassword || '')
    if (pw.length < 10) return NextResponse.json({ ok: false, error: 'password_too_short' }, { status: 400 })
    hash = hashPassword(pw)
    try { await setPasswordHash(hash, admin.phone) } catch { return NextResponse.json({ ok: false, error: 'could_not_save' }, { status: 500 }) }
    await audit(admin, 'Set password', 'Console')
  } else {
    const failures = await recentFailures(admin.phone)
    if (failures >= LOCK_AFTER) {
      await audit(admin, 'Locked out', 'Console')
      return NextResponse.json({ ok: false, error: 'locked', retryAfterMinutes: 15 }, { status: 429 })
    }
    const ok = verifyPassword(String(body?.password || ''), hash)
    await recordAttempt(admin.phone, ok)
    if (!ok) {
      await audit(admin, 'Wrong password', 'Console')
      return NextResponse.json({ ok: false, error: 'wrong_password', triesLeft: Math.max(0, LOCK_AFTER - failures - 1) }, { status: 401 })
    }
    await audit(admin, 'Signed in', 'Console')
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, signConsoleCookie(admin.phone, hash), {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: Math.floor(ADMIN_SESSION_MS / 1000),
  })
  return res
}
