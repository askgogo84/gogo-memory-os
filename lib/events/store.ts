// AskGogo Events: the only code that reads or writes the gogo_event* tables. Every organizer call is scoped to the
// exact owner id (a string). Guest calls go through the database functions with a token hash and never see ids.
// The database client is injectable so the same code runs in tests.
import { createHmac, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  asHeadcount, cleanGuestText, dedupeGuests, draftProblems, eventTokenHash, missingForPublish, publicInvitation, rsvpUrl, TOKEN_RE,
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
  if (res.error) {
    if (missingTable(res.error)) fail('events_not_enabled')
    if (String(res.error?.code) === '23505') fail('duplicate')
    // The database's own code and message only: no token, name or reply text passes through here.
    console.error('EVENTS_STORE_FAILED:', JSON.stringify({ code: String(res.error?.code || '').slice(0, 12), message: String(res.error?.message || '').slice(0, 160) }))
    fail('events_store_failed')
  }
  return res.data
}

let defaultDb: Db | null = null
/** Tests only: run the public route against another database. Refused in production. */
export function setEventsDbForTests(db: Db | null) {
  if (envOf().NODE_ENV === 'production' || envOf().VERCEL_ENV) fail('not_allowed')
  defaultDb = db
}
const theDb = (db?: Db): Db => db || defaultDb || (supabaseAdmin as any)
let clockFn: (() => number) | null = null
/** Tests only: a fixed clock for "now" (publish checks, timestamps the app writes). Refused in production. */
export function setEventsClockForTests(fn: (() => number) | null) {
  if (envOf().NODE_ENV === 'production' || envOf().VERCEL_ENV) fail('not_allowed')
  clockFn = fn
}
const nowMs = () => (clockFn ? clockFn() : Date.now())
const nowIso = () => new Date(nowMs()).toISOString()

/** Links must be shown again later (copy link, resend), but only hashes are stored. So a token is derived from a
 *  server-side key and the row's id: reproducible by the server, unguessable by anyone else. */
/** The key is its own secret (GOGO_EVENTS_TOKEN_SECRET), never borrowed from another credential: rotating some
 *  other key must not silently change every invitation link. Without it nothing can be published. */
function tokenKey(env: Env = envOf()): Buffer {
  const secret = (env.GOGO_EVENTS_TOKEN_SECRET || '').trim()
  if (secret.length < 32) fail('events_token_key_missing')
  return createHmac('sha256', 'gogo-events-token-key-v1').update(secret).digest()
}
const CLIENT_KEY_RE = /^[A-Za-z0-9_-]{16,64}$/
/** share: per event and rotation number. guest: per guest row. join: per event and the browser's own random key, so a
 *  retried first answer lands on the same guest. */
export function derivedToken(kind: 'share' | 'guest' | 'join', id: string, extra: string | number = '', env: Env = envOf()): string {
  if (kind === 'join' && !CLIENT_KEY_RE.test(String(extra))) fail('invalid_client_key')
  if (kind === 'share' && !(Number.isInteger(extra) && (extra as number) >= 0)) fail('invalid_share_nonce')
  return createHmac('sha256', tokenKey(env)).update(`${kind}:${uuid(id).toLowerCase()}:${extra}`).digest('base64url')
}
const shareNonce = (e: any): number => (Number.isInteger(e?.share_nonce) && e.share_nonce >= 0 ? e.share_nonce : 0)

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
  // Best effort: the action itself already happened. A failure is logged so a gap in the trail is visible.
  try {
    const res = await db.from('gogo_event_audit').insert({ event_id: eventId, actor: actor.slice(0, 40), action, detail })
    if (res?.error) console.error('EVENTS_AUDIT_FAILED:', JSON.stringify({ action, code: String(res.error?.code || '').slice(0, 12) }))
  } catch { console.error('EVENTS_AUDIT_FAILED:', JSON.stringify({ action })) }
}

