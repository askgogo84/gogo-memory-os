// Entity resolution. Deterministic canonical keys so the same thing ingested twice is one entity, while two people
// who share a first name stay two entities until an email, phone or full name ties them together. Pure.

const norm = (s: unknown) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[‘’'"`]/g, '').replace(/[^\p{L}\p{N}@+.\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

export type PersonRef = { name?: string | null; email?: string | null; phone?: string | null }

/** People: email > phone > full name > first name only. A first-name-only key is deliberately distinct from a full-name key. */
export function personKey(p: PersonRef): string | null {
  const email = norm(p.email); if (email && email.includes('@')) return `email:${email}`
  const phone = digits(p.phone); if (phone.length >= 10) return `phone:${phone.length === 10 ? '91' + phone : phone}`
  const name = norm(p.name).replace(/\b(?:mr|mrs|ms|dr|shri|smt)\.?\s+/g, '')
  if (!name) return null
  const parts = name.split(' ').filter(Boolean)
  return parts.length >= 2 ? `name:${parts.join(' ')}` : `first:${parts[0]}`
}

/** Two person keys refer to the same person only when both are the same strong key. Never by first name alone. */
export function samePerson(a: string | null, b: string | null): boolean { return !!a && !!b && a === b && !a.startsWith('first:') }

export function placeKey(p: { name?: string | null; city?: string | null }): string | null {
  const n = norm(p.name); if (!n) return null
  const c = norm(p.city)
  return c ? `${n}@${c}` : n
}

export function cityKey(raw: unknown): string | null {
  const c = norm(raw).replace(/\b(?:bengaluru|bangalore)\b/, 'bengaluru').replace(/\b(?:bombay|mumbai)\b/, 'mumbai').replace(/\bnew delhi\b|\bdelhi\b/, 'delhi')
  return c || null
}

export function flightKey(p: { flightNo?: string | null; date?: string | null }): string | null {
  const f = String(p.flightNo || '').toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9]{2}\d{1,4}$/.test(f)) return null
  const d = String(p.date || '').slice(0, 10)
  return d ? `${f}@${d}` : f
}

export function eventKey(p: { provider?: string | null; providerId?: string | null; title?: string | null; startAt?: string | null }): string | null {
  const pid = norm(p.providerId)
  if (pid) return `${norm(p.provider) || 'event'}:${pid}`
  const t = norm(p.title); const s = String(p.startAt || '').slice(0, 16)
  return t ? `${t}@${s || 'undated'}` : null
}

/** A stable key for a saved memory line, so re-ingesting the same row is a no-op. */
export function memoryKey(id: unknown): string | null { const s = String(id ?? '').trim(); return s ? `memory:${s}` : null }

export function organizationKey(raw: unknown): string | null {
  const o = norm(raw).replace(/\b(?:pvt|private|ltd|limited|llp|inc|co)\b\.?/g, '').replace(/\s+/g, ' ').trim()
  return o || null
}
