import { NextRequest, NextResponse } from 'next/server'
import { getAdminAnalytics } from '@/lib/bot/handlers/admin-analytics'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  const expected = process.env.ADMIN_DASHBOARD_TOKEN || ''

  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const analytics = await getAdminAnalytics()
  return NextResponse.json({ ok: true, analytics })
}
