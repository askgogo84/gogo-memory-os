// Entity resolution: "Nithin" in a memory, nithin@tipplr.in in Gmail, "Nithin K L" as a calendar guest and the
// WhatsApp number in friend_contacts are one person. Until 7 Nov every feature matched on its own (meeting prep by
// attendee email, Gmail by display name, friend reminders by saved name), so Gogo could not answer "what's pending
// with Nithin?" or add what it knows about a guest to a meeting prep. This module merges observations from the
// sources already connected into one directory and resolves a name, address or number to one person, or says it is
// ambiguous. Read-only; nothing is written back to any provider.
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'

export type PersonSource = 'contacts' | 'google_contacts' | 'calendar' | 'gmail' | 'memory'
export type Observation = { name?: string | null; email?: string | null; phone?: string | null; source: PersonSource; note?: string | null; at?: string | null }
export type Person = { key: string; names: string[]; emails: string[]; phones: string[]; sources: PersonSource[]; notes: string[]; lastSeen: string | null }

const normName = (s: string) => String(s || '').toLowerCase().replace(/\(.*?\)|<.*?>|["']/g, ' ').replace(/[^a-z\s.]/g, ' ').replace(/\b(?:mr|mrs|ms|dr|sir|madam)\.?\b/g, ' ').replace(/\s+/g, ' ').trim()
const firstName = (s: string) => normName(s).split(' ')[0] || ''
const normEmail = (s: string) => String(s || '').toLowerCase().trim()
/** Indian numbers: the last 10 digits are the identity. */
export const normPhone = (s: string) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
/** "Divya Rao" and "Divya S" are different people; "Nithin" and "Nithin K L" may be the same. Pure. */
const surnameConflict = (a: string, b: string) => { const x = normName(a).split(' '), y = normName(b).split(' '); return x.length > 1 && y.length > 1 && x[x.length - 1] !== y[y.length - 1] }
const GENERIC_LOCAL = /^(?:no-?reply|noreply|info|support|hello|team|admin|alerts?|notifications?|billing|sales|contact|mail|news|updates?|care|help|service|orders?|donotreply)$/i
const isPersonEmail = (e: string) => { const local = e.split('@')[0] || ''; return !GENERIC_LOCAL.test(local) && !/^[a-z0-9._-]*\d{6,}/.test(local) }

/** Does an email's local part carry this first name? nithin@tipplr.in, nithin.kl@, kl.nithin@. Pure. */
export function localPartHasName(email: string, name: string): boolean {
  const first = firstName(name)
  if (first.length < 3) return false
  const local = normEmail(email).split('@')[0].replace(/[^a-z]/g, ' ')
  return local.split(' ').some(part => part === first || (part.length >= first.length + 2 && part.startsWith(first)) || (first.length >= 5 && part.length >= 4 && first.startsWith(part)))
}

/** Merge observations into people. Same email or same phone is the same person; a bare first name joins an existing
 *  person only when exactly one person carries that first name or an address with it in the local part. Pure. */
export function mergePeople(observations: Observation[]): Person[] {
  const people: Person[] = []
  const byEmail = new Map<string, Person>(), byPhone = new Map<string, Person>()
  const add = (p: Person, o: Observation) => {
    const n = String(o.name || '').replace(/\s+/g, ' ').trim(), e = normEmail(o.email || ''), ph = normPhone(o.phone || '')
    if (n && !p.names.some(x => normName(x) === normName(n))) p.names.push(n)
    if (e && !p.emails.includes(e)) { p.emails.push(e); byEmail.set(e, p) }
    if (ph && !p.phones.includes(ph)) { p.phones.push(ph); byPhone.set(ph, p) }
    if (!p.sources.includes(o.source)) p.sources.push(o.source)
    if (o.note && !p.notes.includes(o.note)) p.notes.push(o.note)
    if (o.at && (!p.lastSeen || o.at > p.lastSeen)) p.lastSeen = o.at
  }
  // Pass 1: observations with an identifier (email or phone) seed and merge people.
  for (const o of observations) {
    const e = normEmail(o.email || ''), ph = normPhone(o.phone || '')
    if (!e && !ph) continue
    const found = (e && byEmail.get(e)) || (ph && byPhone.get(ph)) || null
    if (found) { add(found, o); continue }
    // An address whose local part carries the first name of an existing single-identity person joins them.
    const n = String(o.name || ''), first = firstName(n)
    const allFirst = first ? people.filter(p => p.names.some(x => firstName(x) === first)) : []
    const byName = allFirst.filter(p => !p.names.some(x => surnameConflict(x, n)))
    const sameFull = byName.filter(p => p.names.some(x => normName(x) === normName(n)))
    // The address joins a first-name-only match only when nobody else in the directory shares that first name.
    const target = sameFull.length === 1 ? sameFull[0] : (allFirst.length === 1 && byName.length === 1 && e && localPartHasName(e, byName[0].names[0]) ? byName[0] : null)
    if (target) { add(target, o); continue }
    const p: Person = { key: e || ph, names: [], emails: [], phones: [], sources: [], notes: [], lastSeen: null }
    people.push(p); add(p, o)
  }
  // Pass 2: name-only observations (memory lines, contacts without a number) attach when unambiguous.
  for (const o of observations) {
    if (normEmail(o.email || '') || normPhone(o.phone || '')) continue
    const n = String(o.name || '').trim(); if (!n) continue
    const first = firstName(n)
    const full = people.filter(p => p.names.some(x => normName(x) === normName(n)))
    const byFirst = full.length ? full : people.filter(p => (p.names.some(x => firstName(x) === first) || p.emails.some(e => localPartHasName(e, n))) && !p.names.some(x => surnameConflict(x, n)))
    if (byFirst.length === 1) { add(byFirst[0], o); continue }
    if (byFirst.length === 0) { const p: Person = { key: `name:${normName(n)}`, names: [], emails: [], phones: [], sources: [], notes: [], lastSeen: null }; people.push(p); add(p, o) }
    // ≥2: ambiguous; the note stays unattached rather than guessed onto the wrong person.
  }
  return people
}

export type Resolution = { person: Person | null; candidates: Person[]; query: string }
/** A name, address or number → one person, or the candidates when several share the name. Pure. */
export function resolvePerson(query: string, people: Person[]): Resolution {
  const q = String(query || '').trim()
  const e = normEmail(q.includes('@') ? q : ''), ph = normPhone(/\d{10}/.test(q.replace(/\D/g, '')) ? q : '')
  if (e) { const p = people.find(x => x.emails.includes(e)) || null; return { person: p, candidates: p ? [p] : [], query: q } }
  if (ph) { const p = people.find(x => x.phones.includes(ph)) || null; return { person: p, candidates: p ? [p] : [], query: q } }
  const full = people.filter(p => p.names.some(x => normName(x) === normName(q)))
  if (full.length === 1) return { person: full[0], candidates: full, query: q }
  const first = firstName(q)
  const cands = full.length ? full : people.filter(p => p.names.some(x => firstName(x) === first) || p.emails.some(em => localPartHasName(em, q)))
  return { person: cands.length === 1 ? cands[0] : null, candidates: cands, query: q }
}

/** Gmail query for everything with this person, across their addresses. Pure. */
export function personMailQuery(p: Person, days = 90): string | null {
  const addrs = p.emails.filter(isPersonEmail)
  if (!addrs.length) return null
  return `(${addrs.map(a => `from:${a} OR to:${a}`).join(' OR ')}) newer_than:${days}d -in:spam -in:trash`
}

/** The display name to use: the longest saved name, else the address's local part. Pure. */
export const displayName = (p: Person) => [...p.names].sort((a, b) => b.length - a.length)[0] || (p.emails[0] ? p.emails[0].split('@')[0] : p.phones[0] ? `+91 ${p.phones[0]}` : 'them')

// ── gathering from the connected sources (each best-effort; a failing source never loses the others) ────────────
const nameFromHeader = (h: string) => { const m = String(h || '').match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>/); return m ? { name: m[1].trim(), email: m[2].trim() } : { name: null, email: String(h || '').trim() } }
const splitAddrs = (h: string) => String(h || '').split(/,(?![^<]*>)/).map(s => s.trim()).filter(Boolean).map(nameFromHeader)

export async function peopleDirectory(actor: AgentActor, hint?: string): Promise<Person[]> {
  const tg = actor.legacyTelegramId
  const obs: Observation[] = []
  const tasks: PromiseLike<void>[] = []
  // 1. Friend contacts (name → WhatsApp number).
  tasks.push(supabaseAdmin.from('friend_contacts').select('name,whatsapp_id').eq('owner_telegram_id', tg).limit(200).then(({ data }: any) => { for (const r of data || []) obs.push({ name: r.name, phone: r.whatsapp_id, source: 'contacts' }) }, () => {}))
  // 2. Memory lines that start with a capitalised name ("Nithin works from home on Fridays").
  tasks.push(supabaseAdmin.from('memories').select('content,created_at').eq('telegram_id', tg).order('created_at', { ascending: false }).limit(400).then(({ data }: any) => {
    for (const r of data || []) {
      const c = String(r.content || '').trim()
      const m = c.match(/^([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+){0,2})(?:'s|\s+(?:is|was|works|lives|likes|prefers|has|sits|joined|runs|owns|will|said|asked|wants|does|doesn't|can|can't|loves|hates|moved|got|needs|uses|plays|drinks|eats|cooks|travels|flies|comes|goes|birthday|anniversary|number|email|phone))\b/)
      if (m && !/^(?:My|The|This|That|Our|Your|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|June|July|August|September|October|November|December|Office|Home|Work|Gogo|Divya and|Remember|Note)\b/.test(m[1]))
        obs.push({ name: m[1], source: 'memory', note: c.slice(0, 160), at: r.created_at })
    }
  }, () => {}))
  // 3. Calendar guests, 30 days back and 30 ahead, across accounts.
  tasks.push((async () => {
    const { getAllCalendarAccountAccess, fetchMergedCalendarEventsPage } = await import('@/lib/services/google-calendar-accounts')
    const accounts = await getAllCalendarAccountAccess(tg)
    if (!accounts.length) return
    const now = Date.now()
    const page: any = await fetchMergedCalendarEventsPage(accounts, new Date(now - 30 * 86_400_000).toISOString(), new Date(now + 30 * 86_400_000).toISOString(), 'people', 120)
    for (const ev of page?.events || []) for (const a of ev?.attendees || []) if (a?.email && !a.self && !a.resource) obs.push({ name: a.displayName || null, email: a.email, source: 'calendar', at: String(ev.start?.dateTime || ev.start?.date || ev.start || '') || null })
  })().catch(() => {}))
  // 4. Gmail correspondents: recent inbox, plus a name search when a hint is given.
  tasks.push((async () => {
    const { listRecentWorkspaceInbox, searchWorkspaceEmailsByQuery } = await import('./google-workspace-read')
    const recent: any[] = await listRecentWorkspaceInbox(actor, 20).then((r: any) => Array.isArray(r) ? r : r?.messages || [], () => [])
    const named: any[] = hint && !/@/.test(hint) ? await searchWorkspaceEmailsByQuery(actor, `(from:${JSON.stringify(hint)} OR to:${JSON.stringify(hint)}) newer_than:365d -in:spam -in:trash`, 10).catch(() => []) : []
    for (const m of [...recent, ...named]) {
      for (const h of [...splitAddrs(m?.from || ''), ...splitAddrs(m?.to || '')]) if (h.email && isPersonEmail(normEmail(h.email))) obs.push({ name: h.name, email: h.email, source: 'gmail', at: m?.date ? new Date(m.date).toISOString() : null })
    }
  })().catch(() => {}))
  // 5. Google contacts, only for a named hint (People API search needs a query).
  if (hint && !/@/.test(hint)) tasks.push((async () => {
    const { searchWorkspaceContacts } = await import('./google-workspace-read')
    const res: any = await searchWorkspaceContacts(actor, hint)
    for (const c of res?.contacts || []) for (const e of c.emails || []) obs.push({ name: c.name, email: e, source: 'google_contacts' })
  })().catch(() => {}))
  await Promise.allSettled(tasks)
  return mergePeople(obs)
}

// ── "what do I know about Nithin?" ─────────────────────────────────────────────────
export const PERSON_ASK_RE = /^(?:what(?:'s| is| do i know| do you know)?\s+(?:about|pending with|open with|going on with|the latest with|happening with)|who\s+is|tell me about|catch me up on|brief me on|remind me who|when\s+(?:do|did)\s+i\s+(?:next\s+)?(?:meet|see|last meet|last see))\s+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,2}|[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,})\s*\??$/i
export function personAsk(text: string): string | null {
  const t = String(text || '').trim()
  if (t.length > 80) return null
  const m = t.match(PERSON_ASK_RE)
  if (!m) return null
  const who = m[1].trim()
  if (/^(?:me|you|us|gogo|india|bangalore|bengaluru|tomorrow|today|work|home|it|this|that|the|my|swiggy|zomato|amazon|flipkart|tipplr)$/i.test(who)) return null
  return who
}

/** The brief: identities, what memory says, next meeting, latest emails. Pure. */
export function formatPersonBrief(p: Person, extra: { nextEvent?: { summary: string; when: string } | null; emails?: { subject: string; from: string; date?: string }[] | null; openLoops?: string[] }): string {
  const name = displayName(p)
  const ids = [...p.emails.filter(isPersonEmail), ...p.phones.map(x => `+91 ${x}`)]
  const lines = [`*${name}*${ids.length ? ` · ${ids.slice(0, 3).join(' · ')}` : ''}`]
  if (p.notes.length) lines.push('', ...p.notes.slice(0, 4).map(n => `• ${n}`))
  if (extra.nextEvent) lines.push('', `Next with ${name.split(' ')[0]}: ${extra.nextEvent.summary}, ${extra.nextEvent.when}.`)
  if (extra.emails === null) lines.push('', 'Connect Gmail and I can add your latest emails with them.')
  else if (extra.emails?.length) lines.push('', '*Latest emails*', ...extra.emails.slice(0, 3).map(m => `• ${m.subject}${m.date ? ` · ${m.date}` : ''}`))
  if (extra.openLoops?.length) lines.push('', '*Open with them*', ...extra.openLoops.slice(0, 3).map(l => `• ${l}`))
  if (lines.length === 1) lines.push('', `That's all I have on ${name}: no notes, no meetings in the next month, no recent emails.`)
  return lines.join('\n')
}

export async function tryPersonAsk(actor: AgentActor, text: string): Promise<string | null> {
  const who = personAsk(text)
  if (!who) return null
  const people = await peopleDirectory(actor, who)
  const res = resolvePerson(who, people)
  if (!res.person) {
    if (res.candidates.length > 1) return `I know ${res.candidates.length} people called ${who.split(' ')[0]}: ${res.candidates.map(c => `${displayName(c)}${c.emails[0] ? ` (${c.emails[0]})` : ''}`).join(', ')}. Which one?`
    return `I don't have anything on ${who} yet: no saved note, no calendar guest, no recent email with that name. Tell me something about them ("${who} is …") and I'll remember it.`
  }
  const p = res.person
  const tz = actor.timezone || 'Asia/Kolkata'
  let nextEvent: { summary: string; when: string } | null = null, emails: any[] | null = []
  try {
    const { getAllCalendarAccountAccess, fetchMergedCalendarEventsPage } = await import('@/lib/services/google-calendar-accounts')
    const accounts = await getAllCalendarAccountAccess(actor.legacyTelegramId)
    if (accounts.length) {
      const page: any = await fetchMergedCalendarEventsPage(accounts, new Date().toISOString(), new Date(Date.now() + 30 * 86_400_000).toISOString(), 'people', 60)
      const ev = (page?.events || []).find((e: any) => (e?.attendees || []).some((a: any) => p.emails.includes(normEmail(a?.email || ''))))
      if (ev) { const start = ev.start?.dateTime || ev.start?.date; nextEvent = { summary: String(ev.summary || 'Meeting'), when: new Date(start).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: ev.start?.dateTime ? 'numeric' : undefined, minute: ev.start?.dateTime ? '2-digit' : undefined, timeZone: tz }) } }
    }
  } catch {}
  try {
    const q = personMailQuery(p)
    if (q) { const { searchWorkspaceEmailsByQuery } = await import('./google-workspace-read'); emails = await searchWorkspaceEmailsByQuery(actor, q, 3) }
  } catch (err: any) { emails = /connect|token|auth|401|403|not_connected/i.test(String(err?.message || '')) ? null : [] }
  console.log('PERSON_ASK:', JSON.stringify({ who, emails: p.emails.length, phones: p.phones.length, notes: p.notes.length, sources: p.sources }))
  return formatPersonBrief(p, { nextEvent, emails })
}

/** For meeting prep: what memory says about each guest, resolved through the directory. */
export async function guestNotes(actor: AgentActor, guests: { email: string; displayName?: string }[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!guests.length) return out
  try {
    const people = await peopleDirectory(actor)
    for (const g of guests) {
      const p = resolvePerson(g.email, people).person || (g.displayName ? resolvePerson(g.displayName, people).person : null)
      if (p?.notes.length) out.set(normEmail(g.email), p.notes.slice(0, 2))
    }
  } catch {}
  return out
}
