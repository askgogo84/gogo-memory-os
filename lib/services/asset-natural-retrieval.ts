import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildAssetRetrievalReply, isAssetRetrievalCommand } from '@/lib/services/asset-memory'

const RETRIEVAL_VERB_RE = /\b(show me|find|send me|get me|pull up|do you have|where'?s|where is|open(?: my| the)?|retrieve)\b/i
const RESERVED_RETRIEVAL_RE = /^(?:show|open|find|get|send)(?:\s+me)?\s+(?:my\s+)?(?:reminders?|tasks?|to-?dos?|lists?|calendar|events?|cards?|credit\s*cards?|emails?|mail|weather|briefing|today|memory|memories|preferences?|rules?|contacts?|expenses?|spending|saved\s+(?:reels?|videos?|posts?))\s*[?.!]*$/i
const SENSITIVE_REVEAL_CONFIRM_RE = /^\s*show\s+(?:the\s+)?(?:passport|id|reference)\s*(?:number|no)?\s*[?.!]*$/i

const STOP = new Set([
  'show', 'me', 'find', 'send', 'get', 'pull', 'up', 'do', 'you', 'have', 'where', 'is',
  'open', 'retrieve', 'my', 'the', 'a', 'an', 'please', 'for', 'of', 'to', 'from', 'this',
  'that', 'saved', 'save', 'memory', 'item', 'thing', 'original', 'copy',
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
  if (!raw || !RETRIEVAL_VERB_RE.test(raw) || RESERVED_RETRIEVAL_RE.test(raw) || SENSITIVE_REVEAL_CONFIRM_RE.test(raw)) return null

  const qTokens = tokens(raw)
  if (!qTokens.length) return null

  const { data } = await supabaseAdmin
    .from('documents')
    .select('id, doc_type, title, extracted, created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(120)

  const docs = (data || []) as any[]
  if (!docs.length) return null

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
      best = doc
    } else if (score > secondScore) {
      secondScore = score
    }
  }

  const strongLexicalMatch = best && bestScore >= 7 && (bestScore - secondScore >= 2 || bestScore >= 12)
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
