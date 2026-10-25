import { NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/admin/auth'
import { deliveryRpc } from '@/lib/services/reminder-delivery'

export const dynamic = 'force-dynamic'
export async function GET() {
  const admin = await requireAdminSession()
  if (!admin.ok) return NextResponse.json({ error: admin.reason }, { status: admin.status })
  try {
    return NextResponse.json(await deliveryRpc('delivery_health_report', {}), { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ error: 'delivery_health_unavailable' }, { status: 503 }) }
}
