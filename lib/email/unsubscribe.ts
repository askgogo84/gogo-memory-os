import { createHmac, timingSafeEqual } from 'crypto'

function secret() {
  return (process.env.EMAIL_UNSUBSCRIBE_SECRET || '').trim()
}

function signature(telegramId: string, email: string) {
  const key = secret()
  if (!key) return null
  return createHmac('sha256', key)
    .update(`${telegramId}:${email.trim().toLowerCase()}`)
    .digest('base64url')
}

export function buildUnsubscribeUrl(telegramId: string | number, email: string) {
  const tg = String(telegramId)
  const sig = signature(tg, email)
  if (!sig) return 'https://app.askgogo.in/dashboard/you'
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in').replace(/\/$/, '')
  const params = new URLSearchParams({ u: tg, e: email.trim().toLowerCase(), s: sig })
  return `${base}/api/email/unsubscribe?${params.toString()}`
}

export function verifyUnsubscribeToken(telegramId: string, email: string, supplied: string) {
  const expected = signature(telegramId, email)
  if (!expected || !supplied) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}
