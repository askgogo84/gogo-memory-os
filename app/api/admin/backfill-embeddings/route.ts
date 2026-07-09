import { NextRequest, NextResponse } from 'next/server'
import { backfillEmbeddings } from '@/lib/services/memory-index'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/backfill-embeddings   Authorization: Bearer <CRON_SECRET>
// Optional body: { "limit": 500 }
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : ''
  if (!expected || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let limit = 500
  try {
    const body = await req.json()
    if (body && typeof body.limit === 'number') limit = body.limit
  } catch {
    /* no body is fine */
  }

  const result = await backfillEmbeddings(limit)
  return NextResponse.json({ ok: true, ...result })
}
