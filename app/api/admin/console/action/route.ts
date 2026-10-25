import { NextResponse } from 'next/server'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { requireAdminConsole } from '@/lib/admin/console-auth'
import { runAdminAction } from '@/lib/admin/actions'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const blocked = verifySameOrigin(req)
  if (blocked) return blocked
  const gate = await requireAdminConsole('viewer')
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.step }, { status: gate.step === 'forbidden' ? 403 : 401 })
  const body = await req.json().catch(() => null)
  if (!body?.action) return NextResponse.json({ ok: false, error: 'no_action' }, { status: 400 })
  const result = await runAdminAction(gate.admin, String(body.action), body)
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