/** An audit line for an organizer action done outside this module (e.g. the calendar write). Owner-checked first. */
export async function recordOwnerAudit(owner: string, id: string, action: 'event.calendar_synced' | 'event.venue_enquiry_drafted', detail: Record<string, unknown> = {}, db: Db = theDb()): Promise<void> {
  const e = await getEvent(owner, id, db)
  await audit(db, e.id, 'owner', action, detail)
}

/** The details of earlier audit lines of one kind for the owner's event, newest first (e.g. which venue an enquiry was
 *  already drafted for, so it is offered once and not on every edit). */
export async function ownerAuditDetails(owner: string, id: string, action: 'event.venue_enquiry_drafted', db: Db = theDb()): Promise<Record<string, unknown>[]> {
  const e = await getEvent(owner, id, db)
  const rows = check(await db.from('gogo_event_audit').select('detail').eq('event_id', e.id).eq('action', action).order('id', { ascending: false }).limit(20)) as any[]
  return (rows || []).map(r => (r?.detail && typeof r.detail === 'object' ? r.detail : {}))
}

// ---- organizer ------------------------------------------------------------------------------------------------------
export async function createEvent(owner: string, draft: EventDraft, db: Db = theDb()): Promise<EventRow> {
  const row = rowFromDraft(draft)
  if (!row.title) fail('title_required')
  const at = nowIso()
  const e = check<EventRow>(await db.from('gogo_events').insert({ ...row, owner_telegram_id: owned(owner), status: 'draft', created_at: at, updated_at: at }).select('*').single())
  await audit(db, e.id, 'owner', 'event.created')
  return e
}

export async function getEvent(owner: string, id: string, db: Db = theDb()): Promise<EventRow> {
  const e = check<EventRow | null>(await db.from('gogo_events').select('*').eq('owner_telegram_id', owned(owner)).eq('id', uuid(id)).maybeSingle())
  return e || fail('not_found')
}

export async function listEvents(owner: string, db: Db = theDb()): Promise<EventRow[]> {
  return check<EventRow[]>(await db.from('gogo_events').select('*').eq('owner_telegram_id', owned(owner)).order('created_at', { ascending: false }).limit(50)) || []
}

/** Edits bump the revision so guests can be told something changed. A cancelled or completed event is not edited. */
export async function updateEvent(owner: string, id: string, patch: EventDraft, db: Db = theDb()): Promise<EventRow> {
  const current = await getEvent(owner, id, db)
  if (current.status === 'cancelled' || current.status === 'completed') fail('event_closed')
  const row = rowFromDraft(patch)
  if ('title' in row && !row.title) fail('title_required')
  if (current.status === 'published') {
    const next = { ...draftFromRow(current), ...patch }
    if (missingForPublish(next, nowMs()).length) fail('would_unpublish')
  }
  const e = check<EventRow | null>(await db.from('gogo_events').update({ ...row, revision: current.revision + 1, updated_at: nowIso() })
    .eq('owner_telegram_id', owned(owner)).eq('id', current.id).eq('revision', current.revision).select('*').maybeSingle())
  if (!e) fail('changed_meanwhile')
  await audit(db, current.id, 'owner', 'event.updated', { fields: Object.keys(row) })
  return e as EventRow
}

/** Publishing opens the invitation. Returns what is still missing instead of guessing it. */
export async function publishEvent(owner: string, id: string, db: Db = theDb()): Promise<{ event: EventRow | null; missing: string[]; shareUrl: string | null }> {
  const current = await getEvent(owner, id, db)
  if (current.status === 'cancelled' || current.status === 'completed') fail('event_closed')
  const missing = missingForPublish(draftFromRow(current), nowMs())
  if (missing.length) return { event: null, missing, shareUrl: null }
  const token = derivedToken('share', current.id, shareNonce(current))
  // Guarded by the revision read above: a cancel or an edit that landed in between wins, and this publish is retried.
  const e = check<EventRow | null>(await db.from('gogo_events').update({ status: 'published', share_token_hash: eventTokenHash(token), revision: current.revision + 1, updated_at: nowIso() })
    .eq('owner_telegram_id', owned(owner)).eq('id', current.id).eq('revision', current.revision).select('*').maybeSingle())
  if (!e) fail('changed_meanwhile')
  await audit(db, current.id, 'owner', 'event.published')
  return { event: e, missing: [], shareUrl: rsvpUrl(token) }
}

