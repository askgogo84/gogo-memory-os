/**
 * Razorpay webhook owner selection. This is a pure, conservative identity check:
 * full country-coded phone equality, exact persisted IDs and no suffix guessing.
 * One ambiguous owner is worse than one delayed entitlement.
 */
export type PaymentOwnerEvidence = {
  phone?: string | null
  whatsappId?: string | null
  telegramId?: string | number | null
  userId?: string | number | null
  subscriptionId?: string | null
}
export type PaymentOwnerRow = {
  id: string | number | null
  phone?: string | null
  whatsapp_id?: string | null
  telegram_id?: string | number | null
  razorpay_subscription_id?: string | null
}
export type BoundPaymentOwner = { id: string; notificationPhone: string | null }

function safeScalar(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? String(value) : null
  }
  return typeof value === 'string' ? value.trim() : null
}

function safeUserId(value: unknown): string | null {
  const v = safeScalar(value)
  return v && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null
}

function safeTelegramId(value: unknown): string | null {
  const v = safeScalar(value)
  // Negative nine-digit WhatsApp fallback IDs are not verified owner links.
  return v && /^[1-9][0-9]{0,18}$/.test(v) ? v : null
}

function safeSubscriptionId(value: unknown): string | null {
  return typeof value === 'string' && /^sub_[A-Za-z0-9_-]{5,80}$/.test(value)
    ? value
    : null
}

/** Complete international number only. 10-digit domestic numbers prove no owner. */
export function fullInternationalDigits(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^whatsapp:/i, '')
  if (!/^\+?[1-9][0-9]{10,14}$/.test(raw)) return null
  return raw.replace(/^\+/, '')
}

function exactPhoneForms(digits: string): string[] {
  return ['+' + digits, 'whatsapp:+' + digits, digits, 'whatsapp:' + digits]
}

/** All OR branches are exact equality, never ilike/wildcards or generated suffix IDs. */
export function paymentOwnerLookupClauses(input: PaymentOwnerEvidence): string[] {
  const result = new Set<string>()
  for (const phone of [input.phone, input.whatsappId]) {
    const digits = fullInternationalDigits(phone)
    if (!digits) continue
    for (const form of exactPhoneForms(digits)) {
      result.add('phone.eq.' + form)
      result.add('whatsapp_id.eq.' + form)
    }
  }
  const telegram = safeTelegramId(input.telegramId)
  if (telegram) result.add('telegram_id.eq.' + telegram)
  const user = safeUserId(input.userId)
  if (user) result.add('id.eq.' + user)
  const subscription = safeSubscriptionId(input.subscriptionId)
  if (subscription) result.add('razorpay_subscription_id.eq.' + subscription)
  return [...result]
}

/** Reject duplicate rows, inconsistent signed-event identifiers and unsafe DB IDs. */
export function uniquePaymentOwner(
  rows: PaymentOwnerRow[] | null | undefined,
  input: PaymentOwnerEvidence,
): BoundPaymentOwner | null {
  if (!Array.isArray(rows) || rows.length !== 1) return null
  if (!paymentOwnerLookupClauses(input).length) return null
  const row = rows[0]
  const id = safeUserId(row?.id)
  if (!id) return null

  const storedPhones = [fullInternationalDigits(row.phone), fullInternationalDigits(row.whatsapp_id)]
    .filter((value): value is string => Boolean(value))
  const incomingPhones = [fullInternationalDigits(input.phone), fullInternationalDigits(input.whatsappId)]
    .filter((value): value is string => Boolean(value))
  if (incomingPhones.some((number) => !storedPhones.includes(number))) return null

  const user = safeUserId(input.userId)
  if (user && user !== id) return null
  const telegram = safeTelegramId(input.telegramId)
  if (telegram && telegram !== safeTelegramId(row.telegram_id)) return null
  const subscription = safeSubscriptionId(input.subscriptionId)
  if (subscription && row.razorpay_subscription_id && row.razorpay_subscription_id !== subscription) return null

  // At least one independently exact match is required, not just one returned row.
  const matched = incomingPhones.length > 0 ||
    (user != null && user === id) ||
    (telegram != null && telegram === safeTelegramId(row.telegram_id)) ||
    (subscription != null && subscription === row.razorpay_subscription_id)
  if (!matched) return null

  // Never notify a different saved phone merely because it sits first in the row.
  // Prefer the exact paid-contact match; subscription-only status falls back to
  // the persisted WhatsApp destination on the bound subscription owner.
  const destination = incomingPhones[0] || fullInternationalDigits(row.whatsapp_id) || fullInternationalDigits(row.phone)
  return { id, notificationPhone: destination ? '+' + destination : null }
}
