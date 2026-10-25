import { randomBytes } from 'node:crypto'

/** Keep persisted numeric IDs exact; never coerce an unsafe bigint through JS Number. */
export function exactSessionOwnerId(value: string | number | null | undefined): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const raw = String(value ?? '').trim()
  return /^-?[1-9]\d*$/.test(raw) ? raw : null
}

/** Authorization is bounded to the authenticated owner, not to a phone-number search. */
export function exactOwnerOnly(value: string | number | null | undefined): string[] {
  const own = exactSessionOwnerId(value)
  return own ? [own] : []
}

/** Random, negative, safe bigint-compatible ID for NEW WhatsApp users.
 * 51 random bits and a fixed high bit keep these separate from legacy phone suffixes.
 * Database uniqueness is authoritative; the insert path retries collisions.
 */
export function allocateWhatsAppOwnerId(bytes: Uint8Array = randomBytes(7)): number {
  if (bytes.length !== 7) throw new Error('whatsapp_owner_random_bytes_invalid')
  const sample = BigInt('0x' + Buffer.from(bytes).toString('hex'))
  const id = (BigInt(1) << BigInt(51)) | (sample & ((BigInt(1) << BigInt(51)) - BigInt(1)))
  return -Number(id)
}