/** The link the organizer forwards. Null until the event is published or after the link is switched off. */
export async function shareLink(owner: string, id: string, db: Db = theDb()): Promise<string | null> {
  const e: any = await getEvent(owner, id, db)
  const token = derivedToken('share', e.id, shareNonce(e))
  return e.status === 'published' && e.share_token_hash === eventTokenHash(token) ? rsvpUrl(token) : null
}
/** Switches the share link off for good: the rotation number moves on, so the old link can never come back.
 *  Personal links keep working. */
export async function disableShareLink(owner: string, id: string, db: Db = theDb()): Promise<void> {
  const e = await getEvent(owner, id, db)
  // Same revision guard as publish, and it bumps the revision, so a publish that read the old state cannot write
  // the old link back afterwards.
  const rows = check<any[]>(await db.from('gogo_events').update({ share_token_hash: null, share_nonce: shareNonce(e) + 1, revision: e.revision + 1 }).eq('owner_telegram_id', owned(owner)).eq('id', e.id).eq('revision', e.revision).select('id')) || []
  if (!rows.length) fail('changed_meanwhile')
  await audit(db, e.id, 'owner', 'share_link.disabled')
}
/** A fresh share link; the previous one stops working. Null if the event is not published. */
export async function rotateShareLink(owner: string, id: string, db: Db = theDb()): Promise<string | null> {
  const e = await getEvent(owner, id, db)
  if (e.status !== 'published') return null
  const nonce = shareNonce(e) + 1, token = derivedToken('share', e.id, nonce)
  const rows = check<any[]>(await db.from('gogo_events').update({ share_token_hash: eventTokenHash(token), share_nonce: nonce, revision: e.revision + 1 }).eq('owner_telegram_id', owned(owner)).eq('id', e.id).eq('revision', e.revision).select('id')) || []
  if (!rows.length) fail('changed_meanwhile')
  await audit(db, e.id, 'owner', 'share_link.rotated')
  return rsvpUrl(token)
}

export async function cancelEvent(owner: string, id: string, db: Db = theDb()): Promise<EventRow> {
  const current = await getEvent(owner, id, db)
  if (current.status === 'cancelled') return current
  const now = nowIso()
  // A draft that never had a date was never an invitation anyone could open: it is discarded, not kept as cancelled.
  if (current.status === 'draft' && !current.starts_at) {
    check(await db.from('gogo_events').delete().eq('owner_telegram_id', owned(owner)).eq('id', current.id).select('id'))
    return { ...current, status: 'cancelled' }
  }
  const e = check<EventRow | null>(await db.from('gogo_events').update({ status: 'cancelled', cancelled_at: now, updated_at: now, revision: current.revision + 1 })
    .eq('owner_telegram_id', owned(owner)).eq('id', current.id).eq('revision', current.revision).select('*').maybeSingle())
  if (!e) fail('changed_meanwhile')
  await audit(db, current.id, 'owner', 'event.cancelled')
  return e as EventRow
}

