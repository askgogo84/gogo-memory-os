// Today feed, phase 1 (approved mockup + build docs, 5 Nov): WhatsApp stays quiet, so what Gogo notices waits here.
// Reads data AskGogo already stores; never calls Gmail (reply cards come from open loops written behind the
// consent gate). Every query is scoped to the session owner. A slow or failed source drops only its own cards.
// Card actions hand off to WhatsApp with the message typed but not sent, so nothing happens without a yes.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type TodayKind = 'watch' | 'bill' | 'flight' | 'reply' | 'food' | 'jobs'
export type TodayCard = {
  key: string; kind: TodayKind; section: 'needs' | 'noticed'
  label: string; title: string; why: string
  action: { label: string; href?: string; message?: string }
  at: string; urgency: number
}
export type TodayDone = { remindersSent: number; watchHits: number; receiptsFiled: number }
export type TodayFeed = { needs: TodayCard[]; noticed: TodayCard[]; done: TodayDone; failed: string[] }

const LABEL: Record<TodayKind, string> = { watch: 'Price watch', bill: 'Account or bill', flight: 'Flight', reply: 'Waiting on a reply', food: 'Food idea', jobs: 'Job radar' }
const WATCH_TYPES = new Set(['web_search', 'product_stock', 'web_page', 'deadline'])
const SOURCE_BUDGET_MS = 1500
// 5 Nov live: approvals, background runs and chat lines ("Waiting on my approval") showed as replies. Only email
// threads (written behind the Gmail consent gate) and follow-ups a person set are about someone replying.
export const REPLY_SOURCES = ['gmail_thread', 'followup']
export const FEWER_DAYS = 14
export const MAX_NOTICED = 5

/** The IST (or the person's) calendar day as YYYY-MM-DD, and its start as an ISO instant. */
export function localDay(now: Date, timezone = 'Asia/Kolkata') {
  let tz = timezone || 'Asia/Kolkata'
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }) } catch { tz = 'Asia/Kolkata' }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now)) % 24
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short' }).format(now)
  // Start of that local day: walk back the local hours and minutes from now.
  const minutes = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, minute: '2-digit' }).format(now))
  const start = new Date(now.getTime() - (hour * 60 + minutes) * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds())
  return { day, hour, weekday, startIso: start.toISOString() }
}

const clean = (s: unknown, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const stripPrefix = (s: string) => s.replace(/^(?:Background Gogo (?:found a high-signal web update|detected a page change|surfaced)|Product watcher triggered):\s*/i, '')
const isJobQuery = (q: string) => /\bjobs?\b|\bopenings?\b|\bhiring\b|\bvacanc/i.test(q)
const safeUrl = (u: unknown) => { const s = String(u || ''); return /^https:\/\/[^\s]+$/i.test(s) ? s : undefined }

function within<T>(p: PromiseLike<T>, ms = SOURCE_BUDGET_MS): Promise<T> {
  return new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); Promise.resolve(p).then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) }) })
}

export function buildWatchCards(events: any[], watchers: any[], since: string): TodayCard[] {
  const byId = new Map(watchers.map(w => [String(w.id), w]))
  const seen = new Set<string>()
  const out: TodayCard[] = []
  for (const e of events) {
    const m = e?.metadata_json || {}
    if (!WATCH_TYPES.has(String(m.type || '')) || String(e.created_at || '') < since) continue
    const w = byId.get(String(m.watcher_id || ''))
    const query = clean(w?.condition_json?.query || w?.condition_json?.title || '')
    const jobs = isJobQuery(query)
    const dedupe = String(m.watcher_id || e.id)
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    const title = clean(stripPrefix(String(e.message || '')) || query || 'Your watch found something', 140)
    const href = safeUrl(m.source_url || m.product_url || m.url)
    out.push({
      key: `${jobs ? 'jobs' : 'watch'}:${e.id}`, kind: jobs ? 'jobs' : 'watch', section: jobs ? 'noticed' : 'needs',
      label: jobs ? LABEL.jobs : LABEL.watch, title,
      why: jobs ? 'From your saved job search.' : m.type === 'product_stock' ? 'The item you asked Gogo to watch is in stock.' : 'One of your watches found a match.',
      action: href ? { label: jobs ? 'See the opening' : 'Open it', href } : { label: 'Ask Gogo', message: jobs ? 'Show my job radar' : `Tell me about my watch: ${title}` },
      at: String(e.created_at), urgency: jobs ? 0 : 3,
    })
  }
  return out
}

