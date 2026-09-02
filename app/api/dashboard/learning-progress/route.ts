import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const tg = parseInt(session.telegramId, 10)
  if (!Number.isFinite(tg)) return NextResponse.json({ error: 'invalid_session' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('learning_progress')
    .select('lesson_key, watched_at, completed')
    .eq('telegram_id', tg)
    .order('watched_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  return NextResponse.json({ progress: data || [] })
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const tg = parseInt(session.telegramId, 10)
  if (!Number.isFinite(tg)) return NextResponse.json({ error: 'invalid_session' }, { status: 400 })

  const body = await req.json().catch(() => null) as any
  const lessonKey = String(body?.lessonKey || '').trim().slice(0, 80)
  if (!/^[a-z0-9_-]{2,80}$/.test(lessonKey)) return NextResponse.json({ error: 'invalid_lesson' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('learning_progress')
    .upsert({
      telegram_id: tg,
      lesson_key: lessonKey,
      watched_at: new Date().toISOString(),
      completed: body?.completed !== false,
    }, { onConflict: 'telegram_id,lesson_key' })

  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, lessonKey })
}
