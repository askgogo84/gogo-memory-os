/**
 * An owner link is an authorization decision, not a phone-number search.
 * Only an explicitly stored, complete international phone identity can link existing user rows.
 * In particular, never synthesize an owner from a 9/10-digit phone suffix.
 */
export type OwnerLinkRow = { telegram_id?: string | number | null; whatsapp_id?: string | null }

/** Preserve exact persisted BIGINT identities; JS numbers outside safe range can alias another owner. */
export function exactOwnerDecimalId(value: string | number | null | undefined): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const id = String(value ?? '').trim()
  return /^-?[1-9]\d*$/.test(id) ? id : null
}

/** E.164 digits, including country calling code. Domestic-only 10-digit values fail closed. */
export function canonicalInternationalPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const phone = value.trim().replace(/^whatsapp:\s*/i, '').trim()
  if (!/^\+?[0-9][0-9\s()\-]*$/.test(phone)) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 11 || digits.length > 15 || digits[0] === '0') return null
  return digits
}

/** Existing, explicitly owned rows only; no fallback-generated or inferred identifiers. */
export function authorizedLinkedOwnerIds(
  sessionTelegramId: string | number,
  sessionWhatsAppId: unknown,
  rows: OwnerLinkRow[],
): string[] {
  const own = exactOwnerDecimalId(sessionTelegramId)
  if (!own) return []
  const full = canonicalInternationalPhone(sessionWhatsAppId)
  if (!full) return [own]
  const ids = new Set<string>([own])
  for (const row of rows) {
    if (canonicalInternationalPhone(row.whatsapp_id) !== full) continue
    const id = exactOwnerDecimalId(row.telegram_id)
    if (!id) continue
    ids.add(id)
  }
  return [...ids]
}

/** Exact saved phone formats, never a suffix wildcard match. */
export function phoneRowCandidates(internationalDigits: string): string[] {
  return [
    `whatsapp:+${internationalDigits}`,
    `+${internationalDigits}`,
    internationalDigits,
    `whatsapp:${internationalDigits}`,
  ]
}
