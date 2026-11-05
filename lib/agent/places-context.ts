// Places with what Gogo knows (5 Nov live): "nearby" uses the home area the person saved, and food results say
// which stated taste was kept in mind. Owner-scoped reads; the id stays a string. Read-only.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { answerPlaces, homeAreaFrom, nearbyRewrite } from './places-search'
import { listTaste } from './taste'

const FOOD = /\b(?:restaurants?|caf(?:e|é)s?|coffee|bars?|pubs?|bakery|bakeries|places? to eat|dhabas?|darshinis?|biryani|dosa|pizza|burgers?|ice ?cream|desserts?|lunch|dinner|breakfast)\b/i

// 5 Nov (owner): know home and office once, never ask again. One line each in the person's memories, replaced
// when it changes: "Home area: Rajajinagar (560086)". Free-text "I live in …" memories still count as a fallback.
export type SavedPlace = { kind: 'home' | 'office'; area: string | null; pincode: string | null }
const PIN = /\b(5\d{5}|[1-46-9]\d{5})\b/
const NOT_AREA = /^(?:home|office|work|here|there|ok(?:ay)?|yes|yeah|no|nope|thanks?|thank you|hi|hello|hey|sure|fine|cool|great|done|later|stop|cancel|help|menu)$/i
export function placeLine(p: SavedPlace) { return `${p.kind === 'home' ? 'Home' : 'Office'} area: ${[p.area, p.pincode ? (p.area ? `(${p.pincode})` : p.pincode) : null].filter(Boolean).join(' ')}` }
export function parsePlaceLine(content: string): SavedPlace | null {
  const m = String(content || '').match(/^(Home|Office) area:\s*(.+)$/i)
  if (!m) return null
  const pin = m[2].match(PIN)?.[1] || null
  const area = m[2].replace(/\(?\b\d{6}\b\)?/, '').trim() || null
  return { kind: m[1].toLowerCase() === 'home' ? 'home' : 'office', area, pincode: pin }
}
/** "I live in Rajajinagar", "home is 560086", "my office is in Whitefield", "office: MG Road 560001". Pure. */
export function detectPlaceStatement(text: string): SavedPlace | null {
  const t = String(text || '').trim().replace(/[.!]+$/, '').replace(/^(?:please\s+)?(?:remember|note|save)(?:\s+that)?\s+/i, '')
  if (!t || t.length > 120 || /\?$/.test(t)) return null
  const m = t.match(/^(?:i\s+(?:live|stay)\s+(?:in|at|near|around)|we\s+(?:live|stay)\s+(?:in|at|near|around)|my\s+(home|house|office|work(?:place)?)\s+(?:is\s+(?:in|at|near|around)|(?:address|area|pincode|pin(?:\s*code)?)\s+is)|(home|office|work)\s*(?:(?:area|address|pincode|pin(?:\s*code)?)\s*(?:is|:|-)?|:))\s*(.+)$/i)
  if (!m) return null
  const word = (m[1] || m[2] || 'home').toLowerCase()
  const kind: SavedPlace['kind'] = /office|work/.test(word) ? 'office' : 'home'
  const rest = m[3].trim()
  const pincode = rest.match(PIN)?.[1] || null
  const area = rest.replace(PIN, '').replace(/\b(?:bengaluru|bangalore|karnataka|india)\b/ig, '').replace(/[,\s]+$/, '').replace(/^[,\s-]+/, '').split(',').map(x => x.trim()).filter(Boolean).slice(-1)[0] || null
  if (!pincode && (!area || area.split(' ').length > 5 || /^(?:a|an|the|my|our)\b/i.test(area) || NOT_AREA.test(area))) return null
  return { kind, area, pincode }
}
/** A bare answer to "What's your home area or pincode?": "Rajajinagar", "560086", "Rajajinagar 560086". Pure. */
export function placeAnswer(text: string): SavedPlace | null {
  const t = String(text || '').trim().replace(/[.!]+$/, '')
  if (!t || t.length > 60 || NOT_AREA.test(t)) return null
  // A command is never an area, even right after the question.
  if (/^(?:call|remind|set|show|find|what|when|where|who|why|how|tell|send|add|book|order|buy|search|check|cancel|stop|play|open|get|make|create|delete|forget|list|track|watch|scan|plan|compare|my|the|a|an|i|is|are|do|can|please|any|weather|gold|price|usage|briefing|help)\b/i.test(t)) return null
  // 5 Nov live: "my briefing", sent right after the office question, was saved as the office. An answer is an area
  // name (or pincode), so app words anywhere in it rule it out.
  if (/\b(?:briefing|reminders?|usage|calendar|emails?|jobs?|prices?|weather|pending|today|tomorrow|tonight|plan|notes?|expenses?|spend|spent|food|taste|order|status)\b/i.test(t)) return null
  const stated = detectPlaceStatement(t)
  if (stated) return stated
  const pincode = t.match(PIN)?.[1] || null
  const area = t.replace(PIN, '').replace(/\b(?:bengaluru|bangalore)\b/ig, '').replace(/[,\s]+/g, ' ').trim() || null
  if (area && (!/^[A-Za-z][A-Za-z .'-]{2,40}$/.test(area) || area.split(' ').length > 4)) return null
  return pincode || area ? { kind: 'home', area, pincode } : null
}

async function savedPlaces(telegramId: string) {
  const { data, error } = await supabaseAdmin.from('memories').select('content').eq('telegram_id', telegramId)
    .or('content.ilike.Home area:%,content.ilike.Office area:%,content.ilike.%live in%,content.ilike.%live at%,content.ilike.%stay in%,content.ilike.%based in%,content.ilike.%home is%')
    .order('created_at', { ascending: false }).limit(30)
  if (error) return { home: null as SavedPlace | null, office: null as SavedPlace | null }
  const rows = (data || []).map((r: any) => String(r.content || ''))
  const lines = rows.map(parsePlaceLine).filter(Boolean) as SavedPlace[]
  const free = homeAreaFrom(rows)
  return { home: lines.find(l => l.kind === 'home') || (free ? { kind: 'home' as const, area: free, pincode: null } : null), office: lines.find(l => l.kind === 'office') || null }
}

export async function savePlace(telegramId: string | number, p: SavedPlace) {
  const tg = String(telegramId)
  const { data, error } = await supabaseAdmin.from('memories').insert({ telegram_id: tg, content: placeLine(p) }).select('id').single()
  if (error || !data?.id) return false
  const { data: older } = await supabaseAdmin.from('memories').select('id,content').eq('telegram_id', tg).ilike('content', `${p.kind === 'home' ? 'Home' : 'Office'} area:%`).neq('id', data.id)
  const stale = (older || []).map((r: any) => r.id)
  if (stale.length) await supabaseAdmin.from('memories').delete().in('id', stale).eq('telegram_id', tg)
  return true
}

const where = (p: SavedPlace) => p.area || p.pincode || ''
const ASK = `What's your home area or pincode? Reply like "Rajajinagar 560086". I'll save it once and use it every time you ask for something nearby.`
const PENDING_MINUTES = 15

async function setPending(tg: string, text: string, kind: SavedPlace['kind'], onboarding = false) {
  await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'nearby_area_asked', message: onboarding ? `Onboarding: asked for ${kind} area.` : 'Asked for home area once.', metadata_json: { text: text.slice(0, 200), kind, onboarding } })
}
type Pending = { text: string; kind: SavedPlace['kind']; onboarding: boolean; at: number }
async function pendingAsk(tg: string, minutes = PENDING_MINUTES): Promise<Pending | null> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  const { data } = await supabaseAdmin.from('agent_activity').select('event_type,metadata_json,created_at').eq('telegram_id', tg)
    .in('event_type', ['nearby_area_asked', 'nearby_area_saved']).gte('created_at', since).order('created_at', { ascending: false }).limit(1)
  const row: any = data?.[0]
  if (row?.event_type !== 'nearby_area_asked') return null
  const m = row.metadata_json || {}
  const onboarding = m.onboarding === true
  if (!onboarding && !m.text) return null
  return { text: String(m.text || ''), kind: m.kind === 'office' ? 'office' : 'home', onboarding, at: Date.parse(String(row.created_at || '')) || 0 }
}
/** Onboarding questions stay open a day; a "nearby" question only PENDING_MINUTES. */
async function openQuestion(tg: string): Promise<Pending | null> {
  const p = await pendingAsk(tg, ONBOARD_MINUTES).catch(() => null)
  if (!p) return null
  return p.onboarding || Date.now() - p.at <= PENDING_MINUTES * 60_000 ? p : null
}

