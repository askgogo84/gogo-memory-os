// Instinct-style follow-ups (14 Nov, owner: "build follow-ups in shadow" + "build follow-ups live for me only").
// Instinct came back on the WeWork deadline day, asked once "still want these moving?" about stale asks, and nudged
// an unsent anniversary inquiry eight days out. Gogo computes the same three kinds of follow-up:
//   deadline — the day after the email judge flagged a mail as time-sensitive, if no newer mail came from that sender
//              (a re-check, not the due date itself: the judge's flag is an inference and is worded as one);
//   event    — an upcoming event of theirs that needs a step (draft unpublished, nobody invited, guests silent);
//   digest   — stale things the person asked for (2+ days untouched), listed once (no numbers; see buildDigest).
// Every line is built from checked fields (sender, subject, dates, titles); no model text is ever sent.
// SHADOW for every GOGO_PROACTIVE_SHADOW owner (logged as proactive_shadow 'followup', nothing sent).
// LIVE only for owners in GOGO_FOLLOWUPS_LIVE: at most 2 a day, an item never twice in 7 days, 8 am to 10 pm local,
// one message per pass, "stop follow-ups" turns it off. The 4 Nov quiet rule still holds for everyone else.
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { proactiveShadowOwners, shadowText, cleanupCandidates, logProactiveShadow, recentShadowRows } from './proactive-shadow'

export const FOLLOWUP_DAILY_CAP = 2
export const FOLLOWUP_REPEAT_DAYS = 7
export const DIGEST_STALE_DAYS = 2
export const DIGEST_MAX = 4
const DAY = 86_400_000

export type FollowUpKind = 'deadline' | 'event' | 'digest'
export type FollowUp = { kind: FollowUpKind; keys: string[]; text: string; label: string }
export type DeadlineItem = { key: string; sender: string; subject: string; judgedAt: number; newerMail: boolean | null; mailbox?: string }
export type EventItem = { key: string; title: string; why: string; href: string }

const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const ID = /^-?[1-9]\d{0,19}$/

/** Exact legacy ids in GOGO_FOLLOWUPS_LIVE (negative allowed). Anything else is ignored. */
export function followupsLiveOwners(env: Record<string, string | undefined> = process.env): string[] {
  return [...new Set(String(env.GOGO_FOLLOWUPS_LIVE || '').split(',').map(s => s.trim()).filter(s => ID.test(s)))]
}
export function followupOwners(env: Record<string, string | undefined> = process.env): string[] {
  return [...new Set([...proactiveShadowOwners(env), ...followupsLiveOwners(env)])]
}

export function localHour(now: number, tz: string): number {
  try { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(now))) % 24 } catch { return new Date(now + 330 * 60_000).getUTCHours() }
}
export function localDay(now: number, tz: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)) } catch { return new Date(now + 330 * 60_000).toISOString().slice(0, 10) }
}
/** 8 am to 10 pm in the person's time zone. */
export const inFollowupHours = (now: number, tz: string) => { const h = localHour(now, tz); return h >= 8 && h < 22 }

/** UUID-shaped claim id: agent_activity's primary key makes "slot N of this day" atomic across workers. */
export function followupClaimId(owner: string, day: string, slot: number): string {
  const d = createHash('sha256').update(JSON.stringify(['askgogo.followup.v1', String(owner), day, slot])).digest('hex')
  return `${d.slice(0, 8)}-${d.slice(8, 12)}-8${d.slice(13, 16)}-a${d.slice(17, 20)}-${d.slice(20, 32)}`
}

/** "Sender Name <a@b.com>" → "Sender Name"; a bare address → its domain's name ("wework.com" → "WeWork"-ish as written). */
export function senderName(from: string): string {
  const raw = clean(from, 160)
  const named = raw.replace(/<[^>]*>/g, '').replace(/^["']|["']$/g, '').trim()
  if (named && !/@/.test(named)) return clean(named, 60)
  // "team@mail.wework.co.in" → "Wework": the last label that is not a country/generic suffix or a mail subdomain.
  const labels = (raw.match(/@([a-z0-9.-]+)/i)?.[1] || '').toLowerCase().split('.').filter(Boolean)
  const name = labels.filter(l => !/^(?:com|co|in|org|net|gov|ac|edu|io|ai|app|me|uk|us|biz|info|mail|email|mailer|e|m|em|news|notify|alerts?|noreply|no-reply|info)$/.test(l)).pop() || ''
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'A sender'
}

const dayWords = (at: number, now: number, tz: string) => {
  const a = localDay(at, tz), b = localDay(now, tz)
  if (a === b) return 'today’s'
  if (localDay(now - DAY, tz) === a) return 'yesterday’s'
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(at)) + '’s' } catch { return 'an earlier' }
}

