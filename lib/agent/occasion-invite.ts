// Occasion invites (approved canvas screen 4, 5 Nov): after a group table booking, ask the occasion, ask who and
// which age / year, then draw an invite card the person forwards themselves, with their AskGogo invite link.
// Gogo never messages anyone else. Names come only from what the person typed. State lives in owner-scoped
// agent_activity rows; the card itself is a signed, self-contained link (no table needed).
import { supabaseAdmin } from '@/lib/supabase-admin'

export type Booking = { venue: string; guests: number; dateIso: string; time: string; link: string | null }
export type Occasion = 'birthday' | 'anniversary' | 'dinner'
export type CardSpec = { kind: Occasion; style: number; title: string; kicker: string; note: string; venue: string; when: string; party: string }
type State = { step: 'occasion' | 'details' | 'card'; booking: Booking; kind?: Occasion; who?: string; number?: number | null; style?: number }

const EVENT = 'occasion_invite'
const OPEN_DAYS = 7
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const clean = (s: unknown, n = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** A forwarded reservation confirmation (ReserveGo, Dineout, EazyDiner, District style). Pure. */
export function parseReservationConfirmation(text: string, now = new Date()): Booking | null {
  const t = clean(text, 1200)
  if (!/\b(?:confirmed|confirmation|booked|reserved)\b/i.test(t) || !/\b(?:reservation|table|booking)\b/i.test(t)) return null
  // Hotels, flights, trains and shows are bookings too, but not a table for a group meal.
  if (/\b(?:hotel|check-?in|check-?out|room|nights?|stay|flight|pnr|train|coach|seat|screen|movie|show)\b/i.test(t)) return null
  const venue = t.match(/\b(?:reservation|table|booking)\s+(?:at|@)\s+(.{2,80}?)\s+(?:for|on|is|has)\b/i)?.[1]
  const guests = Number(t.match(/\bfor\s+(\d{1,2})\s+(?:guests?|people|persons?|pax|adults?)\b/i)?.[1] || t.match(/\b(\d{1,2})\s+(?:guests?|pax|people)\b/i)?.[1] || 0)
  const d = t.match(/\b(\d{1,2})[-\s/](jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[-\s/,]*(\d{4})?\b/i)
  const time = t.match(/\b(\d{1,2})[:.](\d{2})\s*([ap])\.?m\.?\b/i)
  if (!venue || !guests || !d || !time) return null
  const year = d[3] ? Number(d[3]) : now.getUTCFullYear()
  const month = MONTHS[d[2].toLowerCase().slice(0, 4).replace(/t$/, '')] || MONTHS[d[2].toLowerCase().slice(0, 3)]
  const day = Number(d[1])
  if (!month || day < 1 || day > 31) return null
  const h = Number(time[1]) % 12 + (/p/i.test(time[3]) ? 12 : 0)
  const link = t.match(/\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s]+)/i)?.[1] || null
  return {
    venue: clean(venue, 80), guests, dateIso: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: `${h % 12 || 12}:${time[2]} ${h >= 12 ? 'pm' : 'am'}`, link: link ? (/^https?:/i.test(link) ? link : `https://${link}`) : null,
  }
}

