import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'

export const dynamic = 'force-dynamic'

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildTwimlMessage(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${xmlEscape(message)}</Message>
</Response>`
}

function emptyTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
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

    console.log('WA inbound', {
      fromRaw,
      from,
      bodyRaw,
      profileName,
      numMedia,
    })

    if (!from) {
      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    if (!bodyRaw.trim() && numMedia === 0) {
      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    if (numMedia > 0 && !bodyRaw.trim()) {
      return new NextResponse(
        buildTwimlMessage('I can handle text right now. Media support will be added next.'),
        {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        }
      )
    }

    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: from,
      text: bodyRaw.trim(),
      userName: profileName,
      messageType: 'text',
    })

    console.log('WA processed reply', result.text)

    return new NextResponse(buildTwimlMessage(result.text), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error: any) {
    console.error('WA webhook error:', {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      status: error?.status,
      moreInfo: error?.moreInfo,
    })

    return new NextResponse(
      buildTwimlMessage('I hit a small issue just now. Please try again.'),
      {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      }
    )
  }
}
