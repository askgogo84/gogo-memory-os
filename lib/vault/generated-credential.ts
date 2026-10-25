// Generated passwords for new provider sign-ups. The durable pending record that holds the
// secret until the sign-up is verified lives in lib/vault/pending-credentials.ts
// (table vault_pending_credentials). This module only generates values.
import { randomInt } from 'node:crypto'

const LOWER = 'abcdefghijkmnpqrstuvwxyz' // no 'l' or 'o'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no 'I' or 'O'
const DIGITS = '23456789' // no '0' or '1'
const SYMBOLS = '!@#$%^&*-_=+'
const MIN_LENGTH = 16
const MAX_LENGTH = 64

export function generateCredentialSecret(length = 24): string {
  const size = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, Math.floor(length)))
  const all = LOWER + UPPER + DIGITS + SYMBOLS
  const pick = (set: string) => set[randomInt(set.length)]
  // One character from each class covers the usual site rules; the rest is uniform.
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < size) chars.push(pick(all))
  // Fisher–Yates with the CSPRNG so the class-guaranteed characters are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
