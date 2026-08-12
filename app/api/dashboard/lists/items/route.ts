import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { setListItemDone } from '@/lib/data/lists'

export const dynamic = 'force-dynamic'

// PATCH — tick / untick one list item. Non-GET by design. The item is addressed by the
// (listName, text, addedAt) composite the client already holds — never by index. `done`
// is the DESIRED state (idempotent set, not a flip), so a double-tap or stale view can't
// invert the wrong way. Server-side setListItemDone routes through the CAS core, so a
// concurrent bot/dashboard write can't clobber this tick. The { ok } shape is uniform.

export async function PATCH(request: Request) {
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
  const b = body as { listName?: unknown; text?: unknown; addedAt?: unknown; done?: unknown }
  if (
    typeof b.listName !== 'string' ||
    typeof b.text !== 'string' ||
    typeof b.addedAt !== 'string' ||
    typeof b.done !== 'boolean'
  ) {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }

  const res = await setListItemDone(tgNum, b.listName, b.text, b.addedAt, b.done)
  if (!res.ok) {
    const status = res.reason === 'not_found' ? 404 : res.reason === 'conflict' ? 409 : 500
    const error =
      res.reason === 'conflict' ? 'That list just changed — pull to refresh and try again.' : undefined
    return NextResponse.json({ ok: false, error }, { status })
  }
  return NextResponse.json({ ok: true })
}
