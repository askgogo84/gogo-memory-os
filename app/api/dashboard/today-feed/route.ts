import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CARD_KEY_RE, KINDS, localDay } from '@/lib/dashboard/today-feed'

export const dynamic = 'force-dynamic'

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

// Today feed card state (5 Nov): Not now, Fewer like this, and main action taken. Owner-scoped activity rows only.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const session = await getSession()
  if (!session?.telegramId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { op?: unknown; card?: unknown; tz?: unknown } | null
  const op = body?.op, card = typeof body?.card === 'string' ? body.card : ''
  if (!['hide', 'fewer', 'done'].includes(String(op)) || !CARD_KEY_RE.test(card)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const kind = card.split(':')[0]
  if (!(KINDS as string[]).includes(kind)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const tz = typeof body?.tz === 'string' && body.tz.length <= 64 ? body.tz : 'Asia/Kolkata'
  const row = op === 'hide'
    ? { event_type: 'today_card_hidden', message: 'Today card hidden for the day.', metadata_json: { card, day: localDay(new Date(), tz).day } }
    : op === 'fewer'
      ? { event_type: 'today_kind_fewer', message: `Fewer ${kind} cards on Today.`, metadata_json: { kind, card } }
      : { event_type: 'today_card_done', message: 'Today card action taken.', metadata_json: { card } }
  const { error } = await supabaseAdmin.from('agent_activity').insert({ telegram_id: String(session.telegramId), ...row })
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 503 })
  return NextResponse.json({ ok: true })
}
