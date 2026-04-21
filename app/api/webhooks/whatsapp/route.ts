import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'

export const dynamic = 'force-dynamic'

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

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

    if (!from) {
      return new NextResponse('OK', { status: 200 })
    }

    if (!bodyRaw.trim() && numMedia === 0) {
      return new NextResponse('OK', { status: 200 })
    }

    if (numMedia > 0 && !bodyRaw.trim()) {
      await sendWhatsAppMessage(
        from,
        'I can handle text right now. Media support will be re-added in the next phase.'
      )
      return new NextResponse('OK', { status: 200 })
    }

    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: from,
      text: bodyRaw.trim(),
      userName: profileName,
      messageType: 'text',
    })

    await sendWhatsAppMessage(from, result.text)

    return new NextResponse('OK', { status: 200 })
  } catch (error: any) {
    console.error('WhatsApp webhook error:', error)
    return new NextResponse(error?.message || 'Internal error', { status: 500 })
  }
}

