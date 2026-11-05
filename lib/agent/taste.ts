// "Remember and suggest", Phase 1 (approved mockup + build docs, 5 Nov): food taste the person TOLD Gogo.
// Only what was said is saved (source 'said'); nothing is inferred, least of all diet. Every read and write is
// scoped to the owner's telegram_id (kept as text, never through Number). A missing table means "not ready":
// commands fall through to the normal chat path, so the code deploys safely before the migration.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type TasteKind = 'likes' | 'avoids' | 'budget' | 'when' | 'place' | 'diet_stated'
export type TasteFact = { id: string; kind: TasteKind; value: string; context: string | null; source: string; evidence_count: number; last_seen: string; created_at: string }
export type TasteStatement = { kind: TasteKind; value: string; context: string | null }

const TABLE = 'taste_facts'
const DOMAIN = 'food'
const missingTable = (msg: string) => /taste_facts|does not exist|schema cache|42P01|PGRST205/i.test(msg)

const DAYS = '(?:mon|tues|wednes|thurs|fri|satur|sun)days?'
const MEALS = '(?:breakfast|lunch|dinner|snacks?|food|orders?|meals?|delivery)'
const DIETS: Record<string, string> = {
  veg: 'Veg', vegetarian: 'Veg', 'pure veg': 'Veg', vegan: 'Vegan', jain: 'Jain', eggetarian: 'Eggetarian',
  'non veg': 'Non-veg', 'non-veg': 'Non-veg', nonveg: 'Non-veg', 'non vegetarian': 'Non-veg', 'non-vegetarian': 'Non-veg',
}
// Words that make "I like X" about food. Without one, "I like my job" stays ordinary chat.
const FOOD_WORDS = /\b(?:mushrooms?|onions?|garlic|peanuts?|nuts|cashews?|eggs?|beef|pork|seafood|dairy|milk|cheese|gluten|coriander|olives?|brinjal|baingan|capsicum|tomatoes?|potatoes?|okra|bhindi|karela|meat|sugar|oily|fried|pizza|biryani|burger|dosa|idli|thali|paneer|chicken|mutton|fish|prawns?|egg|noodles|pasta|momos?|rolls?|shawarma|sushi|ramen|salad|sandwich|curry|dal|roti|naan|rice|chaat|pav|vada|kebab|tikka|tandoori|chinese|italian|thai|mexican|south indian|north indian|mughlai|continental|dessert|ice ?cream|cake|coffee|tea|chai|juice|food|dish|cuisine|restaurant|spicy|sweet)\b/i
const NOT_FOOD = /^(?:thanks?|thank you|problem|worries|need|way|one|idea|reply|reminders?|messages?|alerts?|more|less|emails?|calls?|ads?|spam)\b/i

const REQUEST = /[,;?]|\b(?:can|could|would|will)\s+you\b|\b(?:find|order|book|suggest|recommend|search|show|get\s+me|send|near(?:by)?|tonight|today|tomorrow|now|but|so)\b/i
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/^[\s,:-]+|[\s.!,;:-]+$/g, '').trim()
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s
const dayContext = (s: string) => { const m = s.match(new RegExp(`\\b(?:on\\s+)?(${DAYS}|weekdays?|weekends?)\\b`, 'i')); return m ? cap(m[1].toLowerCase().replace(/s?$/, 's')) : null }
export const tasteKey = (kind: string, value: string, context?: string | null) => `${kind}|${value.toLowerCase().replace(/[^a-z0-9₹]+/g, ' ').trim()}|${(context || '').toLowerCase()}`

