import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'

export const dynamic = 'force-dynamic'

// Listen button, cloud voice: the reply text in, MP3 out. Same-origin, signed-in, nothing stored, nothing logged
// beyond length. The device voice path never calls this.
export async function POST(request: Request) {
  const blocked = verifySameOrigin(request); if (blocked) return blocked
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { text?: unknown } | null
  const text = String(body?.text || '').slice(0, 1500)
  if (!text.trim()) return NextResponse.json({ ok: false, error: 'empty' }, { status: 400 })
  const { synthesizeSpeech } = await import('@/lib/services/voice-reply')
  const audio = await synthesizeSpeech(text)
  if (!audio) return NextResponse.json({ ok: false, error: 'tts_unavailable' }, { status: 503 })
  console.info('LISTEN_TTS:', JSON.stringify({ chars: text.length, bytes: audio.length }))
  return new NextResponse(new Uint8Array(audio), { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } })
}