// 5 Nov live: one provider warning arrived in two threads and showed twice; same title and text = one card.
const sameNotice = (r: any) => `${clean(r.title, 240).toLowerCase()}|${clean(r.summary, 200).toLowerCase()}`
export function buildBillCards(rows: any[]): TodayCard[] {
  const seen = new Set<string>()
  return rows.filter(r => { const k = sameNotice(r); if (seen.has(k)) return false; seen.add(k); return true }).slice(0, 5).map(r => ({
    key: `bill:${r.id}`, kind: 'bill' as const, section: 'needs' as const, label: LABEL.bill,
    title: clean(r.title || 'Review this notice', 140), why: clean(r.summary, 180) || 'From an email Gogo flagged for you.',
    action: { label: 'Remind me tomorrow', message: `Remind me tomorrow at 10am about: ${clean(r.title, 100)}` },
    at: String(r.last_seen_at || r.updated_at || ''), urgency: 2,
  }))
}

export function buildFlightCards(rows: any[], now: Date): TodayCard[] {
  const out: TodayCard[] = []
  for (const r of rows) {
    const t = Date.parse(String(r.depart_at || ''))
    if (!Number.isFinite(t) || t < now.getTime() || t > now.getTime() + 36 * 3600_000) continue
    const flight = clean(r.flight_no || r.airline || 'Your flight', 40)
    const route = [clean(r.from_city, 40), clean(r.to_city, 40)].filter(Boolean).join(' to ')
    const when = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(t))
    out.push({
      key: `flight:${r.id}`, kind: 'flight', section: 'needs', label: LABEL.flight,
      title: `${flight}${route ? `, ${route}` : ''}, ${when}`, why: 'From the ticket you sent Gogo.',
      action: { label: 'Track this flight', message: `Track ${flight}` }, at: new Date(t).toISOString(), urgency: 4,
    })
  }
  return out
}

export function buildReplyCards(rows: any[]): TodayCard[] {
  return rows.slice(0, 3).map(r => ({
    key: `reply:${r.id}`, kind: 'reply' as const, section: 'noticed' as const, label: LABEL.reply,
    title: clean(r.title || 'Someone has not replied yet', 140), why: clean(r.summary, 180) || 'Gogo is keeping an eye on it.',
    action: { label: 'Draft a nudge', message: `Draft a polite follow-up for: ${clean(r.title, 100)}` },
    at: String(r.updated_at || ''), urgency: 0,
  }))
}

/** A lunch idea only on weekdays 11:00–13:59 local, from what the person told Gogo. Never infers a diet. */
export function buildFoodCard(facts: { kind: string; value: string }[] | null, local: { hour: number; weekday: string; day: string }): TodayCard[] {
  if (!facts?.length || local.hour < 11 || local.hour > 13 || /^(?:Sat|Sun)/.test(local.weekday)) return []
  const lines = facts.filter(f => f.kind !== 'likes').map(f => f.value).slice(0, 3)
  const likes = facts.filter(f => f.kind === 'likes').map(f => f.value.replace(/^Likes:\s*/i, '')).slice(0, 2)
  if (!lines.length && !likes.length) return []
  return [{
    key: `food:${local.day}`, kind: 'food', section: 'noticed', label: LABEL.food,
    title: `Lunch with what you told me${lines.length ? `: ${lines.join(' · ')}` : ''}`.slice(0, 140),
    why: likes.length ? `You like ${likes.join(' and ')}.` : 'From the food taste you told Gogo.',
    action: { label: 'Show 3 picks', message: 'Suggest 3 lunch places nearby that fit my food taste' }, at: `${local.day}T00:00:00.000Z`, urgency: 0,
  }]
}

/** Not now hides one card for that local day; Fewer like this hides a kind for FEWER_DAYS. */
export function applyCardState(cards: TodayCard[], events: any[], day: string, now: Date) {
  const hidden = new Set<string>(), fewer = new Set<string>()
  const cutoff = new Date(now.getTime() - FEWER_DAYS * 86_400_000).toISOString()
  for (const e of events) {
    const m = e?.metadata_json || {}
    if (e.event_type === 'today_card_hidden' && m.day === day && typeof m.card === 'string') hidden.add(m.card)
    if (e.event_type === 'today_kind_fewer' && typeof m.kind === 'string' && String(e.created_at || '') >= cutoff) fewer.add(m.kind)
  }
  return cards.filter(c => !hidden.has(c.key) && !(c.section === 'noticed' && fewer.has(c.kind)))
}