// Onboarding (approved screen 3, 5 Nov): after the welcome, ask home, then office, once. Either can be skipped.
export const ONBOARD_HOME_Q = `Two quick things so I never have to ask later.\n\n*1 of 2 · Where's home?*\nJust the area or pincode, like "Rajajinagar 560086". I use it for nearby places, deliveries and price checks. Say *later* to skip.`
export const ONBOARD_OFFICE_Q = `*2 of 2 · And work?*\nOffice area or pincode, so "near the office" works. Say *I work from home* to skip.`
const ONBOARD_MINUTES = 24 * 60
const SKIP = /^\s*(?:later|skip|not now|no|nope|none|no office|i work from home|work from home|wfh|i don'?t have an office)[\s.!]*$/i
export function isPlaceSkip(text: string) { return SKIP.test(String(text || '')) }

/** Ask the home question once for a new person (nothing saved yet). Returns the question to send, or null. */
export async function startPlaceOnboarding(telegramId: string | number): Promise<string | null> {
  const tg = String(telegramId)
  const places = await savedPlaces(tg).catch(() => ({ home: null, office: null }))
  if (places.home) return null
  await setPending(tg, '', 'home', true)
  return ONBOARD_HOME_Q
}

function onboardingDone(places: { home: SavedPlace | null; office: SavedPlace | null }) {
  const bits = [places.home ? `Home: ${where(places.home)}` : null, places.office ? `Office: ${where(places.office)}` : null].filter(Boolean)
  return `Saved. ${bits.length ? bits.join(' · ') + '. ' : ''}I won't ask again.\n\nTry "pizza nearby" or "remind me to call Nithin at 5". Change these any time by saying "I moved to HSR Layout".`
}

/** Home/office statements, the one-time answer to the area question (which then runs the original search),
 *  and the two onboarding answers. */
export async function tryPlaceCommand(p: { telegramId: string | number; text: string }, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const tg = String(p.telegramId)
  const stated = detectPlaceStatement(p.text)
  const skip = !stated && isPlaceSkip(p.text)
  const asked = (stated || skip || placeAnswer(p.text)) ? await openQuestion(tg) : null
  // A statement ("I live in X") only continues onboarding; it never answers a nearby question's search.
  const live = stated ? (asked?.onboarding ? asked : null) : asked
  if (skip) {
    if (!live?.onboarding) return null
    if (live.kind === 'home') { await setPending(tg, '', 'office', true).catch(() => {}); return `No problem, I'll ask the first time you need it.\n\n${ONBOARD_OFFICE_Q}` }
    await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'nearby_area_saved', message: 'Onboarding finished.', metadata_json: { kind: 'office', skipped: true } }).then(() => {}, () => {})
    return onboardingDone(await savedPlaces(tg).catch(() => ({ home: null, office: null })))
  }
  const place = stated || (live ? { ...placeAnswer(p.text)!, kind: live.kind } : null)
  if (!place) return null
  if (!(await savePlace(tg, place).catch(() => false))) return null
  await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'nearby_area_saved', message: `${place.kind} area saved.`, metadata_json: { kind: place.kind } }).then(() => {}, () => {})
  if (live?.onboarding) {
    if (place.kind === 'home') { await setPending(tg, '', 'office', true).catch(() => {}); return `Saved your home: ${where(place)}.\n\n${ONBOARD_OFFICE_Q}` }
    return onboardingDone(await savedPlaces(tg).catch(() => ({ home: null, office: null })))
  }
  const saved = `Saved your ${place.kind}: ${where(place)}. I'll use it whenever you ask for something ${place.kind === 'home' ? 'nearby' : 'near the office'}, and won't ask again. Say "I live in <area>" any time to change it.`
  if (!live?.text) return saved
  const out = await answerPlacesWithContext({ text: live.text, telegramId: tg }, fetchImpl).catch(() => null)
  return out ? `${saved}\n\n${out}` : saved
}

