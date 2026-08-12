import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { deleteReminderById, updateReminderById } from '@/lib/dashboard/reminder-writes'
import { todayInTz, wallTimeToUtcIso } from '@/lib/dashboard/wall-time'

// Reads cookies + headers per request → never cache. (Non-GET handlers aren't cached
// anyway, but the session read makes this explicit.)
export const dynamic = 'force-dynamic'

// ── Reminder mutations: DELETE (remove) and PATCH (edit text/time) ─────────────
// Both are non-GET by design: sameSite=lax attaches the session cookie on top-level
// GET navigation, so a mutation behind GET would be CSRF-able no matter what. Every
// handler runs verifySameOrigin first (see lib/dashboard/guard.ts), then resolves
// identity from the session — telegram_id is NEVER taken from the URL or body.
// Response is always the { ok } discriminated shape used across the dashboard.

function unauthorized() {
  return NextResponse.json({ ok: false }, { status: 401 })
}

// Wall-clock → UTC lives in the zero-import lib/dashboard/wall-time.ts so it can be
// unit-tested; the route just supplies the AUTHORITATIVE stored tz (never a client zone).
async function userTimezone(telegramId: number): Promise<string> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('timezone')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  return data?.timezone || 'Asia/Kolkata'
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

  const session = await getSession()
  if (!session) return unauthorized()
  const tgNum = parseInt(session.telegramId, 10)
  if (!Number.isFinite(tgNum)) return unauthorized()

  const { id } = await params
  const res = await deleteReminderById(tgNum, id)
  if (!res.ok) {
    return NextResponse.json({ ok: false }, { status: res.reason === 'not_found' ? 404 : 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked

  const session = await getSession()
  if (!session) return unauthorized()
  const tgNum = parseInt(session.telegramId, 10)
  if (!Number.isFinite(tgNum)) return unauthorized()

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Malformed request.' }, { status: 400 })
  }
  const b = body as { message?: unknown; time?: unknown }

  const message = typeof b.message === 'string' ? b.message.trim() : undefined
  if (message !== undefined && message.length === 0) {
    return NextResponse.json({ ok: false, error: 'A reminder needs some text.' }, { status: 400 })
  }

  let remindAt: string | undefined
  if (typeof b.time === 'string') {
    const m = b.time.match(/^(\d{2}):(\d{2})$/)
    const hh = m ? Number(m[1]) : NaN
    const mm = m ? Number(m[2]) : NaN
    if (!m || hh > 23 || mm > 59) {
      return NextResponse.json({ ok: false, error: 'That time didn’t look right.' }, { status: 400 })
    }
    const tz = await userTimezone(tgNum)
    const { y, mo, d } = todayInTz(tz)
    remindAt = wallTimeToUtcIso(tz, y, mo, d, hh, mm)
  }

  if (message === undefined && remindAt === undefined) {
    return NextResponse.json({ ok: false, error: 'Nothing to change.' }, { status: 400 })
  }

  const res = await updateReminderById(tgNum, id, { message, remindAt })
  if (!res.ok) {
    const status = res.reason === 'not_found' ? 404 : res.reason === 'recurring' ? 409 : 500
    const error =
      res.reason === 'recurring' ? 'Repeating reminders can’t be edited here — delete it instead.' : undefined
    return NextResponse.json({ ok: false, error }, { status })
  }
  return NextResponse.json({ ok: true })
}
