import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { exportMemory, formatMemoryExport } from '@/lib/agent/memory-export'

export const dynamic = 'force-dynamic'

// Active Memory export (8 Nov): the signed-in owner downloads everything AskGogo remembers about them, with provenance.
// Exact owner: the session's telegram id as a string, never converted. GET ?format=md for the readable file, JSON otherwise.
export async function GET(request: Request) {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const owner = String(session.telegramId)
  // Owner ids can be negative (legacy WhatsApp-only accounts, e.g. -884501501): 8 Nov live 401 for the owner himself.
  if (!/^-?\d{1,20}$/.test(owner)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const x = await exportMemory(owner)
  const md = new URL(request.url).searchParams.get('format') === 'md'
  const stamp = x.generatedAt.slice(0, 10)
  if (md) return new NextResponse(formatMemoryExport(x), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="askgogo-memory-${stamp}.md"`, 'Cache-Control': 'no-store' } })
  return new NextResponse(JSON.stringify(x, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="askgogo-memory-${stamp}.json"`, 'Cache-Control': 'no-store' } })
}
