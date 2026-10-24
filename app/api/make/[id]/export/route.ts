// Make downloads: /api/make/<id>/export?format=pptx|xlsx|csv. Owner-scoped; reads the saved deck or sheet.
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TYPES: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await context.params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const format = new URL(request.url).searchParams.get('format') || ''
  if (!TYPES[format]) return NextResponse.json({ error: 'bad_format' }, { status: 400 })
  const ids = await (await import('@/lib/dashboard/owner-ids')).linkedTelegramIds(session.telegramId)
  const { data: row } = await supabaseAdmin.from('agent_artifacts').select('telegram_id,content_json').eq('id', id).maybeSingle()
  const data = row && ids.includes(String((row as any).telegram_id ?? '').trim()) ? row : null
  const doc: any = (data?.content_json as any)?.doc
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const ex = await import('@/lib/make/export')
  let body: Buffer | string
  if (doc.format === 'deck' && format === 'pptx') body = await ex.deckToPptx(doc)
  else if (doc.format === 'sheet' && format === 'xlsx') body = await ex.sheetToXlsx(doc)
  else if (doc.format === 'sheet' && format === 'csv') body = '﻿' + ex.sheetToCsv(doc)
  else return NextResponse.json({ error: 'bad_format' }, { status: 400 })
  return new NextResponse(typeof body === 'string' ? body : new Uint8Array(body), {
    headers: { 'Content-Type': TYPES[format], 'Content-Disposition': `attachment; filename="${ex.exportFileName(doc.title, format)}"`, 'Cache-Control': 'no-store' },
  })
}
