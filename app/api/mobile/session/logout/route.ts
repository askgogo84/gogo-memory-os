import { NextRequest, NextResponse } from 'next/server'
import { revokeMobileSession } from '@/lib/mobile-auth/session'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const revoked = await revokeMobileSession(request)
    if (!revoked) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('MOBILE_SESSION_LOGOUT_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'logout_failed' }, { status: 500 })
  }
}
