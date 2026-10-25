/** No contact sharing decision is allowed from a truncated phone number. */
export type RecipientOwnerRow = { telegram_id?: string | number | null; whatsapp_id?: string | null }

export function canonicalE164Digits(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim().replace(/^whatsapp:\s*/i, '')
  if (!/^\+?[1-9][0-9\s()\-]*$/.test(s)) return null
  const digits = s.replace(/\D/g, '')
  return digits.length >= 11 && digits.length <= 15 ? digits : null
}

/** Exact indexable storage variants; never wildcard or suffix-based queries. */
export function fullPhoneRowCandidates(full: string): string[] {
  return [`whatsapp:+${full}`, `+${full}`, full, `whatsapp:${full}`]
}

/** Fail closed on multiple DISTINCT owners with the same claimed number. */
export function uniqueExactRecipientId(sourcePhone: unknown, rows: RecipientOwnerRow[]): number | null {
  const wanted = canonicalE164Digits(sourcePhone)
  if (!wanted || !Array.isArray(rows) || rows.length > 25) return null
  const ids = new Set<number>()
  for (const row of rows) {
    if (canonicalE164Digits(row.whatsapp_id) !== wanted) continue
    // Keep numeric owner IDs within JS safe-integer range until all consumers support exact bigint.
    const n = typeof row.telegram_id === 'number' ? row.telegram_id : Number(String(row.telegram_id || ''))
    if (!Number.isSafeInteger(n) || n === 0) return null
    ids.add(n)
  }
  return ids.size === 1 ? [...ids][0] : null
}
