import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { createList } from '@/lib/data/lists'

export const dynamic = 'force-dynamic'

// POST — create a new (empty) list. Non-GET by design (see the reminders route header
// and lib/dashboard/guard.ts). An existing name is REFUSED with 409, never merged —
// that's the one behaviour that separates a Create button from the bot's append. The
// { ok } shape is uniform with the rest of the dashboard.
const MAX_NAME_LEN = 60

export async function POST(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })
  const tgNum = parseInt(session.telegramId, 10)
  if (!Number.isFinite(tgNum)) return NextResponse.json({ ok: false }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }
  const name = typeof (body as { name?: unknown }).name === 'string' ? (body as { name: string }).name.trim() : ''
  if (!name) return NextResponse.json({ ok: false, error: 'Give the list a name.' }, { status: 400 })
  if (name.length > MAX_NAME_LEN) {
    return NextResponse.json({ ok: false, error: 'That name is a bit long.' }, { status: 400 })
  }

  const res = await createList(tgNum, name)
  if (!res.ok) {
    const status = res.reason === 'exists' ? 409 : 500
    const error = res.reason === 'exists' ? 'You already have a list with that name.' : undefined
    return NextResponse.json({ ok: false, error }, { status })
  }
  return NextResponse.json({ ok: true })
}