/** Deadline-day re-check. Only when the judge's flag is from an earlier day and NO newer mail came from that sender
 *  (unknown inbox state → no follow-up). Pure. */
export function buildDeadline(items: DeadlineItem[], recent: Set<string>, now: number, tz: string): FollowUp | null {
  const it = items.find(i => !recent.has(i.key) && i.newerMail === false && localDay(i.judgedAt, tz) !== localDay(now, tz) && now - i.judgedAt < 3 * DAY)
  if (!it) return null
  const who = senderName(it.sender), subject = clean(it.subject, 90)
  const text = `${who}: I flagged ${dayWords(it.judgedAt, now, tz)} mail “${subject}” as time-sensitive. I see no newer mail from them since. Has it been handled?`
  return { kind: 'deadline', keys: [it.key], text, label: text }
}

/** An upcoming event step, from the event's own fields (lib/events/next-steps). Pure. */
export function buildEvent(items: EventItem[], recent: Set<string>, origin: string): FollowUp | null {
  const it = items.find(i => !recent.has(i.key))
  if (!it) return null
  const title = clean(it.title, 80), why = clean(it.why, 300)
  const link = /^\/dashboard\//.test(it.href) ? `${origin.replace(/\/$/, '')}${it.href}` : ''
  return { kind: 'event', keys: [it.key], text: `${title}: ${why}${link ? `\nOpen: ${link}` : ''}`, label: `${title}: ${why}` }
}

/** "Still want these moving?" — what the person asked for, untouched for 2+ days, not asked about in 7 days. Pure. */
export function buildDigest(loops: any[], recent: Set<string>, now: number): FollowUp | null {
  const stale = cleanupCandidates(loops, now).filter((l: any) => {
    if (l.source_type !== 'conversation') return false
    if (!['followup', 'commitment', 'meeting_action', 'waiting_on', 'other'].includes(String(l.kind))) return false
    // Only what the person said, never a loop Gogo inferred from a chat turn (review: jev_attention_state is a model guess).
    if (l.evidence_json?.jev_attention_state) return false
    if (l.next_check_at && Date.parse(String(l.next_check_at)) > now) return false
    const seen = Date.parse(String(l.last_seen_at || l.updated_at || ''))
    if (!Number.isFinite(seen) || now - seen < DIGEST_STALE_DAYS * DAY) return false
    const title = clean(l.title, 120)
    if (!title || /^(?:waiting on me|waiting|pending|open loop|follow up|follow-up|needs attention)$/i.test(title)) return false
    return !recent.has(`open_loop:${l.id}`)
  }).sort((a: any, b: any) => Number(b.priority || 0) - Number(a.priority || 0)).slice(0, DIGEST_MAX)
  if (!stale.length) return null
  const titles = stale.map((l: any) => clean(l.title, 120))
  // No numbers (review): a late "mark 2 done" with no live list would fall to the reminder handlers and tick a
  // reminder instead. Dropping or finishing goes through the numbered list the person asks for.
  const text = `Still want these moving?\n${titles.map((t: string) => `• ${t}`).join('\n')}\n\nAsk *what needs my attention?* to drop or finish any of them.`
  return { kind: 'digest', keys: stale.map((l: any) => `open_loop:${l.id}`), text, label: `Still want these moving? ${titles.join(' · ')}`.slice(0, 400) }
}

/** Deadline first (time-bound), then an event step, then the digest (once a day). */
export function pickFollowUp(c: { deadline: FollowUp | null; event: FollowUp | null; digest: FollowUp | null }, digestSentToday: boolean): FollowUp | null {
  return c.deadline || c.event || (digestSentToday ? null : c.digest)
}

// ---- I/O ---------------------------------------------------------------------------------------------------------