export function whenLabel(b: Pick<Booking, 'dateIso' | 'time'>, long = false) {
  const [y, m, d] = b.dateIso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d, 12))
  const fmt = new Intl.DateTimeFormat('en-IN', { weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short', ...(long ? { year: 'numeric' } : {}), timeZone: 'UTC' })
  return `${fmt.format(date)} · ${b.time}`
}

/** "Divya, turning 30" · "for Nithin 40" · "Divya and Nithin, 5th" · "our 15th". Pure. */
export function parseOccasionDetails(text: string): { who: string | null; number: number | null } {
  const t = clean(text, 120)
  const number = Number(t.match(/\b(\d{1,3})(?:st|nd|rd|th)?\b/)?.[1] || NaN)
  let who = t.replace(/\b\d{1,3}(?:st|nd|rd|th)?\b/g, ' ')
    .replace(/\b(?:it'?s|its|for|turning|turns|is|will be|years?|yrs?|old|anniversary|birthday|wedding|our|my|the|of|age|aged)\b/gi, ' ')
    .replace(/[,.!]+/g, ' ').replace(/\s+/g, ' ').trim()
  who = who.replace(/\s*&\s*/g, ' and ').replace(/^and\s+|\s+and$/gi, '').trim()
  return { who: who && /[A-Za-z]{2}/.test(who) && who.split(' ').length <= 7 ? who.replace(/\b\w/g, c => c.toUpperCase()).replace(/\bAnd\b/g, 'and') : null, number: Number.isFinite(number) && number > 0 && number < 130 ? number : null }
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
const NOTES: Record<Occasion, [string, string][]> = {
  birthday: [['You are invited', 'Cake on us. Come hungry.'], ['Birthday dinner', 'Dress up a little.']],
  anniversary: [['Celebrating', 'Join us for dinner and a toast.'], ['Together', 'An evening with our favourite people.']],
  dinner: [['Dinner plan', 'See you there.'], ['Table booked', 'See you there.']],
}

export function cardSpec(s: State): CardSpec {
  const kind = s.kind || 'dinner', style = (s.style || 0) % 2
  const [kicker0, note] = NOTES[kind][style]
  const n = s.number || null
  const title = kind === 'birthday' ? (s.who ? `${s.who}${n ? ` turns ${n}` : `'s birthday`}` : 'Birthday dinner')
    : kind === 'anniversary' ? (s.who || 'Our anniversary') : 'Dinner with friends'
  const kicker = kind === 'anniversary' && n ? (style === 0 ? `Celebrating ${n} years` : `${n} years together`) : kicker0
  return { kind, style, title, kicker, note, venue: s.booking.venue, when: whenLabel(s.booking, true), party: `Table for ${s.booking.guests}` }
}

// ── signed, self-contained card link ─────────────────────────────────────────────
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export async function cardDigest(data: string) {
  const buf = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))
  let s = ''; for (const b of buf.slice(0, 12)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export async function cardUrl(spec: CardSpec, owner: string): Promise<string | null> {
  const { signCardToken } = await import('@/lib/security/card-link')
  const d = b64url(JSON.stringify(spec))
  const token = await signCardToken(`invite-${await cardDigest(d)}`, owner)
  if (!token) return null
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in').replace(/\/$/, '')
  return `${base}/api/invite-card?o=${encodeURIComponent(owner)}&d=${d}&t=${encodeURIComponent(token)}`
}

// ── state ────────────────────────────────────────────────────────────────────────
async function save(tg: string, state: State | null, message: string) {
  await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: EVENT, message, metadata_json: state ? { ...state, open: true } : { open: false } })
}
async function current(tg: string): Promise<(State & { at: number }) | null> {
  const since = new Date(Date.now() - OPEN_DAYS * 86_400_000).toISOString()
  const { data } = await supabaseAdmin.from('agent_activity').select('metadata_json,created_at').eq('telegram_id', tg).eq('event_type', EVENT)
    .gte('created_at', since).order('created_at', { ascending: false }).limit(1)
  const m: any = data?.[0]?.metadata_json
  return m?.open && m.booking?.venue ? { ...(m as State), at: Date.parse(String(data?.[0]?.created_at || '')) || 0 } : null
}

const OCCASION_RE = { birthday: /\b(?:birthday|b'?day|bday)\b/i, anniversary: /\b(?:anniversary|anniv)\b/i, dinner: /\b(?:just dinner|dinner|no occasion|nothing special|just (?:a )?meal|catch ?up)\b/i }
const NOT_NOW = /^\s*(?:not now|no|nope|skip|later|no thanks)[\s.!]*$/i
const MAKE_INVITE = /\b(?:make|create|design|send)\s+(?:an?\s+|the\s+)?(?:invite|invitation|invite card)\b|\bshare the plan\b/i
const ANOTHER = /^\s*(?:try\s+)?(?:another|different|new|change(?:\s+the)?)\s+(?:style|design|look|colou?r)[\s.!]*$/i
const SEND = /^\s*(?:send(?: it)?(?: to (?:my )?friends)?|share(?: it)?|looks good|perfect|done)[\s.!]*$/i
const ASK_OCCASION = `Is it for an occasion? I'll make an invite you can send to the others.\n\nReply *birthday*, *anniversary*, *just dinner* or *not now*.`

export type InviteReply = { text: string; mediaUrl?: string | null }

async function showCard(tg: string, state: State, name?: string | null): Promise<InviteReply> {
  const spec = cardSpec(state)
  const url = await cardUrl(spec, tg).catch(() => null)
  await save(tg, { ...state, step: 'card' }, `Invite card made: ${spec.title}`)
  const caption = `Here's your invite: *${spec.title}*\n${spec.venue} · ${whenLabel(state.booking)}\n\nReply *send* to share it with your friends, or *another style* for a different look.`
  return url ? { text: caption, mediaUrl: url } : { text: `${caption}\n\n(I couldn't draw the card image just now; the details above are ready to share.)` }
}

async function shareReply(tg: string, state: State, name?: string | null): Promise<InviteReply> {
  const spec = cardSpec(state)
  const url = await cardUrl(spec, tg).catch(() => null)
  let invite = ''
  const id = Number(tg)
  if (Number.isSafeInteger(id)) {
    const store: any = await import('@/lib/invites/store').catch(() => null)
    const core: any = await import('@/lib/invites/core').catch(() => null)
    const got = await store?.getOrCreateInviteCode?.(id, name).catch(() => null)
    if (got?.code && got.remaining > 0 && core?.inviteUrl) invite = `\n\nPlanned with AskGogo, it books tables and reminds you on WhatsApp. Try it free: ${core.inviteUrl(got.code)}`
  }
  const map = `https://maps.google.com/?q=${encodeURIComponent(`${state.booking.venue} Bengaluru`)}`
  const note = `${spec.kicker}: ${spec.title}\n${spec.venue}\n${whenLabel(state.booking, true)} · ${spec.party}\nMap: ${map}${url ? `\nInvite: ${url}` : ''}${invite}`
  // A share link with no number opens WhatsApp's contact picker; the person chooses who gets it.
  const share = `https://wa.me/?text=${encodeURIComponent(note)}`
  await save(tg, null, 'Invite shared.')
  return { text: `Forward the card above to your group, or tap this to pick friends with the message ready (you press send):\n${share}\n\nI never message your friends myself.` }
}

/** One entry point. Returns a reply, or null when the message isn't part of an invite. */
export async function tryOccasionInvite(p: { telegramId: string | number; text: string; name?: string | null }): Promise<InviteReply | null> {
  const tg = String(p.telegramId), text = String(p.text || '').trim()
  if (!text) return null
  const booking = parseReservationConfirmation(text)
  if (booking) {
    const confirm = `✅ Table confirmed at *${booking.venue}*\n${booking.guests} guest${booking.guests === 1 ? '' : 's'} · ${whenLabel(booking)}`
    if (booking.guests < 2) return { text: confirm }
    await save(tg, { step: 'occasion', booking }, `Booking at ${booking.venue}; asked the occasion.`)
    return { text: `${confirm}\n\n${ASK_OCCASION}` }
  }
  const state = await current(tg).catch(() => null)
  if (!state) return MAKE_INVITE.test(text) ? { text: "Forward me the table booking confirmation first (the SMS or WhatsApp from the restaurant or booking app), and I'll make the invite from it." } : null
  if (MAKE_INVITE.test(text)) { await save(tg, { ...state, step: 'occasion' }, 'Asked the occasion again.'); return { text: ASK_OCCASION } }

  // Open questions expire, so a later unrelated message is never read as an answer.
  const age = Date.now() - state.at
  if (state.step === 'occasion' && age > 86_400_000) return null
  if (state.step === 'details' && (age > 7_200_000 || /\?|^\s*(?:what|how|why|when|where|who|which|show|find|book|remind|plan|my|is|are|can|do|does)\b/i.test(text))) return null
  if (state.step === 'occasion') {
    if (NOT_NOW.test(text)) { await save(tg, null, 'Invite skipped.'); return { text: 'No problem. Say *make an invite* any time before the day.' } }
    const kind = (Object.keys(OCCASION_RE) as Occasion[]).find(k => OCCASION_RE[k].test(text))
    if (!kind) return null
    if (kind === 'dinner') return showCard(tg, { ...state, kind, style: 0 }, p.name)
    const inline = parseOccasionDetails(text)
    if (inline.who && (kind === 'anniversary' || inline.number)) return showCard(tg, { ...state, kind, who: inline.who, number: inline.number, style: 0 }, p.name)
    await save(tg, { ...state, step: 'details', kind }, `Asked ${kind} details.`)
    return { text: kind === 'birthday' ? 'Lovely. Whose birthday is it, and how old are they turning?' : 'Congratulations! Whose anniversary is it (the names), and which one?' }
  }
  if (state.step === 'details') {
    if (NOT_NOW.test(text)) { await save(tg, null, 'Invite skipped.'); return { text: 'No problem. Say *make an invite* any time before the day.' } }
    const d = parseOccasionDetails(text)
    if (!d.who) return { text: state.kind === 'birthday' ? 'Whose birthday is it? Reply like "Divya, turning 30".' : 'Whose anniversary is it? Reply like "Divya and Nithin, 5th".' }
    return showCard(tg, { ...state, who: d.who, number: d.number, style: 0 }, p.name)
  }
  // "send" / "another style" only mean the card for a day after it was shown, so ordinary chat isn't caught later.
  if (state.step === 'card' && Date.now() - state.at <= 86_400_000) {
    if (ANOTHER.test(text)) return showCard(tg, { ...state, style: (state.style || 0) + 1 }, p.name)
    if (SEND.test(text)) return shareReply(tg, state, p.name)
    if (NOT_NOW.test(text)) { await save(tg, null, 'Invite closed.'); return { text: 'Okay. The card stays above if you want it later.' } }
  }
  return null
}

export const INVITE_GATE = /\b(?:reservation|table|booking|confirmed|invite|invitation|birthday|b'?day|anniversary|dinner|occasion|style|design|send|share|not now|skip|later|turning|turns)\b|^\s*[A-Za-z][A-Za-z .&'-]{1,60},?\s*\d{0,3}(?:st|nd|rd|th)?\s*$/i