/** Guests the organizer typed. Nobody is messaged: each gets a personal link the organizer can pass on. */
export async function addGuests(owner: string, id: string, input: { name: string; phone?: string | null }[], db: Db = theDb()) {
  const e = await getEvent(owner, id, db)
  if (e.status === 'cancelled' || e.status === 'completed') fail('event_closed')
  if (input.length > 200) fail('too_many_at_once')
  const all = check<{ name: string; phone: string | null; token_revoked_at: string | null }[]>(await db.from('gogo_event_guests').select('name, phone, token_revoked_at').eq('event_id', e.id).limit(2000)) || []
  // A revoked guest does not count: adding the same person again gives them a fresh link.
  const existing = all.filter(g => !g.token_revoked_at)
  const { add, duplicates, invalid } = dedupeGuests(input, existing)
  if (existing.length + add.length > 1000) fail('guest_limit')
  const rows = add.map(g => { const gid = randomUUID(); return { id: gid, event_id: e.id, name: g.name, phone: g.phone, source: 'organizer', token_hash: eventTokenHash(derivedToken('guest', gid)) } })
  if (rows.length) check(await db.from('gogo_event_guests').insert(rows).select('id'))
  if (rows.length) await audit(db, e.id, 'owner', 'guests.added', { count: rows.length })
  return { added: rows.map(r => ({ name: r.name, link: rsvpUrl(derivedToken('guest', r.id)) })), duplicates, invalid }
}

export type OrganizerGuest = { id: string; name: string; hasPhone: boolean; source: string; rsvp: string; plusOnes: number; dietary: string | null; comment: string | null; rsvpAt: string | null; inviteStatus: string; revoked: boolean; optedOut: boolean }
export async function listGuests(owner: string, id: string, db: Db = theDb()): Promise<OrganizerGuest[]> {
  const e = await getEvent(owner, id, db)
  const rows = check<any[]>(await db.from('gogo_event_guests').select('id, name, phone, source, rsvp_status, plus_ones, dietary, comment, rsvp_at, invite_status, token_revoked_at, opted_out').eq('event_id', e.id).order('created_at', { ascending: true }).limit(2000)) || []
  return rows.map(g => ({ id: g.id, name: g.name, hasPhone: Boolean(g.phone), source: g.source, rsvp: g.rsvp_status, plusOnes: g.plus_ones, dietary: g.dietary, comment: g.comment, rsvpAt: g.rsvp_at, inviteStatus: g.invite_status, revoked: Boolean(g.token_revoked_at), optedOut: Boolean(g.opted_out) }))
}

export async function revokeGuest(owner: string, id: string, guestId: string, db: Db = theDb()): Promise<void> {
  const e = await getEvent(owner, id, db)
  const rows = check<any[]>(await db.from('gogo_event_guests').update({ token_revoked_at: nowIso() }).eq('event_id', e.id).eq('id', uuid(guestId)).select('id')) || []
  if (!rows.length) fail('not_found')
  await audit(db, e.id, 'owner', 'guest.revoked', { guest: uuid(guestId) })
}

/** The personal link of a guest the organizer added (their link is derived from the guest row, so it can be shown
 *  again). Guests who joined through the share link hold their own link; it cannot be re-issued here. */
export async function guestLink(owner: string, id: string, guestId: string, db: Db = theDb()): Promise<string | null> {
  const e = await getEvent(owner, id, db)
  const g = check<any>(await db.from('gogo_event_guests').select('id, source, token_hash, token_revoked_at').eq('event_id', e.id).eq('id', uuid(guestId)).maybeSingle())
  if (!g || g.token_revoked_at || g.source !== 'organizer') return null
  const token = derivedToken('guest', g.id)
  return g.token_hash === eventTokenHash(token) ? rsvpUrl(token) : null
}

