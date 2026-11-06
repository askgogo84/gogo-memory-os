/**
 * Billing-owner identity is an authorization decision, not a fuzzy phone search.
 * Razorpay metadata can contain several identifiers, but a signed webhook does
 * not make two different AskGogo accounts the same owner.
 */
export type BillingOwnerRow = {
  telegram_id?: string | number | null
  whatsapp_id?: string | null
  id?: string | number | null
  razorpay_subscription_id?: string | null
}

export type BillingOwnerInput = {
  phone?: string | null
  whatsappId?: string | null
  telegramId?: string | number | null
  userId?: string | null
  subscriptionId?: string | null
}

export type BillingOwnerLookup =
  | { field: 'telegram_id' | 'id' | 'razorpay_subscription_id'; value: string }
  | { field: 'whatsapp_id'; values: string[] }

export type BillingOwnerClaim = {
  lookup: BillingOwnerLookup
  telegramId: string | null
  userId: string | null
  phone: string | null
}

/** Entire E.164 international phone, never the trailing ten digits. */
export function canonicalBillingPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^whatsapp:\s*/i, '').trim()
  if (!/^\+?[1-9][0-9]{10,14}$/.test(raw)) return null
  return raw.replace(/^\+/, '')
}

export function exactBillingOwnerId(value: unknown): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const raw = String(value).trim()
  return /^-?[1-9][0-9]*$/.test(raw) ? raw : null
}

export function billingPhoneVariants(value: unknown): string[] {
  const digits = canonicalBillingPhone(value)
  if (!digits) return []
  return [`whatsapp:+${digits}`, `+${digits}`, `whatsapp:${digits}`, digits]
}

function safeOpaqueId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return /^[A-Za-z0-9_-]{1,80}$/.test(id) ? id : null
}

/** One lookup authority only. Multiple independent identities must agree on that one row. */
export function billingOwnerClaim(input: BillingOwnerInput): BillingOwnerClaim | null {
  const telegramId = input.telegramId == null || input.telegramId === ''
    ? null : exactBillingOwnerId(input.telegramId)
  if (input.telegramId != null && input.telegramId !== '' && !telegramId) return null
  const userId = input.userId == null || input.userId === ''
    ? null : safeOpaqueId(input.userId)
  if (input.userId != null && input.userId !== '' && !userId) return null

  const rawPhone = input.phone ? canonicalBillingPhone(input.phone) : null
  const rawWhatsApp = input.whatsappId ? canonicalBillingPhone(input.whatsappId) : null
  if ((input.phone && !rawPhone) || (input.whatsappId && !rawWhatsApp)) return null
  if (rawPhone && rawWhatsApp && rawPhone !== rawWhatsApp) return null
  const phone = rawWhatsApp || rawPhone || null

  const subId = input.subscriptionId == null || input.subscriptionId === ''
    ? null : safeOpaqueId(input.subscriptionId)
  if (input.subscriptionId != null && input.subscriptionId !== '' && !subId) return null

  const lookup: BillingOwnerLookup | null = telegramId
    ? { field: 'telegram_id', value: telegramId }
    : userId
      ? { field: 'id', value: userId }
      : phone
        ? { field: 'whatsapp_id', values: billingPhoneVariants(phone) }
        : subId
          ? { field: 'razorpay_subscription_id', value: subId }
          : null
  return lookup ? { lookup, telegramId, userId, phone } : null
}

/** The lookup must return exactly one proven account. Errors/duplicates fail closed. */
export async function resolveBillingOwner(
  input: BillingOwnerInput,
  lookup: (claim: BillingOwnerClaim) => Promise<BillingOwnerRow[]>,
  options: { requireRecordedSubscription?: boolean } = {},
): Promise<string | null> {
  const claim = billingOwnerClaim(input)
  if (!claim) return null
  let rows: BillingOwnerRow[]
  try {
    rows = await lookup(claim)
  } catch {
    return null
  }
  if (!Array.isArray(rows) || rows.length !== 1) return null
  const row = rows[0]
  const owner = exactBillingOwnerId(row?.telegram_id)
  if (!owner) return null
  if (claim.telegramId && claim.telegramId !== owner) return null
  if (claim.userId && String(row.id ?? '') !== claim.userId) return null
  if (claim.phone && canonicalBillingPhone(row.whatsapp_id) !== claim.phone) return null
  // A stale halted/cancelled event for an earlier subscription must never
  // revoke an owner's current (different) paid subscription.
  if (options.requireRecordedSubscription &&
      (!input.subscriptionId || row.razorpay_subscription_id !== input.subscriptionId)) return null
  return owner
}
