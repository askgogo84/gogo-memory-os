import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    version: 'voice-first-v1-gpt-4o-mini-transcribe',
    features: [
      'WhatsApp voice note transcription',
      'Multilingual voice input',
      'Today command',
      'Premium weather reply',
      'Premium sports reply',
      'Cleaner Gmail connect/read messages'
    ],
    required_env: ['OPENAI_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'],
    deployed_at: new Date().toISOString(),
  })
}
