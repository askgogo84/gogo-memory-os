import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildAssetRetrievalReply, isAssetRetrievalCommand, buildDocumentReplyById, isBusinessCardText } from '@/lib/services/asset-memory'
import { getList } from '@/lib/data/lists'
import { stripReportingDirectives } from '@/lib/services/reporting-directive'

const RETRIEVAL_VERB_RE = /\b(show me|find|send me|get me|pull up|do you have|where'?s|where is|open(?: my| the)?|retrieve)\b/i
const RESERVED_RETRIEVAL_RE = /^(?:show|open|find|get|send)(?:\s+me)?\s+(?:my\s+)?(?:reminders?|tasks?|to-?dos?|lists?|calendar|events?|cards?|credit\s*cards?|emails?|mail|weather|briefing|today|memory|memories|preferences?|rules?|contacts?|expenses?|spending|saved\s+(?:reels?|videos?|posts?))\s*[?.!]*$/i
// 25 Oct live: "Find my latest document in Drive" returned an old document saved in AskGogo. A request that names
// an outside source (Drive, Gmail, inbox, Docs) belongs to that source's reader, never to saved-asset retrieval.
export const EXTERNAL_SOURCE_RE = /\b(?:(?:in|from|on|inside|of|search|check)\s+(?:my\s+|the\s+)?(?:google\s+)?(?:drive|g-?drive|gmail|inbox|e-?mails?|mail|docs|sheets|dropbox|one\s?drive)|google\s+(?:drive|docs?|sheets?)|drive\s+(?:files?|folders?|docs?))\b/i
const SENSITIVE_REVEAL_CONFIRM_RE = /^\s*show\s+(?:the\s+)?(?:passport|id|reference)\s*(?:number|no)?\s*[?.!]*$/i

// Operational requests must never be stolen by a loose match against an old saved
// document. This is especially important for booking flows where words such as
// "open", "create", "booking" and "confirm" are action vocabulary, not document
// identity. Explicit document/file retrieval still remains eligible below.
const OPERATIONAL_FLOW_RE = /\b(appointment|provider|live\s+slots?|availability|book(?:ing)?|reserve|reservation|flight|airline|concert|movie|event\s+tickets?|bus\s+tickets?|train\s+tickets?|cab|hotel|check[- ]?in|checkout|payment|purchase)\b/i
// "report" stays an explicit-asset noun so a genuine saved report with an operational
// title ("my hotel report") still escapes the operational-flow guard below. The
// reporting DIRECTIVE ("Report only verified results") is stripped before this test
// (see shouldAttemptNaturalAssetRetrieval) so it can no longer satisfy the escape.
const EXPLICIT_ASSET_NOUN_RE = /\b(passport|payment|proof|screenshot|receipt|invoice|estimate|estimation|quotation|slip|document|pdf|file|\bid\b|licen[cs]e|statement|policy|aadhaar|pan|lease|agreement|contract|bill|certificate|report|letter|warranty|prescription)\b/i

const STOP = new Set([
  'show', 'me', 'find', 'send', 'get', 'pull', 'up', 'do', 'you', 'have', 'where', 'is',
  'open', 'retrieve', 'my', 'the', 'a', 'an', 'please', 'for', 'of', 'to', 'from', 'this',
  'that', 'saved', 'save', 'memory', 'item', 'thing', 'original', 'copy',
  // Generic operational verbs/modifiers are not stable asset identifiers. A previous
  // production failure matched only "create" from "do not create anything" to an old
  // transaction screenshot and returned the wrong artifact.
  'create', 'confirm', 'call', 'check', 'inspect', 'prepare', 'provider', 'page', 'option',
  'available', 'availability', 'slots', 'slot', 'book', 'booking', 'reserve', 'reservation',
  'next', 'week', 'anything', 'live',
])

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalize(value)
    .split(' ')
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && !STOP.has(x))
}

