import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { browserHandoffEndpointUrl } from '@/lib/agent/browser-handoff-health'

export const dynamic = 'force-dynamic'
const MAX_SHOT_BYTES = 6 * 1024 * 1024
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]

export async function GET(_request: Request, {params}: {params: Promise<{runId: string}>}) {
  const session = await getSession()
  if (!session) return NextResponse.json({error: 'unauthorized'}, {status: 401})
  const {runId} = await params
  const {data, error} = await supabaseAdmin.from('agent_runs')
    .select('metadata_json')
    .eq('id', runId)
    .eq('telegram_id', String(session.telegramId))
    .maybeSingle()
  if (error) return NextResponse.json({error: 'read_failed'}, {status: 500})
  if (!data) return NextResponse.json({error: 'not_found'}, {status: 404})

  const takeover = (data.metadata_json as any)?.handoff?.takeoverUrl
  if (!takeover) return NextResponse.json({error: 'browser_preview_unavailable'}, {status: 404})
  const url = browserHandoffEndpointUrl(takeover, '/shot')
  if (!url) return NextResponse.json({error: 'browser_preview_invalid'}, {status: 400})

  try {
    // Never follow redirects from the sandbox: a redirect may target loopback,
    // private infrastructure, cloud metadata or a different tenant.
    const res = await fetch(url, {cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000)})
    if (!res.ok || !/^image\/png(?:\s*;|\s*$)/i.test(res.headers.get('content-type') || '')) {
      return NextResponse.json({error: 'browser_preview_failed'}, {status: 502})
    }
    const announcedLength = Number(res.headers.get('content-length') || 0)
    if (!Number.isFinite(announcedLength) || announcedLength > MAX_SHOT_BYTES) {
      return NextResponse.json({error: 'browser_preview_failed'}, {status: 502})
    }
    const reader = res.body?.getReader()
    if (!reader) return NextResponse.json({error: 'browser_preview_failed'}, {status: 502})
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SHOT_BYTES) {
        await reader.cancel().catch(() => undefined)
        return NextResponse.json({error: 'browser_preview_failed'}, {status: 502})
      }
      chunks.push(value)
    }
    const png = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { png.set(chunk, offset); offset += chunk.byteLength }
    if (PNG_MAGIC.some((byte, index) => png[index] !== byte)) {
      return NextResponse.json({error: 'browser_preview_failed'}, {status: 502})
    }
    return new NextResponse(png.buffer, {status: 200, headers: {
      'content-type': 'image/png',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    }})
  } catch {
    return NextResponse.json({error: 'browser_preview_failed'}, {status: 502})
  }
}