const NEAR_OFFICE = /\b(?:near|around|close\s+to)\s+(?:my\s+|the\s+)?(?:office|work(?:place)?)\b/i

const weekdayIst = (now = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(now)
/** "restaurants in Indiranagar" → "pure veg restaurants in Indiranagar" when the person said they're veg (today). Pure.
 *  An explicit dish or cuisine in the ask ("seafood", "biryani", "non-veg") is left alone. */
export function withStatedDiet(text: string, facts: { kind: string; value: string; context?: string | null }[], weekday: string) {
  if (/\b(?:veg|vegetarian|vegan|jain|non[\s-]?veg|chicken|mutton|fish|seafood|prawns?|egg|biryani|kebab|meat|steak|bbq|barbecue|sushi)\b/i.test(text)) return text
  const diet = facts.find(f => f.kind === 'diet_stated' && (!f.context || weekday.toLowerCase().startsWith(String(f.context).toLowerCase().replace(/s$/, ''))))
  if (!diet) return text
  const word = /^vegan/i.test(diet.value) ? 'vegan' : /^jain/i.test(diet.value) ? 'jain' : /^(?:veg|eggetarian)/i.test(diet.value) ? 'pure veg' : null
  if (!word) return text
  return text.replace(/\b(restaurants?|places? to eat|caf(?:e|é)s?|dhabas?|lunch|dinner|breakfast|food)\b/i, m => `${word} ${m}`)
}

export function tasteNote(values: string[]) {
  const keep = values.filter(v => !/^Likes:/i.test(v)).slice(0, 4)
  return keep.length ? `\n\nKept in mind: ${keep.join(' · ')}. Check the menu before ordering.` : ''
}

export async function answerPlacesWithContext(p: { text: string; telegramId: string | number }, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const tg = String(p.telegramId)
  let text = p.text
  const office = NEAR_OFFICE.test(text)
  const asOffice = office ? text.replace(NEAR_OFFICE, 'nearby') : text
  if (nearbyRewrite(asOffice, null)) {
    const places = await savedPlaces(tg).catch(() => ({ home: null, office: null }))
    const spot = office ? places.office : places.home
    const rewritten = nearbyRewrite(asOffice, spot ? where(spot) : null)
    if (!rewritten || 'needArea' in rewritten) {
      await setPending(tg, text, office ? 'office' : 'home').catch(() => {})
      return office ? ASK.replace("What's your home area", "What's your office area").replace('something nearby', 'something near the office') : ASK
    }
    text = rewritten.text
  }
  const food = FOOD.test(text)
  const facts = food ? await listTaste(tg).catch(() => null) : null
  // 5 Nov live: "Kept in mind: Veg" sat under a seafood restaurant. A stated diet steers the search itself.
  text = withStatedDiet(text, facts || [], weekdayIst())
  const out = await answerPlaces(text, fetchImpl)
  if (!out || !food || !out.startsWith('📍')) return out
  return facts?.length ? out.replace(/(\n\nAsk "which of these is open late\?"[^\n]*)?$/, m => tasteNote(facts.map(f => f.value)) + m) : out
}
