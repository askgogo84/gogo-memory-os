import { NextResponse } from 'next/server'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { ADMIN_COOKIE, adminIdentity, audit } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const blocked = verifySameOrigin(req)
  if (blocked) return blocked
  const admin = await adminIdentity()
  if (admin) await audit(admin, 'Locked console', 'Console')
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 })
  return res
}
