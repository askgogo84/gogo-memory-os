import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'

export const dynamic = 'force-dynamic'

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

function emptyTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  console.log('WhatsApp GET verify:', { mode, tokenPresent: !!token })

  if (
    mode === 'subscribe' &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge || 'OK', { status: 200 })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    const fromRaw = String(formData.get('From') || '')
    const bodyRaw = String(formData.get('Body') || '')
    const profileName = String(formData.get('ProfileName') || 'Friend')
    const numMedia = Number(formData.get('NumMedia') || '0')

    const from = normalizeWhatsAppNumber(fromRaw)

    console.log('WhatsApp inbound raw:', {
      fromRaw,
      from,
      bodyRaw,
      profileName,
      numMedia,
    })

    if (!from) {
      console.log('WhatsApp skipped: missing from')
      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    if (!bodyRaw.trim() && numMedia === 0) {
      console.log('WhatsApp skipped: empty body and no media')
      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    if (numMedia > 0 && !bodyRaw.trim()) {
      console.log('WhatsApp media-only message')
      await sendWhatsAppMessage(
        from,
        'I can handle text right now. Media support will be added next.'
      )

      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    console.log('WhatsApp before processIncomingMessage')
    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: from,
      text: bodyRaw.trim(),
      userName: profileName,
      messageType: 'text',
    })

    console.log('WhatsApp processed reply:', result.text)

    await sendWhatsAppMessage(from, result.text)

    console.log('WhatsApp send complete')

    return new NextResponse(emptyTwiml(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error: any) {
    console.error('WhatsApp webhook error:', error)
    return new NextResponse(emptyTwiml(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}

