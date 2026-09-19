import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const PREFIX = 'enc:v1'
const IV_BYTES = 12
const TAG_BYTES = 16

function keyBytes(): Buffer {
  const raw = String(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || '').trim()
  if (!raw) throw new Error('google_token_encryption_key_missing')

  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    throw new Error('google_token_encryption_key_invalid')
  }
  if (key.length !== 32) throw new Error('google_token_encryption_key_invalid')
  return key
}

export function hasGoogleTokenEncryptionKey() {
  try {
    return keyBytes().length === 32
  } catch {
    return false
  }
}

export function isEncryptedGoogleToken(value: unknown) {
  return String(value || '').startsWith(`${PREFIX}:`)
}

export function encryptGoogleToken(value: string) {
  const plain = String(value || '')
  if (!plain) return ''
  if (isEncryptedGoogleToken(plain)) return plain

  const key = keyBytes()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':')
}

export function decryptGoogleToken(value: string | null | undefined) {
  const stored = String(value || '')
  if (!stored) return ''
  if (!isEncryptedGoogleToken(stored)) return stored

  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('google_token_ciphertext_invalid')
  }

  const [, , , ivPart, tagPart, cipherPart] = parts
  const key = keyBytes()
  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  const ciphertext = Buffer.from(cipherPart, 'base64url')

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || !ciphertext.length) {
    throw new Error('google_token_ciphertext_invalid')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