type Deps = {
  now?: () => number
  env?: Record<string, string | undefined>
  db?: any
  newerMail?: (owner: string, sender: string, sinceMs: number, mailbox?: string) => Promise<boolean | null>
  quiet?: (owner: string, tz: string, now: number) => Promise<boolean>
  events?: (owner: string) => Promise<EventItem[]>
  send?: (to: string, text: string, label: string, session: boolean) => Promise<{ sid?: string } | null>
  session?: (owner: string) => Promise<boolean>
  shadowHistory?: (owner: string) => Promise<{ at: string; meta: any }[] | null>
  log?: (owner: string, meta: Record<string, unknown>) => Promise<boolean>
}

const ownerKey = (id: string): number | string => { const n = Number(id); return Number.isSafeInteger(n) && String(n) === id ? n : id }

/** The latest stop/start command wins. Unknown → stopped (never send on unreadable state). */
export async function followupsStopped(owner: string, db: any = supabaseAdmin): Promise<boolean> {
  const { data, error } = await db.from('agent_activity').select('event_type').eq('telegram_id', owner)
    .in('event_type', ['followups_stopped', 'followups_started']).order('created_at', { ascending: false }).limit(1)
  if (error) return true
  return data?.[0]?.event_type === 'followups_stopped'
}

async function sentRows(owner: string, db: any, sinceMs: number) {
  const { data, error } = await db.from('agent_activity').select('created_at,metadata_json').eq('telegram_id', owner)
    .eq('event_type', 'followup_sent').gte('created_at', new Date(sinceMs).toISOString()).order('created_at', { ascending: false }).limit(50)
  if (error) return null
  return (data || []).map((r: any) => ({ at: Date.parse(String(r.created_at)), kind: String(r.metadata_json?.kind || ''), keys: Array.isArray(r.metadata_json?.keys) ? r.metadata_json.keys.map(String) : [] }))
}

async function deadlineItems(owner: string, db: any, now: number, newerMail: NonNullable<Deps['newerMail']>): Promise<DeadlineItem[]> {
  const { data, error } = await db.from('agent_activity').select('created_at,metadata_json').eq('telegram_id', owner)
    .eq('event_type', 'proactive_shadow').eq('metadata_json->>kind', 'email_judge')
    .gte('created_at', new Date(now - 3 * DAY).toISOString()).order('created_at', { ascending: false }).limit(40)
  if (error) return []
  const out: DeadlineItem[] = []
  for (const r of data || []) {
    const at = Date.parse(String(r.created_at))
    for (const v of Array.isArray(r.metadata_json?.verdicts) ? r.metadata_json.verdicts : []) {
      if (!v?.important || !['cutoff', 'deadline'].includes(String(v.kind)) || v.phishing || !v.id || !v.from_addr) continue
      const key = `deadline:${String(v.id).slice(0, 80)}`
      if (out.some(o => o.key === key)) continue
      out.push({ key, sender: String(v.sender || v.from_addr), subject: String(v.subject || ''), judgedAt: at, newerMail: null, mailbox: String(v.mailbox || '') })
      if (out.length >= 3) break
    }
    if (out.length >= 3) break
  }
  for (const it of out) {
    const v = (data || []).flatMap((r: any) => r.metadata_json?.verdicts || []).find((x: any) => `deadline:${String(x.id).slice(0, 80)}` === it.key)
    it.newerMail = await newerMail(owner, String(v?.from_addr || ''), it.judgedAt, it.mailbox).catch(() => null)
  }
  return out
}

async function defaultNewerMail(owner: string, sender: string, sinceMs: number, mailbox?: string): Promise<boolean | null> {
  const addr = (sender.match(/[^\s<>@]+@[^\s<>@]+\.[a-z]{2,}/i)?.[0] || '').toLowerCase()
  if (!addr) return null
  const { gmailAccessForOwner } = await import('./open-loops') as any
  if (typeof gmailAccessForOwner !== 'function') return null
  const access = await gmailAccessForOwner(owner)
  if (!access?.accessToken) return null
  // Only the primary inbox is searched here; a mail judged in another mailbox is unknown, so no follow-up (review).
  if (!mailbox || String(access.ownEmail || '').toLowerCase() !== mailbox.toLowerCase()) return null
  const { searchGmailThreads } = await import('@/lib/services/google-gmail')
  const after = Math.floor(sinceMs / 1000)
  const threads = await searchGmailThreads(access.accessToken, `from:${addr} after:${after}`, 5, { raw: true }).catch(() => null)
  if (!Array.isArray(threads)) return null
  // Only mail FROM that sender counts, and only after the flagged mail was judged.
  return threads.some(t => (t.messages || []).some(m => Number(m.internalDate || 0) > sinceMs && String(m.from || '').toLowerCase().includes(addr)))
}

