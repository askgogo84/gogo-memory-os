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

// Central WhatsApp text sanitizer. WhatsApp does not render Markdown, so any
// route that sends a message must have its raw Markdown normalized here — this
// is the single chokepoint every send funnels through, so nothing can bypass it.
// Designed to be idempotent: text that is already WhatsApp-formatted is left as-is.
export function sanitizeMarkdownForWhatsApp(input: string): string {
  let text = String(input ?? '')

  // **bold** -> *bold* (WhatsApp uses single asterisks for bold)
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*')

  // ## / ### (and #…######) headings -> *bold* heading text
  text = text.replace(/^[ \t]*#{1,6}[ \t]+(.+?)[ \t]*$/gm, '*$1*')

  // strip any stray leading heading hashes left over (e.g. "#Heading", bare "## ")
  text = text.replace(/^[ \t]*#{1,6}[ \t]*/gm, '')

  // "- " bullets -> "• " (preserve leading indentation)
  text = text.replace(/^([ \t]*)-[ \t]+/gm, '$1• ')

  // strip citation markers like [1] [2] [3]
  text = text.replace(/[ \t]*\[\d+\]/g, '')

  return text
}

const WA_MAX_CHARS = 1550

function splitIntoChunks(text: string): string[] {
  if (text.length <= WA_MAX_CHARS) return [text]
  
  const chunks: string[] = []
  // Split on double newlines (section breaks) to keep sections together
  const sections = text.split(/\n\n/)
  let current = ''
  
  for (const section of sections) {
    const candidate = current ? current + '\n\n' + section : section
    if (candidate.length <= WA_MAX_CHARS) {
      current = candidate
    } else {
      if (current) chunks.push(current)
      // If single section is too long, split on single newlines
      if (section.length > WA_MAX_CHARS) {
        const lines = section.split('\n')
        let lineChunk = ''
        for (const line of lines) {
          const c = lineChunk ? lineChunk + '\n' + line : line
          if (c.length <= WA_MAX_CHARS) {
            lineChunk = c
          } else {
            if (lineChunk) chunks.push(lineChunk)
            lineChunk = line
          }
        }
        if (lineChunk) current = lineChunk
        else current = ''
      } else {
        current = section
      }
    }
  }
  if (current) chunks.push(current)
  return chunks.filter(c => c.trim())
}

export async function sendWhatsApp(toNumber: string, text: string, mediaUrl?: string | null) {
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)

  const chunks = splitIntoChunks(sanitizeMarkdownForWhatsApp(text || ''))
  let lastMessage: any = null

  for (let i = 0; i < chunks.length; i++) {
    const payload: any = {
      body: chunks[i],
      from,
      to,
    }
    // Only attach media to first chunk
    if (i === 0 && mediaUrl && mediaUrl.trim()) {
      payload.mediaUrl = [mediaUrl.trim()]
    }

    const message = await client.messages.create(payload)
    lastMessage = message

    console.log('WHATSAPP_SENT:', {
      sid: message.sid,
      from,
      to,
      status: message.status,
      chunk: chunks.length > 1 ? `${i + 1}/${chunks.length}` : undefined,
      hasMedia: i === 0 && Boolean(mediaUrl),
    })

    // Small delay between chunks to preserve order
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return lastMessage
}

// Business-initiated send via an approved WhatsApp utility template.
// Outside the 24h customer-service window, freeform sends are ACCEPTED by
// Twilio but dropped asynchronously with error 63016 (invisible to try/catch)
// - the Jul 19 outage. Templates are the only reliable business-initiated path.
export async function sendWhatsAppReminderTemplate(toNumber: string, label: string) {
  const contentSid = process.env.TWILIO_REMINDER_CONTENT_SID
  if (!contentSid) throw new Error('Missing TWILIO_REMINDER_CONTENT_SID')
  const from = normalizeWhatsAppAddress(rawWhatsappFrom!)
  const to = normalizeWhatsAppAddress(toNumber)
  const message = await client.messages.create({
    from,
    to,
    contentSid,
    contentVariables: JSON.stringify({ '1': String(label || 'your task').slice(0, 400) }),
  })
  console.log('WHATSAPP_TEMPLATE_SENT:', { sid: message.sid, to, status: message.status })
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
