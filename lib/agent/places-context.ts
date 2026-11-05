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
  if (/^(?:call|remind|set|show|find|what|when|where|who|why|how|tell|send|add|book|order|buy|search|check|cancel|stop|play|open|get|make|create|delete|forget|list|track|watch|scan)\b/i.test(t)) return null
  const stated = detectPlaceStatement(t)
  if (stated) return stated
  const pincode = t.match(PIN)?.[1] || null
  const area = t.replace(PIN, '').replace(/\b(?:bengaluru|bangalore)\b/ig, '').replace(/[,\s]+/g, ' ').trim() || null
  if (area && (!/^[A-Za-z][A-Za-z .'-]{2,40}$/.test(area) || area.split(' ').length > 4)) return null
  return pincode || area ? { kind: 'home', area, pincode } : null
}

/** Never turn a rounded JavaScript number into somebody else's BIGINT owner key. */
function exactPlaceOwnerId(value: string | number): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const id = String(value).trim()
  return /^-?[1-9]\d*$/.test(id) ? id : null
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
  const tg = exactPlaceOwnerId(telegramId)
  if (!tg) return false
  const prefix = p.kind === 'home' ? 'Home area:%' : 'Office area:%'
  const { data, error } = await supabaseAdmin.from('memories').insert({ telegram_id: tg, content: placeLine(p) }).select('id').single()
  if (error || data?.id == null) return false

  // The old address is personal information. A successful insert alone is NOT
  // proof that superseded addresses were removed. Keep the deletion owner-bound.
  const { error: deleteError } = await supabaseAdmin.from('memories').delete()
    .eq('telegram_id', tg).ilike('content', prefix).neq('id', data.id)
  if (deleteError) return false

  // PostgREST can acknowledge a query even when policies suppress its effects.
  // Verify one exact current row before saying the replacement succeeded.
  const { data: remaining, error: verifyError } = await supabaseAdmin.from('memories').select('id')
    .eq('telegram_id', tg).ilike('content', prefix).limit(2)
  return !verifyError && Array.isArray(remaining) && remaining.length === 1
    && String(remaining[0].id) === String(data.id)
}

const where = (p: SavedPlace) => p.area || p.pincode || ''
const ASK = `What's your home area or pincode? Reply like "Rajajinagar 560086". I'll save it once and use it every time you ask for something nearby.`
const PENDING_MINUTES = 15

async function setPending(tg: string, text: string, kind: SavedPlace['kind']) {
  await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'nearby_area_asked', message: 'Asked for home area once.', metadata_json: { text: text.slice(0, 200), kind } })
}
async function pendingAsk(tg: string): Promise<{ text: string; kind: SavedPlace['kind'] } | null> {
  const since = new Date(Date.now() - PENDING_MINUTES * 60_000).toISOString()
  const { data } = await supabaseAdmin.from('agent_activity').select('event_type,metadata_json,created_at').eq('telegram_id', tg)
    .in('event_type', ['nearby_area_asked', 'nearby_area_saved']).gte('created_at', since).order('created_at', { ascending: false }).limit(1)
  const row: any = data?.[0]
  return row?.event_type === 'nearby_area_asked' && row.metadata_json?.text ? { text: String(row.metadata_json.text), kind: row.metadata_json.kind === 'office' ? 'office' : 'home' } : null
}

/** Home/office statements, and the one-time answer to the area question (which then runs the original search). */
export async function tryPlaceCommand(p: { telegramId: string | number; text: string }, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const tg = exactPlaceOwnerId(p.telegramId)
  if (!tg) return null
  const stated = detectPlaceStatement(p.text)
  const pending = stated ? null : (placeAnswer(p.text) ? await pendingAsk(tg).catch(() => null) : null)
  const place = stated || (pending ? { ...placeAnswer(p.text)!, kind: pending.kind } : null)
  if (!place) return null
  if (!(await savePlace(tg, place).catch(() => false))) return `I couldn't verify that your ${place.kind} area was updated. Please try again; I won't treat an unverified change as saved.`
  await supabaseAdmin.from('agent_activity').insert({ telegram_id: tg, event_type: 'nearby_area_saved', message: `${place.kind} area saved.`, metadata_json: { kind: place.kind } }).then(() => {}, () => {})
  const saved = `Saved your ${place.kind}: ${where(place)}. I'll use it whenever you ask for something ${place.kind === 'home' ? 'nearby' : 'near the office'}, and won't ask again. Say "I live in <area>" any time to change it.`
  if (!pending) return saved
  const out = await answerPlacesWithContext({ text: pending.text, telegramId: tg }, fetchImpl).catch(() => null)
  return out ? `${saved}\n\n${out}` : saved
}

const NEAR_OFFICE = /\b(?:near|around|close\s+to)\s+(?:my\s+|the\s+)?(?:office|work(?:place)?)\b/i

export function tasteNote(values: string[]) {
  const keep = values.filter(v => !/^Likes:/i.test(v)).slice(0, 4)
  return keep.length ? `\n\nKept in mind: ${keep.join(' · ')}. Check the menu before ordering.` : ''
}

export async function answerPlacesWithContext(p: { text: string; telegramId: string | number }, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const tg = exactPlaceOwnerId(p.telegramId)
  if (!tg) return null
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
  const out = await answerPlaces(text, fetchImpl)
  if (!out || !FOOD.test(text) || !out.startsWith('📍')) return out
  const facts = await listTaste(tg).catch(() => null)
  return facts?.length ? out.replace(/(\n\nAsk "which of these is open late\?"[^\n]*)?$/, m => tasteNote(facts.map(f => f.value)) + m) : out
}
