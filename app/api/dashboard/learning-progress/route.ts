import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GOGO_LESSONS } from '@/lib/dashboard/lessons'

export const dynamic = 'force-dynamic'

const LESSON_KEYS = new Set(GOGO_LESSONS.map((lesson) => lesson.key))
const AUTO_VERIFIED = new Set(['first-reminder', 'recurring-reminders'])

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

async function readProgress(telegramId: number, lessonKey: string) {
  const { data, error } = await supabaseAdmin
    .from('learning_progress')
    .select('lesson_key, watched_at, completed')
    .eq('telegram_id', telegramId)
    .eq('lesson_key', lessonKey)
    .maybeSingle()
  return { data, error }
}

async function beginLesson(telegramId: number, lessonKey: string) {
  const current = await readProgress(telegramId, lessonKey)
  if (current.error) return { ok: false as const, error: 'read_failed' }
  if (current.data?.completed) return { ok: true as const, completed: true, watchedAt: current.data.watched_at }

  const watchedAt = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('learning_progress')
    .upsert({ telegram_id: telegramId, lesson_key: lessonKey, watched_at: watchedAt, completed: false }, { onConflict: 'telegram_id,lesson_key' })

  if (error) return { ok: false as const, error: 'save_failed' }
  return { ok: true as const, completed: false, watchedAt }
}

async function verifyLesson(telegramId: number, lessonKey: string) {
  const current = await readProgress(telegramId, lessonKey)
  if (current.error) return { ok: false as const, error: 'read_failed' }
  if (current.data?.completed) return { ok: true as const, completed: true }
  if (!current.data?.watched_at) return { ok: true as const, completed: false, reason: 'not_started' }

  let verified = false

  if (lessonKey === 'first-reminder') {
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .select('id')
      .eq('telegram_id', telegramId)
      .gte('created_at', current.data.watched_at)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return { ok: false as const, error: 'verify_failed' }
    verified = Boolean(data?.length)
  }

  if (lessonKey === 'recurring-reminders') {
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('is_recurring', true)
      .gte('created_at', current.data.watched_at)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return { ok: false as const, error: 'verify_failed' }
    verified = Boolean(data?.length)
  }

  if (!verified) return { ok: true as const, completed: false, reason: 'waiting_for_action' }

  const { error } = await supabaseAdmin
    .from('learning_progress')
    .update({ completed: true })
    .eq('telegram_id', telegramId)
    .eq('lesson_key', lessonKey)
  if (error) return { ok: false as const, error: 'save_failed' }

  return { ok: true as const, completed: true }
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
  const action = String(body?.action || 'complete')
  if (!LESSON_KEYS.has(lessonKey)) return NextResponse.json({ error: 'invalid_lesson' }, { status: 400 })

  if (action === 'start') {
    const result = await beginLesson(tg, lessonKey)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true, lessonKey, completed: result.completed, watchedAt: result.watchedAt })
  }

  if (action === 'verify') {
    if (!AUTO_VERIFIED.has(lessonKey)) return NextResponse.json({ error: 'not_auto_verified' }, { status: 400 })
    const result = await verifyLesson(tg, lessonKey)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json({ ok: true, lessonKey, completed: result.completed, reason: 'reason' in result ? result.reason : null })
  }

  // Intro and not-yet-instrumented lessons can still be completed by the learning UI.
  // Auto-verified skills deliberately cannot self-certify.
  if (AUTO_VERIFIED.has(lessonKey)) return NextResponse.json({ error: 'verification_required' }, { status: 409 })

  const { error } = await supabaseAdmin
    .from('learning_progress')
    .upsert({
      telegram_id: tg,
      lesson_key: lessonKey,
      watched_at: new Date().toISOString(),
      completed: true,
    }, { onConflict: 'telegram_id,lesson_key' })

  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, lessonKey, completed: true })
}
