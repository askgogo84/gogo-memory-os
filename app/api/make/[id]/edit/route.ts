// Make: change a deck or sheet from its own page ("make slide 3 shorter"), not only right after it was made in chat.
// Exact authenticated owner only; same model and validation as chat edits.
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const owner = exactSessionOwnerId(session.telegramId)
  if (!owner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body: any = await request.json().catch(() => null)
  const instruction = String(body?.instruction || '').replace(/\s+/g, ' ').trim()
  if (!instruction || instruction.length > 400) return NextResponse.json({ error: 'bad_instruction' }, { status: 400 })
  const { data: row, error } = await supabaseAdmin.from('agent_artifacts').select('telegram_id,content_json').eq('id', id).eq('telegram_id', owner).maybeSingle()
  if (error) return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503 })
  const data = row && exactSessionOwnerId(row.telegram_id) === owner ? row : null
  const content: any = data?.content_json
  if (!content?.doc || (content.doc.format !== 'deck' && content.doc.format !== 'sheet')) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { editDoc } = await import('@/lib/make/generate')
  const next = await editDoc(content.doc, instruction).catch(() => null)
  if (!next) return NextResponse.json({ error: 'edit_failed' }, { status: 502 })
  const { updateDoc } = await import('@/lib/make/store')
  await updateDoc(owner, id, content, next, instruction)
  return NextResponse.json({ ok: true })
}