/** A taste statement the person made about themselves, or null. Pure: no reads, no guesses. */
export function detectTasteStatement(text: string): TasteStatement | null {
  const t = clean(String(text || '').replace(/^(?:please\s+)?(?:remember|note|save)(?:\s+that)?\s+/i, ''))
  if (!t || t.length > 140 || /\?$/.test(String(text || '').trim())) return null
  // A request that mentions taste ("I love pizza, can you find one nearby") goes to the normal path, not here.
  if (REQUEST.test(t)) return null
  let m: RegExpMatchArray | null

  // Diet, only as stated: "I'm veg on Tuesdays", "I am vegetarian", "we are jain".
  m = t.match(/^(?:i\s*'?m|i\s+am|i\s+eat|we\s*'?re|we\s+are)\s+(?:a\s+|only\s+|strictly\s+|pure\s+)?(veg(?:etarian)?|vegan|jain|eggetarian|non[\s-]?veg(?:etarian)?)(?:\s+(?:food\s+only|food|only|person))?(?:\s+(.*))?$/i)
  if (m) {
    const diet = DIETS[m[1].toLowerCase().replace(/\s+/g, ' ')] || DIETS[m[1].toLowerCase().replace(/[\s-]+/g, ' ')] || cap(m[1].toLowerCase())
    const rest = m[2] || ''
    // "I'm Jain" is also a surname: only "I eat Jain", "Jain food" or "Jain only" count as a diet.
    if (/jain/i.test(m[1]) && !/\b(?:eat|food|only)\b/i.test(t)) return null
    if (rest && !dayContext(rest)) return null
    const context = rest ? dayContext(rest) : null
    return { kind: 'diet_stated', value: context ? `${diet} on ${context}` : diet, context }
  }

  // Budget: "keep lunch under ₹300", "my food budget is 400", "nothing above ₹500 for dinner".
  m = t.match(new RegExp(`^(?:keep|make)\\s+(?:my\\s+)?(${MEALS})\\s+(?:under|below|within|less than)\\s+(?:₹|rs\\.?\\s*|inr\\s*)?(\\d{2,5})`, 'i'))
    || t.match(new RegExp(`^my\\s+(${MEALS})\\s+budget\\s+is\\s+(?:₹|rs\\.?\\s*|inr\\s*)?(\\d{2,5})`, 'i'))
  if (m) {
    const meal = m[1].toLowerCase().replace(/s$/, '')
    const scope = ['food', 'order', 'meal', 'delivery'].includes(meal) ? null : cap(meal)
    return { kind: 'budget', value: `${scope ? `${scope} ` : ''}under ₹${Number(m[2])}`, context: scope }
  }

  // Avoids: "I don't eat mushrooms", "no onion garlic please", "never mushrooms", "avoid peanuts", "I hate olives".
  // "I don't eat X" is about food by itself; every other phrasing needs a food word ("avoid traffic" stays chat).
  const eat = t.match(/^i\s+(?:don'?t|do\s+not|never|can'?t|cannot)\s+eat\s+(.+)$/i)
  m = eat || t.match(/^(?:i\s+(?:don'?t|do\s+not|can'?t|cannot)\s+(?:like|stand)|i\s+(?:hate|avoid|dislike)|(?:please\s+)?avoid|never\s+(?:give|send|add|suggest)\s+me)\s+(.+)$/i)
    || t.match(/^no\s+(.+?)\s+(?:please|ever|in my food|for me|in anything)$/i)
  if (m) {
    const ctx = dayContext(m[1])
    const value = clean(m[1].replace(new RegExp(`\\b(?:on\\s+)?(?:${DAYS}|weekdays?|weekends?)\\b`, 'ig'), '').replace(/\b(?:at all|ever|please|in my food|anymore)\b/ig, ''))
    if (!value || value.split(' ').length > 5 || NOT_FOOD.test(value)) return null
    if (!eat && !FOOD_WORDS.test(value)) return null
    return { kind: 'avoids', value: `No ${value.toLowerCase()}`, context: ctx }
  }

  // Likes: only with a food word, e.g. "I love Oven Story pizza", "my favourite dish is biryani".
  m = t.match(/^my\s+(?:favou?rite|go-?to|usual)\s+(?:food|dish|cuisine|restaurant|place|order)\s+is\s+(.+)$/i)
  if (m) { const v = clean(m[1]); return v && v.split(' ').length <= 6 ? { kind: 'likes', value: `Likes: ${v}`, context: null } : null }
  m = t.match(/^i\s+(?:really\s+)?(?:love|like|enjoy|prefer)\s+(.+)$/i)
  if (m && FOOD_WORDS.test(m[1])) {
    const ctx = dayContext(m[1]) || (m[1].match(/\bfor\s+(breakfast|lunch|dinner)\b/i)?.[1] ? cap(m[1].match(/\bfor\s+(breakfast|lunch|dinner)\b/i)![1].toLowerCase()) : null)
    const v = clean(m[1])
    return v.split(' ').length <= 7 ? { kind: 'likes', value: `Likes: ${v}`, context: ctx } : null
  }
  return null
}

