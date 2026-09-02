type SendEmailInput = {
  to: string
  subject: string
  html: string
  text: string
  unsubscribeUrl?: string | null
  idempotencyKey?: string | null
  stream?: 'lifecycle' | 'daily-brief'
}

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; error: string }

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export async function sendAskGogoEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = (process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY_MISSING' }

  const from = (process.env.EMAIL_FROM || 'Gogo from AskGogo <gogo@askgogo.in>').trim()

  const headers: Record<string, string> = {
    'X-Entity-Ref-ID': `askgogo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  }
  if (input.unsubscribeUrl) headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers,
        tags: [
          { name: 'product', value: 'askgogo' },
          { name: 'stream', value: input.stream || 'lifecycle' },
        ],
      }),
    })

    const payload: any = await response.json().catch(() => null)
    if (!response.ok) {
      const message = payload?.message || payload?.error || `HTTP_${response.status}`
      return { ok: false, error: String(message) }
    }

    return { ok: true, id: payload?.id ? String(payload.id) : null }
  } catch (error: any) {
    return { ok: false, error: error?.message || String(error) }
  }
}