function assetNoun(doc: any): string {
  const type = String(doc?.extracted?.assetType || doc?.extracted?.detectedAssetType || doc?.doc_type || '')
  if (type === 'generic_image') return 'image'
  if (type === 'order_estimate') return 'estimate document'
  if (type === 'payment_proof') return 'payment proof'
  if (type === 'receipt') return 'receipt'
  if (type === 'invoice') return 'invoice'
  if (type === 'passport') return 'passport'
  if (type === 'id_document') return 'ID document'
  return 'document'
}

export function shouldAttemptNaturalAssetRetrieval(text: string): boolean {
  const raw = String(text || '').trim()
  if (!raw || !RETRIEVAL_VERB_RE.test(raw) || RESERVED_RETRIEVAL_RE.test(raw) || SENSITIVE_REVEAL_CONFIRM_RE.test(raw) || EXTERNAL_SOURCE_RE.test(raw)) return false
  // If this is an operational booking/travel/event flow, only permit Asset Memory to
  // claim it when the user explicitly asks for an asset-shaped object (document,
  // passport, receipt, file, etc.). Otherwise the real booking agent owns the turn.
  // Strip reporting directives first ("Report only verified results") so they cannot
  // satisfy the asset-noun escape, while a genuine "my hotel report" still does.
  if (OPERATIONAL_FLOW_RE.test(raw) && !EXPLICIT_ASSET_NOUN_RE.test(stripReportingDirectives(raw))) return false
  return true
}

/**
 * Natural Asset Memory retrieval for phrases such as:
 *   "show me Jopasu Dashboard & Tyre Polish"
 *   "find my Jopasu polish"
 *   "send me the Mythili sales estimate"
 *
 * The existing Asset Memory renderer remains the final authority for privacy,
 * sensitive-field gating and short links. This helper only resolves a strong
 * lexical title/label candidate and enriches the query so that exact saved assets
 * outrank looser semantic memories. If confidence is weak it returns null and the
 * caller can continue normal routing.
 */