export function isTasteList(text: string) {
  return /^\s*(?:what\s+do\s+you\s+(?:know|remember)\s+about\s+my\s+(?:food|taste|diet|food\s+(?:taste|preferences?))|(?:show\s+)?my\s+(?:food\s+(?:taste|preferences?)|taste|food\s+profile))\s*\??\s*$/i.test(text || '')
}
/** "forget no mushrooms", "forget that I'm veg on Tuesdays", "forget my food taste". */
export function detectTasteForget(text: string): { all: true } | { match: string } | null {
  const t = String(text || '').trim()
  if (/^forget\s+(?:all\s+)?(?:about\s+)?my\s+(?:food\s+(?:taste|preferences?)|taste|food\s+profile)\s*$/i.test(t)) return { all: true }
  const m = t.match(/^(?:please\s+)?forget\s+(?:that\s+)?(?:i\s*'?m\s+|i\s+am\s+|i\s+)?(.{2,80})$/i)
  return m ? { match: clean(m[1]) } : null
}

async function activeFacts(telegramId: string) {
  const { data, error } = await supabaseAdmin.from(TABLE).select('id,kind,value,context,source,evidence_count,last_seen,created_at')
    .eq('telegram_id', telegramId).eq('domain', DOMAIN).is('forgotten_at', null).order('last_seen', { ascending: false }).limit(50)
  if (error) { if (!missingTable(String(error.message || error.code || ''))) console.error('TASTE_READ_FAILED:', error.message); return null }
  return (data || []) as TasteFact[]
}

// Mutation reads must not reuse the 50-row display cap. A stable secondary order
// prevents page boundaries from dropping tied timestamps.
async function allActiveFacts(telegramId: string): Promise<TasteFact[] | null> {
  const pageSize = 200
  const facts: TasteFact[] = []
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabaseAdmin.from(TABLE)
      .select('id,kind,value,context,source,evidence_count,last_seen,created_at')
      .eq('telegram_id', telegramId).eq('domain', DOMAIN).is('forgotten_at', null)
      .order('last_seen', { ascending: false }).order('id', { ascending: false })
      .range(start, start + pageSize - 1)
    if (error) {
      if (!missingTable(String(error.message || error.code || ''))) console.error('TASTE_MUTATION_READ_FAILED:', error.message)
      return null
    }
    const page = (data || []) as TasteFact[]
    facts.push(...page)
    if (page.length < pageSize) return facts
  }
}

// Verify every requested row stopped being active; a failed write or stale
// readback must not become a "forgotten" success response.
async function markTasteFactsForgotten(telegramId: string, ids: string[], now: string): Promise<boolean> {
  if (!ids.length) return true
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { error } = await supabaseAdmin.from(TABLE).update({ forgotten_at: now })
      .eq('telegram_id', telegramId).eq('domain', DOMAIN).is('forgotten_at', null)
      .in('id', ids.slice(offset, offset + 100))
    if (error) {
      console.error('TASTE_FORGET_WRITE_FAILED:', error.message)
      return false
    }
  }
  const remaining = await allActiveFacts(telegramId)
  const requested = new Set(ids)
  return remaining !== null && !remaining.some(f => requested.has(f.id))
}

export async function listTaste(telegramId: string | number): Promise<TasteFact[] | null> { return activeFacts(String(telegramId)) }

export async function saveTaste(telegramId: string | number, s: TasteStatement): Promise<{ ok: true; repeated: boolean } | { ok: false }> {
  const tg = String(telegramId)
  const facts = await allActiveFacts(tg)
  if (!facts) return { ok: false }
  const now = new Date().toISOString()
  const same = facts.find(f => tasteKey(f.kind, f.value, f.context) === tasteKey(s.kind, s.value, s.context))
  if (same) {
    const { error } = await supabaseAdmin.from(TABLE).update({ evidence_count: (same.evidence_count || 1) + 1, last_seen: now }).eq('id', same.id).eq('telegram_id', tg)
    return error ? { ok: false } : { ok: true, repeated: true }
  }
  // A new stated diet for the same day (or none) replaces the old one; it never merges with it.
  if (s.kind === 'diet_stated') {
    const old = facts.filter(f => f.kind === 'diet_stated' && (f.context || '') === (s.context || '')).map(f => f.id)
    if (old.length && !await markTasteFactsForgotten(tg, old, now)) return { ok: false }
  }
  if (s.kind === 'budget') {
    const old = facts.filter(f => f.kind === 'budget' && (f.context || '') === (s.context || '')).map(f => f.id)
    if (old.length && !await markTasteFactsForgotten(tg, old, now)) return { ok: false }
  }
  const { error } = await supabaseAdmin.from(TABLE).insert({ telegram_id: tg, domain: DOMAIN, kind: s.kind, value: s.value, context: s.context, source: 'said', evidence_count: 1, last_seen: now })
  if (error) { if (!missingTable(String(error.message || ''))) console.error('TASTE_WRITE_FAILED:', error.message); return { ok: false } }
  return { ok: true, repeated: false }
}