/** A cancel or time change on a published event is parked here until the organizer says yes. */
export type PendingAction = { type: 'cancel' } | { type: 'move'; startsAt: string }
export async function setPendingAction(owner: string, id: string, action: PendingAction | null, db: Db = theDb(), now = nowMs()): Promise<void> {
  const e = await getEvent(owner, id, db)
  check(await db.from('gogo_events').update({ pending_action: action ? { ...action, at: new Date(now).toISOString() } : null }).eq('owner_telegram_id', owned(owner)).eq('id', e.id).select('id'))
}
export function pendingActionOf(e: any, now = Date.now(), maxAgeMs = 10 * 60_000): PendingAction | null {
  const p = e?.pending_action
  if (!p || typeof p !== 'object' || !Number.isFinite(Date.parse(p.at)) || now - Date.parse(p.at) > maxAgeMs || now < Date.parse(p.at) - 60_000) return null
  if (p.type === 'cancel') return { type: 'cancel' }
  if (p.type === 'move' && typeof p.startsAt === 'string' && Number.isFinite(Date.parse(p.startsAt))) return { type: 'move', startsAt: p.startsAt }
  return null
}

/** Counted by the database, in people. */
export async function headcount(owner: string, id: string, db: Db = theDb()): Promise<Headcount> {
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
export async function invitationFor(token: string, db: Db = theDb()) {
  const found = await lookup(token, db)
  if (!found || found.event.status === 'draft') return null
  if (found.kind === 'guest' && found.guest.token_revoked_at) return { mode: 'revoked' as const, view: null }
  return { mode: found.kind, view: publicInvitation(found.event, found.guest) }
}

export type RsvpInput = { status: string; plusOnes?: number; dietary?: string | null; comment?: string | null; name?: string | null; clientKey?: string | null }
/** One answer. With a personal link it updates that guest. With the share link the guest is added and answered in
 *  one transaction; their personal token is derived from the browser's own random key, so sending the same first
 *  answer twice lands on the same guest. Free text is cleaned of control and direction-override characters. */
export async function submitRsvp(token: string, input: RsvpInput, db: Db = theDb()): Promise<{ ok: boolean; error?: string; placesLeft?: number; personalToken?: string }> {
  const found = await lookup(token, db)
  if (!found) return { ok: false, error: 'not_found' }
  if (!['going', 'maybe', 'declined'].includes(input.status)) return { ok: false, error: 'invalid_status' }
  const plus = Number.isInteger(input.plusOnes) ? Math.min(Math.max(input.plusOnes as number, 0), 10) : 0
  const dietary = cleanGuestText(input.dietary, 120) || null, comment = cleanGuestText(input.comment, 300) || null
  let r: any, personalToken: string | undefined
  if (found.kind === 'share') {
    if (!CLIENT_KEY_RE.test(String(input.clientKey ?? ''))) return { ok: false, error: 'invalid_client_key' }
    personalToken = derivedToken('join', found.event.id, String(input.clientKey))
    r = check<any>(await db.rpc('gogo_event_join_rsvp', { p_share_hash: eventTokenHash(token), p_name: cleanGuestText(input.name, 80), p_guest_token_hash: eventTokenHash(personalToken), p_status: input.status, p_plus_ones: plus, p_dietary: dietary, p_comment: comment }))
  } else {
    r = check<any>(await db.rpc('gogo_event_rsvp', { p_token_hash: eventTokenHash(token), p_status: input.status, p_plus_ones: plus, p_dietary: dietary, p_comment: comment }))
  }
  // A refused first answer through the share link created no guest, so there is no personal link to hand back.
  if (!r?.ok) return { ok: false, error: String(r?.error || 'failed'), placesLeft: Number.isInteger(r?.places_left) ? r.places_left : undefined }
  return { ok: true, personalToken }
}

/** A fixed-window request bound for the public endpoint. If the counter itself is unavailable the request is allowed:
 *  the database functions still enforce every rule that matters. */
export async function rateOk(bucket: string, limit: number, windowSeconds: number, db: Db = theDb()): Promise<boolean> {
  try {
    const res = await db.rpc('gogo_event_rate_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds })
    return res?.error ? true : res?.data !== false
  } catch { return true }
}

export const isEventToken = (t: unknown): t is string => typeof t === 'string' && TOKEN_RE.test(t)
