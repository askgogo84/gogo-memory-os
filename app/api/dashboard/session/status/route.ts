import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  return NextResponse.json({ ok: !!session }, { headers: { 'Cache-Control': 'no-store' } })
}