/** Forget by id (dashboard) or by words (chat). Returns what was forgotten; null when the table isn't there. */
export async function forgetTaste(telegramId: string | number, by: { id: string } | { match: string } | { all: true }): Promise<string[] | null> {
  const tg = String(telegramId)
  const facts = await allActiveFacts(tg)
  if (!facts) return null
  let hits: TasteFact[]
  if ('id' in by) hits = facts.filter(f => f.id === by.id)
  else if ('all' in by) hits = facts
  else {
    const q = by.match.toLowerCase().replace(/^(?:no|the|my)\s+/, '').replace(/[^a-z0-9₹ ]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (q.length < 2) return []
    hits = facts.filter(f => `${f.value} ${f.context || ''}`.toLowerCase().replace(/[^a-z0-9₹ ]+/g, ' ').replace(/\s+/g, ' ').includes(q))
  }
  if (!hits.length) return []
  if (!await markTasteFactsForgotten(tg, hits.map(h => h.id), new Date().toISOString())) return null
  // For a request to forget ALL, a concurrent insert also prevents an
  // unqualified success claim. This readback isn't a database transaction.
  if ('all' in by) {
    const remaining = await allActiveFacts(tg)
    if (!remaining || remaining.length) return null
  }
  return hits.map(h => h.value)
}

const SOURCE_LABEL: Record<string, string> = { said: 'You told Gogo', order_confirmed: 'From orders you confirmed', pick_accepted: 'From picks you chose', rating: 'Rated well after delivery' }
export function tasteFrom(f: Pick<TasteFact, 'source' | 'evidence_count' | 'created_at'>) {
  const d = new Date(f.created_at)
  const when = Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : ''
  const base = SOURCE_LABEL[f.source] || 'You told Gogo'
  return f.source === 'said' ? `${base}${when ? ` on ${when}` : ''}${f.evidence_count > 1 ? ` · said ${f.evidence_count} times` : ''}` : base
}

export function formatTasteList(facts: TasteFact[]) {
  if (!facts.length) return `🍽️ I haven't saved anything about your food yet.\n\nTell me in your own words, like "I'm veg on Tuesdays", "no mushrooms please" or "keep lunch under ₹300". I'll use it to suggest, never to order on my own.`
  return `🍽️ *What I know about your food*\n${facts.map((f, i) => `${i + 1}. ${f.value}`).join('\n')}\n\nI use this to suggest, never to order on my own. Say "forget ${facts[0].value.replace(/^Likes:\s*/, '').toLowerCase()}" (or any line) to remove it, or open Food taste in your dashboard.`
}

/** System-prompt lines for suggestions. Empty when nothing is saved or the table isn't ready. */
export async function getTasteBlock(telegramId: string | number): Promise<string> {
  const facts = await activeFacts(String(telegramId)).catch(() => null)
  if (!facts?.length) return ''
  return `\nFood taste this person told you (use it when suggesting food; never order or pay on your own; never assume a diet they did not state):\n${facts.slice(0, 15).map(f => `- ${f.value}`).join('\n')}`
}

/** One entry point for both chat paths. Returns a reply, or null to let the normal path handle the message. */
export async function tryTasteCommand(p: { telegramId: string | number; text: string }): Promise<string | null> {
  const text = String(p.text || '').trim()
  if (!text) return null
  if (isTasteList(text)) {
    const facts = await listTaste(p.telegramId)
    return facts ? formatTasteList(facts) : null
  }
  const forget = detectTasteForget(text)
  if (forget) {
    const gone = await forgetTaste(p.telegramId, forget)
    if (gone === null) return null
    if (!gone.length) return 'all' in forget ? formatTasteList([]) : null // no food match: the memory forget handles it
    return `Done, I've forgotten: ${gone.join('; ')}.`
  }
  const s = detectTasteStatement(text)
  if (!s) return null
  const saved = await saveTaste(p.telegramId, s)
  if (!saved.ok) return null
  return saved.repeated
    ? `Noted again: ${s.value}. I'll keep suggesting with that in mind.`
    : `Got it: ${s.value}. I'll use that when I suggest food, never to order on my own. Say "what do you know about my food" to see everything, or "forget ${s.value.toLowerCase()}" to undo.`
}
