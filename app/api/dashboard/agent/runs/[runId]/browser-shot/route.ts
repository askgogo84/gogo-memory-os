// Only a live, owner-scoped Vercel Sandbox handoff may supply browser screenshots.
// A persisted URL is not permission for arbitrary app-server egress.
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
const MAX_SHOT_BYTES = 4 * 1024 * 1024
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10]

/** Build the only permitted screenshot endpoint; never accept arbitrary metadata hosts or redirects. */
export function browserShotUrl(takeoverUrl: unknown): URL | null {
  if (typeof takeoverUrl !== 'string' || takeoverUrl.length > 2048) return null
  try {
    const url = new URL(takeoverUrl)
    // The real handoff is issued as https://sb-<sandbox>.vercel.run/?token=<24 random bytes>.
    if (url.protocol !== 'https:' || !/^sb-[a-z0-9-]+\.vercel\.run$/i.test(url.hostname)
      || url.port || url.username || url.password || url.pathname !== '/' || url.hash) return null
    const tokens = url.searchParams.getAll('token')
    if (tokens.length !== 1 || url.searchParams.size !== 1 || !/^[A-Za-z0-9_-]{32}$/.test(tokens[0])) return null
    url.pathname = '/shot'
    url.search = ''
    url.searchParams.set('token', tokens[0])
    return url
  } catch {
    return null
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { runId } = await params
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('metadata_json')
    .eq('id', runId)
    .eq('telegram_id', String(session.telegramId))
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const takeover = (data.metadata_json as any)?.handoff?.takeoverUrl
  if (!takeover) return NextResponse.json({ error: 'browser_preview_unavailable' }, { status: 404 })
  const url = browserShotUrl(takeover)
  if (!url) return NextResponse.json({ error: 'browser_preview_invalid' }, { status: 400 })

  try {
    // No redirect-follow: a trusted-looking relay can still redirect to an internal IP.
    const res = await fetch(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(5000) })
    if (res.status !== 200 || !/^image\/png(?:;|$)/i.test(res.headers.get('content-type') || ''))
      return NextResponse.json({ error: 'browser_preview_failed' }, { status: 502 })
    const declared = res.headers.get('content-length')
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_SHOT_BYTES))
      return NextResponse.json({ error: 'browser_preview_failed' }, { status: 502 })
    // Bound streamed bytes even when Content-Length is omitted or wrong.
    const reader = res.body?.getReader()
    if (!reader) return NextResponse.json({ error: 'browser_preview_failed' }, { status: 502 })
    const parts: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_SHOT_BYTES) {
        await reader.cancel().catch(() => {})
        return NextResponse.json({ error: 'browser_preview_failed' }, { status: 502 })
      }
      parts.push(value)
    }
    if (length < PNG_MAGIC.length)
      return NextResponse.json({ error: 'browser_preview_failed' }, { status: 502 })
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    if (!PNG_MAGIC.every((byte, i) => bytes[i] === byte))
      return NextResponse.json({ error: 'browser_preview_failed' }, { status: 502 })
    return new NextResponse(bytes.buffer, {
      status: 200,
      headers: { 'content-type': 'image/png', 'cache-control': 'no-store, max-age=0' },
    })
  } catch {
    return NextResponse.json({ error: 'browser_preview_failed' }, { status: 502 })
  }
}
