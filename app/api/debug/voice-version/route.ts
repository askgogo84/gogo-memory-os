import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    version: 'voice-first-v1-gpt-4o-mini-transcribe',
    features: [
      'WhatsApp voice note transcription',
      'Multilingual voice input',
      'Today command',
      'weather reply',
      'sports reply',
      'Gmail connect/read messages',
    ],
    checked_at: new Date().toISOString(),
  })
}
