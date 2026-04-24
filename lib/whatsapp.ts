import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID
const authToken = process.env.TWILIO_AUTH_TOKEN
const rawWhatsappFrom = process.env.TWILIO_WHATSAPP_NUMBER

if (!accountSid) {
  console.warn('Missing TWILIO_ACCOUNT_SID')
}

if (!authToken) {
  console.warn('Missing TWILIO_AUTH_TOKEN')
}

if (!rawWhatsappFrom) {
  console.warn('Missing TWILIO_WHATSAPP_NUMBER')
}

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

export async function sendWhatsApp(toNumber: string, text: string) {
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)

  const message = await client.messages.create({
    body: text,
    from,
    to,
  })

  console.log('WHATSAPP_SENT:', {
    sid: message.sid,
    from,
    to,
    status: message.status,
  })

  return message
}