async function defaultEvents(owner: string): Promise<EventItem[]> {
  const { getEventSuggestions } = await import('@/lib/events/next-steps')
  return (await getEventSuggestions(owner)).map(s => ({ key: `event:${s.eventId}:${s.key}`, title: s.title, why: s.why, href: s.href }))
}

async function defaultQuiet(owner: string, tz: string, now: number): Promise<boolean> {
  const { getAlertPreferences } = await import('./alert-preferences')
  const { isQuietHour } = await import('./alert-preferences-shared')
  return isQuietHour(await getAlertPreferences(owner), localHour(now, tz))
}

async function defaultSession(owner: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('conversations').select('created_at').eq('telegram_id', owner).eq('role', 'user')
    .gte('created_at', new Date(Date.now() - 23 * 3600_000).toISOString()).limit(1)
  return !error && Boolean(data?.length)
}

async function defaultSend(to: string, text: string, label: string, session: boolean) {
  const wa = await import('@/lib/whatsapp')
  // Free text inside WhatsApp's 24-hour window; outside it the approved reminder template carries the same line.
  return session ? wa.sendWhatsApp(to, text) : wa.sendWhatsAppReminderTemplate(to, label)
}

/** One pass for one owner: compute, log the shadow row, and (live owners only) send at most one follow-up. */
export async function runFollowUps(owner: string, deps: Deps = {}) {
  const now = (deps.now || Date.now)(), env = deps.env || process.env, db = deps.db || supabaseAdmin
  if (!ID.test(owner)) return { ok: false, reason: 'bad_owner' }
  const { data: user } = await db.from('users').select('telegram_id,whatsapp_id,timezone,access_status').eq('telegram_id', ownerKey(owner)).maybeSingle()
  if (!user || String(user.telegram_id) !== owner) return { ok: false, reason: 'user_unavailable' }
  const tz = String(user.timezone || 'Asia/Kolkata')
  if (!inFollowupHours(now, tz)) return { ok: true, reason: 'outside_hours' }
  const live = followupsLiveOwners(env).includes(owner) && Boolean(user.whatsapp_id) && (!user.access_status || user.access_status === 'active')
  const sent = await sentRows(owner, db, now - FOLLOWUP_REPEAT_DAYS * DAY)
  if (!sent) return { ok: false, reason: 'history_unavailable' }
  const shadow = await (deps.shadowHistory || (id => recentShadowRows(id, 'followup', FOLLOWUP_REPEAT_DAYS * 24)))(owner)
  if (!shadow) return { ok: false, reason: 'history_unavailable' }
  // Repeats are judged against what was SENT for live owners and what was LOGGED for shadow-only owners.
  const recent = new Set<string>(live ? sent.flatMap(s => s.keys) : shadow.flatMap(s => s.meta.item_keys || []))
  const today = localDay(now, tz)
  const digestToday = live ? sent.some(s => s.kind === 'digest' && localDay(s.at, tz) === today) : shadow.some(s => localDay(Date.parse(s.at), tz) === today && (s.meta.item_keys || []).some((k: string) => k.startsWith('open_loop:')))

  const { data: loops } = await db.from('agent_open_loops')
    .select('id,kind,title,summary,priority,next_check_at,proactive_backoff_until,source_type,source_id,evidence_json,last_seen_at,updated_at')
    .eq('telegram_id', owner).eq('status', 'active').order('priority', { ascending: false }).limit(80)
  const origin = String(env.NEXT_PUBLIC_APP_URL || env.APP_URL || 'https://app.askgogo.in')
  const [deadlines, events] = await Promise.all([
    deadlineItems(owner, db, now, deps.newerMail || defaultNewerMail).catch(() => [] as DeadlineItem[]),
    (deps.events || defaultEvents)(owner).catch(() => [] as EventItem[]),
  ])
  const pick = pickFollowUp({ deadline: buildDeadline(deadlines, recent, now, tz), event: buildEvent(events, recent, origin), digest: buildDigest(loops || [], recent, now) }, digestToday)
  if (!pick) return { ok: true, reason: 'nothing_due' }

  if (!live) {
    const logged = await (deps.log || ((id, meta) => logProactiveShadow(id, 'followup', meta)))(owner, { follow_up: pick.kind, would_send: shadowText(pick.text, 1200), item_keys: pick.keys })
    return { ok: logged, mode: 'shadow', kind: pick.kind }
  }
  if (await followupsStopped(owner, db)) return { ok: true, reason: 'stopped' }
  // The person's own alert quiet hours win over the 8 am-10 pm default (review).
  const quiet = await (deps.quiet || defaultQuiet)(owner, tz, now).catch(() => true)
  if (quiet) return { ok: true, reason: 'quiet_hours' }
  // At most two a day. The slot is the next free one by this read; if another pass took it (23505), this pass stops
  // instead of trying the next slot, so two overlapping passes can never send the same item twice (review).
  const sentToday = sent.filter(s => localDay(s.at, tz) === today).length
  if (sentToday >= FOLLOWUP_DAILY_CAP) return { ok: true, reason: 'daily_cap' }
  const slot = sentToday + 1
  const { error: claimError } = await db.from('agent_activity').insert({ id: followupClaimId(owner, today, slot), telegram_id: owner, event_type: 'followup_sent',
    message: shadowText(pick.text, 600), metadata_json: { kind: pick.kind, keys: pick.keys, slot, day: today } })
  if (claimError) return { ok: claimError.code === '23505', reason: claimError.code === '23505' ? 'claimed_elsewhere' : 'claim_failed' }
  // Record first, then send: a crash between the two can only skip a follow-up, never send two.
  try {
    const session = await (deps.session || defaultSession)(owner).catch(() => false)
    const res = await (deps.send || defaultSend)(String(user.whatsapp_id), pick.text, pick.label, session)
    if (!res?.sid) { console.error('FOLLOWUP_SEND_UNCONFIRMED:', JSON.stringify({ kind: pick.kind })); return { ok: false, reason: 'outcome_unknown' } }
    console.log('FOLLOWUP_SENT:', JSON.stringify({ kind: pick.kind, keys: pick.keys.length, session }))
    return { ok: true, mode: 'live', kind: pick.kind }
  } catch {
    // The provider may have accepted it; the claim stays, so it is never sent again.
    console.error('FOLLOWUP_SEND_OUTCOME_UNKNOWN:', JSON.stringify({ kind: pick.kind }))
    return { ok: false, reason: 'outcome_unknown' }
  }
}

