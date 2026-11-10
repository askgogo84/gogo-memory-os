// AskGogo Events: the only code that reads or writes the gogo_event* tables. Every organizer call is scoped to the
// exact owner id (a string). Guest calls go through the database functions with a token hash and never see ids.
// The database client is injectable so the same code runs in tests.
import { createHmac } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  asHeadcount, dedupeGuests, draftProblems, eventTokenHash, missingForPublish, newEventToken, publicInvitation, rsvpUrl, TOKEN_RE,
  type EventDraft, type EventRow, type GuestRow, type Headcount,
} from './core'

type Db = { from: (table: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any }
type Env = Record<string, string | undefined>
const envOf = (): Env => ((globalThis as any).process?.env || {}) as Env
const OWNER_RE = /^-?[0-9]{1,20}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export class EventsError extends Error { code: string; constructor(code: string) { super(code); this.code = code } }
const fail = (code: string): never => { throw new EventsError(code) }
const owned = (owner: string) => (OWNER_RE.test(String(owner)) ? String(owner) : fail('invalid_owner'))
const uuid = (id: string) => (UUID_RE.test(String(id)) ? String(id) : fail('not_found'))
// Only "the table or function is not there" means the migration has not been applied. Any other database error
// (a constraint, a timeout) is a real failure and must not be reported as "not enabled".
const missingTable = (error: any) => ['42P01', '42883', 'PGRST205', 'PGRST202'].includes(String(error?.code || ''))
  || /relation "?(?:public\.)?gogo_event\w*"? does not exist|function (?:public\.)?gogo_event\w*\(.*\) does not exist|Could not find the (?:table|function) '?public\.gogo_event/i.test(String(error?.message || ''))
function check<T>(res: { data: T; error: any }): T {
  if (res.error) fail(missingTable(res.error) ? 'events_not_enabled' : 'events_store_failed')
  return res.data
}

/** Links must be shown again later (copy link, resend), but only hashes are stored. So a token is derived from a
 *  server-side key and the row's id: reproducible by the server, unguessable by anyone else. */
function tokenKey(env: Env = envOf()): Buffer {
  const secret = (env.GOGO_EVENTS_TOKEN_SECRET || '').trim() || (env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (secret.length < 16) fail('events_token_key_missing')
  return createHmac('sha256', 'gogo-events-token-key-v1').update(secret).digest()
}
export function derivedToken(kind: 'share' | 'guest', id: string, env: Env = envOf()): string {
  return createHmac('sha256', tokenKey(env)).update(`${kind}:${uuid(id)}`).digest('base64url')
}

const COLUMNS: Record<keyof EventDraft, string> = {
  title: 'title', kind: 'kind', startsAt: 'starts_at', endsAt: 'ends_at', timezone: 'timezone', venueName: 'venue_name', venueAddress: 'venue_address',
  onlineUrl: 'online_url', hostName: 'host_name', description: 'description', dressCode: 'dress_code', capacity: 'capacity', maxPlusOnes: 'max_plus_ones', rsvpClosesAt: 'rsvp_closes_at',
}
const LIMITS: Partial<Record<keyof EventDraft, number>> = { title: 120, venueName: 160, venueAddress: 300, onlineUrl: 500, hostName: 80, description: 1000, dressCode: 120, timezone: 64 }
function rowFromDraft(d: EventDraft): Record<string, unknown> {
  if (draftProblems(d).length) fail('invalid_event_fields')
  const row: Record<string, unknown> = {}
  for (const key of Object.keys(COLUMNS) as (keyof EventDraft)[]) {
    if (!(key in d) || d[key] === undefined) continue
    const v = d[key]
    row[COLUMNS[key]] = typeof v === 'string' ? (v.replace(/\s+/g, ' ').trim().slice(0, LIMITS[key] ?? 200) || null) : v
  }
  return row
}
const draftFromRow = (e: EventRow): EventDraft => ({ title: e.title, startsAt: e.starts_at, venueName: e.venue_name, onlineUrl: e.online_url })

async function audit(db: Db, eventId: string, actor: string, action: string, detail: Record<string, unknown> = {}) {
  try { await db.from('gogo_event_audit').insert({ event_id: eventId, actor: actor.slice(0, 40), action, detail }) } catch { /* the audit row is best effort; the action itself already happened */ }
}

// ---- organizer ------------------------------------------------------------------------------------------------------
export async function createEvent(owner: string, draft: EventDraft, db: Db = supabaseAdmin as any): Promise<EventRow> {
  const row = rowFromDraft(draft)
  if (!row.title) fail('title_required')
  const e = check<EventRow>(await db.from('gogo_events').insert({ ...row, owner_telegram_id: owned(owner), status: 'draft' }).select('*').single())
  await audit(db, e.id, 'owner', 'event.created')
  return e
}

export async function getEvent(owner: string, id: string, db: Db = supabaseAdmin as any): Promise<EventRow> {
  const e = check<EventRow | null>(await db.from('gogo_events').select('*').eq('owner_telegram_id', owned(owner)).eq('id', uuid(id)).maybeSingle())
  return e || fail('not_found')
}

export async function listEvents(owner: string, db: Db = supabaseAdmin as any): Promise<EventRow[]> {
  return check<EventRow[]>(await db.from('gogo_events').select('*').eq('owner_telegram_id', owned(owner)).order('created_at', { ascending: false }).limit(50)) || []
}

/** Edits bump the revision so guests can be told something changed. A cancelled or completed event is not edited. */
export async function updateEvent(owner: string, id: string, patch: EventDraft, db: Db = supabaseAdmin as any): Promise<EventRow> {
  const current = await getEvent(owner, id, db)
  if (current.status === 'cancelled' || current.status === 'completed') fail('event_closed')
  const row = rowFromDraft(patch)
  if ('title' in row && !row.title) fail('title_required')
  if (current.status === 'published') {
    const next = { ...draftFromRow(current), ...patch }
    if (missingForPublish(next).length) fail('would_unpublish')
  }
  const e = check<EventRow | null>(await db.from('gogo_events').update({ ...row, revision: current.revision + 1, updated_at: new Date().toISOString() })
    .eq('owner_telegram_id', owned(owner)).eq('id', current.id).eq('revision', current.revision).select('*').maybeSingle())
  if (!e) fail('changed_meanwhile')
  await audit(db, current.id, 'owner', 'event.updated', { fields: Object.keys(row) })
  return e as EventRow
}

/** Publishing opens the invitation. Returns what is still missing instead of guessing it. */
export async function publishEvent(owner: string, id: string, db: Db = supabaseAdmin as any): Promise<{ event: EventRow | null; missing: string[]; shareUrl: string | null }> {
  const current = await getEvent(owner, id, db)
  if (current.status === 'cancelled' || current.status === 'completed') fail('event_closed')
  const missing = missingForPublish(draftFromRow(current))
  if (missing.length) return { event: null, missing, shareUrl: null }
  const token = derivedToken('share', current.id)
  const e = check<EventRow>(await db.from('gogo_events').update({ status: 'published', share_token_hash: eventTokenHash(token), updated_at: new Date().toISOString() })
    .eq('owner_telegram_id', owned(owner)).eq('id', current.id).select('*').single())
  await audit(db, current.id, 'owner', 'event.published')
  return { event: e, missing: [], shareUrl: rsvpUrl(token) }
}

/** The link the organizer forwards. Null until the event is published or after the link is switched off. */
export async function shareLink(owner: string, id: string, db: Db = supabaseAdmin as any): Promise<string | null> {
  const e: any = await getEvent(owner, id, db)
  const token = derivedToken('share', e.id)
  return e.status === 'published' && e.share_token_hash === eventTokenHash(token) ? rsvpUrl(token) : null
}
export async function disableShareLink(owner: string, id: string, db: Db = supabaseAdmin as any): Promise<void> {
  const e = await getEvent(owner, id, db)
  check(await db.from('gogo_events').update({ share_token_hash: null }).eq('owner_telegram_id', owned(owner)).eq('id', e.id).select('id'))
  await audit(db, e.id, 'owner', 'share_link.disabled')
}

export async function cancelEvent(owner: string, id: string, db: Db = supabaseAdmin as any): Promise<EventRow> {
  const current = await getEvent(owner, id, db)
  if (current.status === 'cancelled') return current
  const now = new Date().toISOString()
  // A draft that never had a date was never an invitation anyone could open: it is discarded, not kept as cancelled.
  if (current.status === 'draft' && !current.starts_at) {
    check(await db.from('gogo_events').delete().eq('owner_telegram_id', owned(owner)).eq('id', current.id).select('id'))
    return { ...current, status: 'cancelled' }
  }
  const e = check<EventRow>(await db.from('gogo_events').update({ status: 'cancelled', cancelled_at: now, updated_at: now, revision: current.revision + 1 })
    .eq('owner_telegram_id', owned(owner)).eq('id', current.id).select('*').single())
  await audit(db, current.id, 'owner', 'event.cancelled')
  return e
}

/** Guests the organizer typed. Nobody is messaged: each gets a personal link the organizer can pass on. */
export async function addGuests(owner: string, id: string, input: { name: string; phone?: string | null }[], db: Db = supabaseAdmin as any) {
  const e = await getEvent(owner, id, db)
  if (e.status === 'cancelled' || e.status === 'completed') fail('event_closed')
  const existing = check<{ name: string; phone: string | null }[]>(await db.from('gogo_event_guests').select('name, phone').eq('event_id', e.id).limit(2000)) || []
  const { add, duplicates, invalid } = dedupeGuests(input.slice(0, 200), existing)
  if (existing.length + add.length > 1000) fail('guest_limit')
  const rows = add.map(g => { const gid = crypto.randomUUID(); return { id: gid, event_id: e.id, name: g.name, phone: g.phone, source: 'organizer', token_hash: eventTokenHash(derivedToken('guest', gid)) } })
  if (rows.length) check(await db.from('gogo_event_guests').insert(rows).select('id'))
  if (rows.length) await audit(db, e.id, 'owner', 'guests.added', { count: rows.length })
  return { added: rows.map(r => ({ name: r.name, link: rsvpUrl(derivedToken('guest', r.id)) })), duplicates, invalid }
}

export type OrganizerGuest = { id: string; name: string; hasPhone: boolean; source: string; rsvp: string; plusOnes: number; dietary: string | null; comment: string | null; rsvpAt: string | null; inviteStatus: string; revoked: boolean; optedOut: boolean }
export async function listGuests(owner: string, id: string, db: Db = supabaseAdmin as any): Promise<OrganizerGuest[]> {
  const e = await getEvent(owner, id, db)
  const rows = check<any[]>(await db.from('gogo_event_guests').select('id, name, phone, source, rsvp_status, plus_ones, dietary, comment, rsvp_at, invite_status, token_revoked_at, opted_out').eq('event_id', e.id).order('created_at', { ascending: true }).limit(2000)) || []
  return rows.map(g => ({ id: g.id, name: g.name, hasPhone: Boolean(g.phone), source: g.source, rsvp: g.rsvp_status, plusOnes: g.plus_ones, dietary: g.dietary, comment: g.comment, rsvpAt: g.rsvp_at, inviteStatus: g.invite_status, revoked: Boolean(g.token_revoked_at), optedOut: Boolean(g.opted_out) }))
}

export async function revokeGuest(owner: string, id: string, guestId: string, db: Db = supabaseAdmin as any): Promise<void> {
  const e = await getEvent(owner, id, db)
  const rows = check<any[]>(await db.from('gogo_event_guests').update({ token_revoked_at: new Date().toISOString() }).eq('event_id', e.id).eq('id', uuid(guestId)).select('id')) || []
  if (!rows.length) fail('not_found')
  await audit(db, e.id, 'owner', 'guest.revoked')
}

/** Counted by the database, in people. */
export async function headcount(owner: string, id: string, db: Db = supabaseAdmin as any): Promise<Headcount> {
  const e = await getEvent(owner, id, db)
  return asHeadcount(check<any>(await db.rpc('gogo_event_headcount', { p_event_id: e.id })))
}

// ---- guest ------------------------------------------------------------------------------------------------------------
type Lookup = { kind: 'guest'; event: EventRow; guest: GuestRow } | { kind: 'share'; event: EventRow; guest: null }
async function lookup(token: string, db: Db): Promise<Lookup | null> {
  const hash = eventTokenHash(token)
  if (!hash) return null
  const guest = check<any>(await db.from('gogo_event_guests').select('id, event_id, name, rsvp_status, plus_ones, dietary, comment, token_revoked_at').eq('token_hash', hash).maybeSingle())
  if (guest) {
    const event = check<EventRow | null>(await db.from('gogo_events').select('*').eq('id', guest.event_id).maybeSingle())
    return event ? { kind: 'guest', event, guest } : null
  }
  const event = check<EventRow | null>(await db.from('gogo_events').select('*').eq('share_token_hash', hash).maybeSingle())
  return event ? { kind: 'share', event, guest: null } : null
}

/** What the holder of this link may see. `mode` says whether the link is personal or the shared one. */
export async function invitationFor(token: string, db: Db = supabaseAdmin as any) {
  const found = await lookup(token, db)
  if (!found || found.event.status === 'draft') return null
  if (found.kind === 'guest' && found.guest.token_revoked_at) return { mode: 'revoked' as const, view: null }
  return { mode: found.kind, view: publicInvitation(found.event, found.guest) }
}

export type RsvpInput = { status: string; plusOnes?: number; dietary?: string | null; comment?: string | null; name?: string | null }
/** One answer. With a personal link it updates that guest. With the share link it first adds the guest (name needed)
 *  and returns their new personal token so later edits go to the same row. */
export async function submitRsvp(token: string, input: RsvpInput, db: Db = supabaseAdmin as any): Promise<{ ok: boolean; error?: string; placesLeft?: number; personalToken?: string }> {
  const found = await lookup(token, db)
  if (!found) return { ok: false, error: 'not_found' }
  if (!['going', 'maybe', 'declined'].includes(input.status)) return { ok: false, error: 'invalid_status' }
  const plus = Number.isInteger(input.plusOnes) ? Math.min(Math.max(input.plusOnes as number, 0), 10) : 0
  let answerToken = token, personalToken: string | undefined
  if (found.kind === 'share') {
    personalToken = newEventToken()
    const joined = check<any>(await db.rpc('gogo_event_join', { p_share_hash: eventTokenHash(token), p_name: String(input.name ?? ''), p_guest_token_hash: eventTokenHash(personalToken) }))
    if (!joined?.ok) return { ok: false, error: String(joined?.error || 'failed') }
    answerToken = personalToken
  }
  const r = check<any>(await db.rpc('gogo_event_rsvp', { p_token_hash: eventTokenHash(answerToken), p_status: input.status, p_plus_ones: plus, p_dietary: input.dietary ?? null, p_comment: input.comment ?? null }))
  if (!r?.ok) return { ok: false, error: String(r?.error || 'failed'), placesLeft: Number.isInteger(r?.places_left) ? r.places_left : undefined, personalToken }
  return { ok: true, personalToken }
}

export const isEventToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t)
