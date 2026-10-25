// Pure waitlist validator — no I/O, no env. Imported by app/api/waitlist/route.ts and
// tested offline by scripts/verify-waitlist-validate.mts. Spec: docs/waitlist/05-BACKEND-SCHEMA.md §3.

export const CONSENT_VERSION = '2026-09-19'

export type WaitlistCountry = 'IN' | 'AE'

export type WaitlistRow = {
  phone_e164: string
  email: string
  country: WaitlistCountry
  whatsapp_opt_in: boolean
  consent_version: string
  source: string
}

export type WaitlistErrors = { phone?: string; email?: string; country?: string }

export type WaitlistResult =
  | { ok: true; honeypot: true }
  | { ok: true; honeypot: false; row: WaitlistRow }
  | { ok: false; errors: WaitlistErrors }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SOURCE_RE = /^[a-z0-9-]{1,32}$/

export function normalisePhone(country: WaitlistCountry, raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (country === 'IN') {
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
    return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null
  }
  if (d.length === 12 && d.startsWith('971')) d = d.slice(3)
  if (d.length === 10 && d.startsWith('0')) d = d.slice(1)
  return /^5\d{8}$/.test(d) ? `+971${d}` : null
}

export function normaliseEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return null
  return e
}

export function normaliseSource(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase()
  return SOURCE_RE.test(s) ? `askgogo.in:${s}` : 'askgogo.in:unknown'
}

export function validateWaitlist(body: unknown): WaitlistResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>

  // Honeypot first: bots always get the normal success shape and nothing is written.
  if (typeof b.company === 'string' && b.company.trim() !== '') return { ok: true, honeypot: true }

  const errors: WaitlistErrors = {}
  const country = b.country === 'IN' || b.country === 'AE' ? (b.country as WaitlistCountry) : null
  if (!country) errors.country = 'Choose India (+91) or UAE (+971).'

  const phone = country ? normalisePhone(country, b.phone) : null
  if (country && !phone) {
    errors.phone = country === 'IN'
      ? 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.'
      : 'Enter a 9-digit UAE mobile number starting with 5.'
  }

  const email = normaliseEmail(b.email)
  if (!email) errors.email = 'Enter a valid email address.'

  if (Object.keys(errors).length > 0 || !country || !phone || !email) return { ok: false, errors }

  return {
    ok: true,
    honeypot: false,
    row: {
      phone_e164: phone,
      email,
      country,
      whatsapp_opt_in: b.whatsapp_opt_in === true,
      consent_version: CONSENT_VERSION,
      source: normaliseSource(b.source),
    },
  }
}
