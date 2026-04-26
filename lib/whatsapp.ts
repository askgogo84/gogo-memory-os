import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const rawWhatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER

const client = twilio(accountSid!, authToken!)

function normalizeWhatsAppAddress(value: string): string {
  const clean = (value || '').trim()

  if (!clean) {
    throw new Error('Missing WhatsApp phone number')
  }

  if (clean.startsWith('whatsapp:')) {
    return clean
  }

  const normalized = clean.replace(/[^\d+]/g, '')

  if (!normalized) {
    throw new Error(`Invalid WhatsApp phone number: ${value}`)
  }

  return `whatsapp:${normalized}`
}

export async function sendWhatsApp(toNumber: string, text: string, mediaUrl?: string | null) {
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)

  const payload: any = {
    body: text,
    from,
    to,
  }

  if (mediaUrl && mediaUrl.trim()) {
    payload.mediaUrl = [mediaUrl.trim()]
  }

  const message = await client.messages.create(payload)

  console.log('WHATSAPP_SENT:', {
    sid: message.sid,
    from,
    to,
    status: message.status,
    hasMedia: Boolean(mediaUrl),
  })

  return message
}

export async function sendWhatsAppTypingIndicator(messageSid?: string | null) {
  const sid = (messageSid || '').trim()

  if (!sid || !accountSid || !authToken) {
    return false
  }

  const params = new URLSearchParams()
  params.append('messageId', sid)
  params.append('channel', 'whatsapp')

  const response = await fetch('https://messaging.twilio.com/v2/Indicators/Typing.json', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error('WHATSAPP_TYPING_INDICATOR_FAILED:', {
      status: response.status,
      body,
      messageSid: sid,
    })
    return false
  }

  console.log('WHATSAPP_TYPING_INDICATOR_SENT:', { messageSid: sid })
  return true
}