export async function buildNaturalAssetRetrievalReply(
  telegramId: number,
  text: string,
  messageId?: string | null,
): Promise<string | null> {
  const raw = String(text || '').trim()
  // "show passport number" is the explicit confirmation phrase created by the
  // sensitive-field gate. Decline it here so buildAssetFieldReply can consume the
  // one-shot pending binding later in the WhatsApp route.
  const verbOk = shouldAttemptNaturalAssetRetrieval(raw)
  const contactAsk = isContactQuestion(raw) && !RESERVED_RETRIEVAL_RE.test(raw) && !SENSITIVE_REVEAL_CONFIRM_RE.test(raw) && !EXTERNAL_SOURCE_RE.test(raw)
  if (!verbOk && !contactAsk) return null

  const qTokens = tokens(raw)
  if (!qTokens.length) return null

  const { data } = await supabaseAdmin
    .from('documents')
    .select('id, doc_type, title, summary, extracted, created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(120)

  const docs = (data || []) as any[]

  // A person or company named in what was saved ("Pradip Kumar card", "SkyHi contact"):
  // search the text read from each saved file, not just its title. Older saves (image notes,
  // pre-documents notes) carry the name only in their text.
  const byName = matchSavedByName(raw, docs, { verbOk })
  if (byName) return buildDocumentReplyById(telegramId, String(byName.id), raw, messageId ?? null)
  if (contactAsk) {
    const notes = await getList(telegramId, 'notes').catch(() => null)
    const note = matchNoteByName(raw, Array.isArray((notes as any)?.items) ? (notes as any).items : [])
    if (note) return `📝 From your saved notes${note.at ? ` (${new Date(note.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})` : ''}:\n\n${note.text.slice(0, 1500)}`
  }
  if (!verbOk || !docs.length) return null

  const tokenDocFrequency = new Map<string, number>()
  for (const doc of docs) {
    const bag = new Set([
      ...tokens(String(doc.title || '')),
      ...tokens(String(doc?.extracted?.userLabel || '')),
      ...((Array.isArray(doc?.extracted?.userTags) ? doc.extracted.userTags : []).flatMap((x: any) => tokens(String(x)))),
    ])
    for (const t of bag) tokenDocFrequency.set(t, (tokenDocFrequency.get(t) || 0) + 1)
  }

  let best: any | null = null
  let bestScore = 0
  let bestTitleHits = 0
  let secondScore = 0

  for (const doc of docs) {
    const title = normalize(String(doc.title || ''))
    const titleTokens = new Set(tokens(title))
    const userLabel = normalize(String(doc?.extracted?.userLabel || ''))
    const userTags = new Set(
      (Array.isArray(doc?.extracted?.userTags) ? doc.extracted.userTags : [])
        .flatMap((x: any) => tokens(String(x))),
    )

    let score = 0
    let titleHits = 0
    for (const token of qTokens) {
      if (titleTokens.has(token)) {
        titleHits += 1
        score += 4
        if ((tokenDocFrequency.get(token) || 0) === 1 && token.length >= 5) score += 3
      }
      if (userTags.has(token)) score += 2
      if (userLabel && userLabel.includes(token)) score += 1
    }

    if (qTokens.length >= 2 && titleHits >= 2) score += 5
    if (qTokens.length > 0 && titleHits === qTokens.length) score += 6

    // A user label such as "payment screenshot" is useful only when the user asks
    // for it explicitly. It must never override a stronger title match.
    const normalizedTarget = qTokens.join(' ')
    if (normalizedTarget.length >= 5 && userLabel.includes(normalizedTarget)) score += 4

    if (score > bestScore) {
      secondScore = bestScore
      bestScore = score
      bestTitleHits = titleHits
      best = doc
    } else if (score > secondScore) {
      secondScore = score
    }
  }

  // Natural title retrieval requires more than one discriminative title token.
  // A single unique generic verb used to score 7 (4 title + 3 uniqueness), which was
  // enough to leak an unrelated old artifact into a booking flow. Explicit asset
  // retrieval is handled by the semantic path below and does not need this shortcut.
  const strongLexicalMatch = best && bestTitleHits >= 2 && bestScore >= 7 && (bestScore - secondScore >= 2 || bestScore >= 12)
  if (strongLexicalMatch) {
    const enriched = `${raw} ${best.title || ''} ${assetNoun(best)}`.trim()
    return buildAssetRetrievalReply(telegramId, enriched, messageId ?? null)
  }

  // Explicit document-shaped requests can still use the existing semantic matcher.
  // Brand/name-only requests deliberately do NOT semantic-fallback here: that was
  // the collision that mapped "Jopasu polish" to an unrelated JTP estimate.
  if (isAssetRetrievalCommand(raw)) {
    return buildAssetRetrievalReply(telegramId, raw, messageId ?? null)
  }

  return null
}

const CONTACT_RE = /\b(cards?|visiting|business card|contacts?|numbers?|phone|mobile|e-?mail|mail id|address|details|who is)\b/i
export function isContactQuestion(text: string): boolean { return CONTACT_RE.test(String(text || '')) }

// Words that describe what is wanted, not who: never treated as a name.
const NOT_A_NAME = new Set([
  'card', 'cards', 'visiting', 'business', 'contact', 'contacts', 'number', 'numbers', 'phone', 'mobile', 'email',
  'mail', 'details', 'address', 'who', 'his', 'her', 'their', 'name', 'had', 'shared', 'always', 'long', 'back',
  'kept', 'gave', 'sent', 'earlier', 'last', 'what', 'whats', 'with', 'and', 'you', 'your', 'can', 'need', 'want',
  'person', 'guy', 'there', 'here', 'yes', 'yeah', 'search', 'look', 'tell',
])
function nameTokens(raw: string): string[] {
  return tokens(raw.replace(/'s\b/gi, '')).filter((t) => !NOT_A_NAME.has(t))
}
function docHay(doc: any): string {
  const ex = doc?.extracted || {}
  const fields = ex.fields && typeof ex.fields === 'object' ? Object.values(ex.fields).join(' ') : ''
  return ` ${normalize([doc?.title, doc?.summary, ex.text, ex.summary, fields, ex.userLabel].filter(Boolean).join(' '))} `
}
function isCardDoc(doc: any): boolean {
  return String(doc?.extracted?.assetType || doc?.doc_type || '') === 'business_card' || isBusinessCardText(`${doc?.title || ''} ${doc?.summary || ''} ${doc?.extracted?.text || ''}`)
}
function phraseIn(hay: string, names: string[]): boolean {
  for (let i = 0; i + 1 < names.length; i++) if (hay.includes(` ${names[i]} ${names[i + 1]} `)) return true
  return false
}

/**
 * The saved file a person/company name points at. Contact-shaped questions match business
 * cards on a two-word name ("pradip kumar") or a unique single name; any other saved file
 * needs a "show/find" verb and EVERY name word present, so a request like "find a badminton
 * court in HSR Layout" can't pull up an old receipt that happens to mention HSR Layout.
 */
export function matchSavedByName(raw: string, docs: any[], opts: { verbOk: boolean }): any | null {
  const names = nameTokens(raw)
  if (!names.length) return null
  const contact = isContactQuestion(raw)
  const scored = docs.map((doc) => {
    const hay = docHay(doc)
    const hits = names.filter((t) => hay.includes(` ${t} `))
    return { doc, hay, hits: hits.length, card: isCardDoc(doc), phrase: phraseIn(hay, names) }
  })
  const ok = scored.filter((x) => {
    if (x.card && contact) {
      if (names.length >= 2) return x.phrase || x.hits === names.length
      return names[0].length >= 4 && x.hits === 1
    }
    return opts.verbOk && (contact || EXPLICIT_ASSET_NOUN_RE.test(raw)) && names.length >= 2 && x.hits === names.length && x.phrase
  })
  if (!ok.length) return null
  ok.sort((a, b) => (Number(b.card) - Number(a.card)) || (b.hits - a.hits) || (Date.parse(b.doc.created_at || 0) - Date.parse(a.doc.created_at || 0)))
  // One name that fits several different cards ("Rahul") is ambiguous; repeat saves of the same card are not.
  if (names.length === 1 && ok.filter((x) => x.card).length > 1) {
    // Same first name, different surnames → different people.
    const people = new Set(ok.filter((x) => x.card).map((x) => (x.hay.match(new RegExp(` ${names[0]} ([a-z0-9]+) `)) || [])[1] || ''))
    if (people.size > 1) return null
  }
  return ok[0].doc
}

/** Older saves that only live in the notes list. */
export function matchNoteByName(raw: string, items: any[]): { text: string; at?: string } | null {
  const names = nameTokens(raw)
  if (!names.length || (names.length === 1 && names[0].length < 5)) return null
  // Only contact-like notes (a card, an email or a phone number), so "my HDFC card number"
  // can never surface an unrelated note that mentions HDFC.
  const contactLike = (t: string) => isBusinessCardText(t) || /[\w.+-]+@[\w-]+\.[\w.]+/.test(t) || /(?:\+?\d[\d\s-]{8,}\d)/.test(t)
  const hits = items
    .map((it: any) => ({ text: String(it?.text ?? it ?? ''), at: it?.added_at || it?.created_at || it?.at }))
    .filter((n) => { const hay = ` ${normalize(n.text)} `; return contactLike(n.text) && (names.length >= 2 ? phraseIn(hay, names) : hay.includes(` ${names[0]} `)) })
  return hits.length ? hits[hits.length - 1] : null
}
