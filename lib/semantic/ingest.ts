// Incremental ingestion: existing, already-permitted rows → assertions. Pure mappers (one per source) and one runner
// that feeds a repository. Verification status is decided by where the row came from, never by its wording:
//   memories ........ user_stated (user_preference when the line reads as one)
//   reminders ....... user_stated
//   calendar events . verified_provider (read from Google by an authorized connection)
//   life_events ..... unverified unless the row carries provider read-back evidence (then verified_provider)
//   open loops ...... inferred
// No email bodies, credentials or document contents are copied; only titles, times, places and ids.
import type { AssertionInput, EntityInput, VerificationStatus } from './types'
import { cityKey, eventKey, flightKey, personKey } from './resolve'
import type { SemanticRepo } from './repo'

export const SELF: EntityInput = { entity_type: 'person', canonical_key: 'self' }
const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const PREFERENCE = /\b(?:prefer|prefers|always|never|favou?rite|usually|aisle|window seat|vegetarian|vegan|no (?:onion|garlic)|likes?|dislikes?|hate)\b/i

export function fromMemory(row: { id: unknown; content?: unknown; created_at?: string | null }): AssertionInput[] {
  const text = clip(row.content, 500); if (!text || /^(?:\s*[\[{]|ASKGOGO_USAGE:)/.test(text)) return []
  const status: VerificationStatus = PREFERENCE.test(text) ? 'user_preference' : 'user_stated'
  const note: EntityInput = { entity_type: 'note', canonical_key: `memory:${String(row.id)}`, attributes: { text } }
  const source = { source_type: 'memories', source_object_ref: String(row.id), observed_at: row.created_at || null, verification_status: status }
  return [
    { subject: SELF, predicate: status === 'user_preference' ? 'prefers' : 'noted', object: note, source, confidence: 0.9, valid_from: row.created_at || null },
    { subject: note, predicate: 'says', literal: text, source, confidence: 0.9 },
  ]
}

export function fromReminder(row: { id: unknown; message?: unknown; remind_at?: string | null; sent?: boolean | null; created_at?: string | null }): AssertionInput[] {
  const text = clip(row.message, 300); if (!text || !row.remind_at) return []
  const rem: EntityInput = { entity_type: 'reminder', canonical_key: `reminder:${String(row.id)}`, attributes: { text } }
  const source = { source_type: 'reminders', source_object_ref: String(row.id), observed_at: row.created_at || null, verification_status: 'user_stated' as const }
  return [
    { subject: SELF, predicate: 'has_reminder', object: rem, source, confidence: 0.95, valid_until: row.remind_at },
    { subject: rem, predicate: 'due_at', literal: row.remind_at, source, confidence: 0.95, valid_until: row.remind_at },
  ]
}

export function fromCalendarEvent(ev: { id: unknown; title?: unknown; startAt?: string | null; endAt?: string | null; location?: string | null; attendees?: { name?: string | null; email?: string | null }[] }, calendarAccount = 'primary'): AssertionInput[] {
  const key = eventKey({ provider: 'google', providerId: String(ev.id || '') }); if (!key || !ev.startAt) return []
  const event: EntityInput = { entity_type: 'event', canonical_key: key, attributes: { title: clip(ev.title, 160) } }
  const source = { source_type: 'google_calendar', source_object_ref: `${calendarAccount}:${String(ev.id)}`, observed_at: null, verification_status: 'verified_provider' as const }
  const out: AssertionInput[] = [
    { subject: SELF, predicate: 'attends', object: event, source, confidence: 1, valid_from: ev.startAt, valid_until: ev.endAt || null },
    { subject: event, predicate: 'starts_at', literal: ev.startAt, source, confidence: 1, valid_from: ev.startAt, valid_until: ev.endAt || null },
  ]
  if (ev.location) out.push({ subject: event, predicate: 'located_at', literal: clip(ev.location, 200), source, confidence: 0.9 })
  for (const a of (ev.attendees || []).slice(0, 12)) {
    const pk = personKey({ name: a.name, email: a.email }); if (!pk || pk === 'self') continue
    out.push({ subject: { entity_type: 'person', canonical_key: pk, attributes: { name: clip(a.name, 80) } }, predicate: 'attends', object: event, source, confidence: 0.9, valid_from: ev.startAt, valid_until: ev.endAt || null })
  }
  return out
}

export function fromLifeEvent(row: { id: unknown; event_type?: string | null; subtype?: string | null; title?: unknown; start_at?: string | null; end_at?: string | null; location?: string | null; provider?: string | null; metadata_json?: any; source?: string | null; created_at?: string | null }): AssertionInput[] {
  if (!row.start_at) return []
  const verified = row.metadata_json?.providerReadback === true || row.metadata_json?.evidence?.kind === 'provider_readback'
  const status: VerificationStatus = verified ? 'verified_provider' : 'unverified'
  const source = { source_type: 'life_events', source_object_ref: String(row.id), observed_at: row.created_at || null, verification_status: status, metadata: { origin: clip(row.source, 40) || null } }
  const title = clip(row.title, 160)
  const m = row.metadata_json || {}
  const flightNo = m.flightNo || m.bookingDetails?.flightNo || (title.match(/\b([A-Z0-9]{2}\s?\d{2,4})\b/) || [])[1]
  const isFlight = row.subtype === 'flight' || /flight/i.test(String(row.subtype || '')) || !!flightNo
  const ent: EntityInput = isFlight && flightKey({ flightNo, date: row.start_at })
    ? { entity_type: 'flight', canonical_key: flightKey({ flightNo, date: row.start_at })!, attributes: { title, from: m.from || null, to: m.to || null } }
    : { entity_type: 'booking', canonical_key: `life_event:${String(row.id)}`, attributes: { title, kind: clip(row.subtype || row.event_type, 40) } }
  const out: AssertionInput[] = [
    { subject: SELF, predicate: 'has_booking', object: ent, source, confidence: verified ? 1 : 0.7, valid_from: row.start_at, valid_until: row.end_at || row.start_at },
    { subject: ent, predicate: 'starts_at', literal: row.start_at, source, confidence: verified ? 1 : 0.7, valid_from: row.start_at, valid_until: row.end_at || row.start_at },
  ]
  const city = cityKey(m.city || m.to || row.location)
  if (city) out.push({ subject: ent, predicate: 'in_city', object: { entity_type: 'city', canonical_key: city }, source, confidence: 0.8 })
  if (row.provider) out.push({ subject: ent, predicate: 'provided_by', object: { entity_type: 'organization', canonical_key: clip(row.provider, 60).toLowerCase() }, source, confidence: 0.9 })
  return out
}

export function fromOpenLoop(row: { id: unknown; title?: unknown; kind?: string | null; due_at?: string | null; source_type?: string | null; created_at?: string | null }): AssertionInput[] {
  const title = clip(row.title, 200); if (!title) return []
  const loop: EntityInput = { entity_type: 'open_loop', canonical_key: `loop:${String(row.id)}`, attributes: { title, kind: clip(row.kind, 40) } }
  const source = { source_type: 'open_loops', source_object_ref: String(row.id), observed_at: row.created_at || null, verification_status: 'inferred' as const, metadata: { from: clip(row.source_type, 40) } }
  const out: AssertionInput[] = [{ subject: SELF, predicate: 'owes', object: loop, source, confidence: 0.6, valid_until: row.due_at || null }]
  if (row.due_at) out.push({ subject: loop, predicate: 'due_at', literal: row.due_at, source, confidence: 0.6, valid_until: row.due_at })
  return out
}

export type IngestBatch = { memories?: any[]; reminders?: any[]; calendarEvents?: any[]; lifeEvents?: any[]; openLoops?: any[] }
export type IngestReport = { asserted: number; changed: number; conflicts: number; skipped: number; errors: string[] }

/** Feed a batch of existing rows to a repository. Bounded; one bad row never stops the rest. */
export async function ingestBatch(repo: SemanticRepo, batch: IngestBatch, now = new Date().toISOString(), cap = 400): Promise<IngestReport> {
  const inputs: AssertionInput[] = []
  for (const r of batch.memories || []) inputs.push(...fromMemory(r))
  for (const r of batch.reminders || []) inputs.push(...fromReminder(r))
  for (const r of batch.calendarEvents || []) inputs.push(...fromCalendarEvent(r))
  for (const r of batch.lifeEvents || []) inputs.push(...fromLifeEvent(r))
  for (const r of batch.openLoops || []) inputs.push(...fromOpenLoop(r))
  const report: IngestReport = { asserted: 0, changed: 0, conflicts: 0, skipped: Math.max(0, inputs.length - cap), errors: [] }
  for (const a of inputs.slice(0, cap)) {
    try { const r = await repo.assert(a, now); report.asserted++; if (r.changed) report.changed++; if (r.conflict) report.conflicts++ }
    catch (e: any) { report.errors.push(String(e?.message || e).slice(0, 120)) }
  }
  return report
}