export async function processFollowUps(deps: Deps = {}) {
  const owners = followupOwners(deps.env || process.env)
  const results: any[] = []
  for (const owner of owners) results.push(await runFollowUps(owner, deps).catch(() => ({ ok: false, reason: 'failed' })))
  return { owners: owners.length, results }
}

/** "stop follow-ups" / "start follow-ups". Recorded as the latest command; stop wins on any read error. */
export function parseFollowUpCommand(text: string): 'stop' | 'start' | null {
  const t = clean(text, 80).toLowerCase().replace(/[.!]+$/, '')
  if (/^(?:stop|pause|turn off|no more)\s+follow[\s-]?ups?$/.test(t)) return 'stop'
  if (/^(?:start|resume|turn on)\s+follow[\s-]?ups?$/.test(t)) return 'start'
  return null
}
export async function handleFollowUpCommand(owner: string, text: string, db: any = supabaseAdmin) {
  const cmd = parseFollowUpCommand(text)
  if (!cmd) return null
  const { error } = await db.from('agent_activity').insert({ telegram_id: owner, event_type: cmd === 'stop' ? 'followups_stopped' : 'followups_started', message: `Follow-ups ${cmd === 'stop' ? 'stopped' : 'started'} by the person.`, metadata_json: {} })
  if (error) return cmd === 'stop' ? 'I could not save that just now. Please send *stop follow-ups* again.' : 'I could not save that just now. Please try again.'
  return cmd === 'stop' ? 'Follow-ups are off. Your reminders and watches keep running. Say *start follow-ups* to turn them back on.' : 'Follow-ups are on: at most 2 a day, between 8 am and 10 pm. Say *stop follow-ups* any time.'
}