export function rankCards(cards: TodayCard[]) {
  const needs = cards.filter(c => c.section === 'needs').sort((a, b) => b.urgency - a.urgency || a.at.localeCompare(b.at))
  const noticed = cards.filter(c => c.section === 'noticed').sort((a, b) => b.at.localeCompare(a.at)).slice(0, MAX_NOTICED)
  return { needs, noticed }
}

export async function getTodayFeed(telegramId: string | number, now = new Date(), timezone = 'Asia/Kolkata', db: any = supabaseAdmin): Promise<TodayFeed> {
  const tg = String(telegramId ?? '').trim()
  if (!tg) throw new Error('today_feed_owner_required')
  const local = localDay(now, timezone)
  const since24 = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const since7d = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const fewerSince = new Date(now.getTime() - FEWER_DAYS * 86_400_000).toISOString()
  const failed: string[] = []
  const run = async <T>(name: string, fn: () => PromiseLike<T>, empty: T): Promise<T> => {
    try { return await within(fn()) } catch { failed.push(name); return empty }
  }
  const rows = async (q: PromiseLike<any>) => { const { data, error } = await q; if (error) throw new Error('read_failed'); return data || [] }

  const [activity, watchers, bills, replies, flights, taste, state, remindersSent, receipts] = await Promise.all([
    run('watches', () => rows(db.from('agent_activity').select('id,message,metadata_json,created_at').eq('telegram_id', tg).eq('event_type', 'watcher_triggered').gte('created_at', since24).order('created_at', { ascending: false }).limit(40)), [] as any[]),
    run('watchers', () => rows(db.from('agent_watchers').select('id,condition_json').eq('telegram_id', tg).limit(200)), [] as any[]),
    run('bills', () => rows(db.from('agent_open_loops').select('id,title,summary,last_seen_at,updated_at').eq('telegram_id', tg).eq('status', 'active').eq('kind', 'commitment').eq('source_type', 'gmail_service_notice').gte('updated_at', since7d).order('updated_at', { ascending: false }).limit(5)), [] as any[]),
    run('replies', () => rows(db.from('agent_open_loops').select('id,title,summary,updated_at').eq('telegram_id', tg).eq('status', 'active').in('kind', ['followup', 'waiting_on']).in('source_type', REPLY_SOURCES).order('updated_at', { ascending: false }).limit(3)), [] as any[]),
    // travel_tickets keeps the owner as a number in this codebase's writers; the session id is a decimal string,
    // and PostgREST compares it as text against the column, so no JS Number conversion is needed here.
    run('flights', () => rows(db.from('travel_tickets').select('id,flight_no,airline,from_city,to_city,depart_at').eq('telegram_id', tg).eq('type', 'flight').gte('depart_at', now.toISOString()).order('depart_at', { ascending: true }).limit(5)), [] as any[]),
    run('food', () => rows(db.from('taste_facts').select('kind,value').eq('telegram_id', tg).eq('domain', 'food').is('forgotten_at', null).limit(20)), [] as any[]),
    run('state', () => rows(db.from('agent_activity').select('event_type,metadata_json,created_at').eq('telegram_id', tg).in('event_type', ['today_card_hidden', 'today_kind_fewer']).gte('created_at', fewerSince).limit(200)), [] as any[]),
    run('done', async () => { const { count, error } = await db.from('reminders').select('id', { count: 'exact', head: true }).eq('telegram_id', tg).eq('sent', true).gte('sent_at', local.startIso); if (error) throw new Error('read_failed'); return count || 0 }, 0),
    run('done', async () => { const { count, error } = await db.from('documents').select('id', { count: 'exact', head: true }).eq('telegram_id', tg).eq('doc_type', 'receipt').gte('created_at', local.startIso); if (error) throw new Error('read_failed'); return count || 0 }, 0),
  ])

  const cards = [
    ...buildWatchCards(activity, watchers, since24),
    ...buildBillCards(bills),
    ...buildFlightCards(flights, now),
    ...buildReplyCards(replies),
    ...buildFoodCard(taste, local),
  ]
  const { needs, noticed } = rankCards(applyCardState(cards, state, local.day, now))
  const watchHits = activity.filter((e: any) => WATCH_TYPES.has(String(e?.metadata_json?.type || '')) && String(e.created_at || '') >= local.startIso).length
  return { needs, noticed, done: { remindersSent, watchHits, receiptsFiled: receipts }, failed: [...new Set(failed)] }
}

export const CARD_KEY_RE = /^(?:watch|bill|flight|reply|food|jobs):[A-Za-z0-9._-]{1,80}$/
export const KINDS: TodayKind[] = ['watch', 'bill', 'flight', 'reply', 'food', 'jobs']
