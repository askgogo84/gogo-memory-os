/**
 * Asset Memory — unified save + retrieve for images/screenshots/PDFs that are
 * payment proofs, passports, or ID documents (and a clean fall-through for
 * everything else).
 *
 * This module is the SECOND stage that runs only AFTER the existing coarse
 * classifiers (image Haiku TICKET/FOOD/DOCUMENT/OTHER in the webhook; PDF
 * classifyPdfDocument) have already routed a file to the note/document path.
 * The ticket, food, skin, and medical-note paths are never touched.
 *
 * Two hard privacy rules the whole design hangs on:
 *  1. Sensitive VALUES (passport/ID/account numbers) must NEVER reach indexMemory.
 *     The freeform LLM path surfaces memory_embeddings content in chat, so we
 *     index the LABEL only ("Srini passport number") — never the value. A
 *     code-side digit-stripper is the belt-and-braces backstop.
 *  2. Sensitive assets are NOT written to the "my notes" list. That plaintext
 *     list is exactly what leaked a third party's licence (DOB, address, number)
 *     into chat. They live only in the private documents row + label-only index.
 *
 * Everything here is best-effort and non-fatal: any failure returns null so the
 * caller falls back to the existing summarise-and-save note path unchanged.
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { storeDocument, getDocumentSignedUrl } from '@/lib/services/document-store'
import { embedText } from '@/lib/services/embeddings'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'
import { saveFollowupState, getLatestFollowupState, isStrictlyFreshFollowupState } from '@/lib/bot/handlers/followup-state'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export type AssetType =
  | 'payment_proof'
  | 'passport'
  | 'id_document'
  | 'invoice'
  | 'generic_document'
  | 'generic_image'

export interface AssetExtraction {
  assetType: AssetType
  privacyClass: 'sensitive' | 'normal'
  displayTitle: string
  fields: Record<string, string>
  docDateISO: string | null
  expiryISO: string | null
  expiryHuman: string | null
  labelKeywords: string[]
}

// The three asset types this pass handles fully. Anything else falls back to the
// existing readAndSummarize* note path (medical safety etc. lives there).
const STRUCTURED: AssetType[] = ['payment_proof', 'passport', 'id_document']

export function isStructuredAsset(t: AssetType): boolean {
  return STRUCTURED.includes(t)
}

// ── Masking ───────────────────────────────────────────────────────────────────

// Mask an identifier for chat: keep first 3 + last 1, e.g. "R2109876" -> "R21••••6".
// Short values keep only the last char. Empty in -> empty out.
export function maskNumber(value: string | null | undefined): string {
  const s = String(value || '').replace(/\s+/g, '').trim()
  if (!s) return ''
  if (s.length <= 4) return '••' + s.slice(-1)
  return s.slice(0, 3) + '••••' + s.slice(-1)
}

// Belt-and-braces for anything indexed/echoed: collapse any run of 4+ digits so a
// stray number can never survive into memory_embeddings or a masked confirmation.
function stripLongDigits(text: string): string {
  return String(text || '').replace(/\d[\d\s-]{3,}\d/g, '••••')
}

// ── Classification + extraction (one vision/PDF call) ───────────────────────────

const CLASSIFY_SYSTEM =
  'You are AskGogo classifying and extracting structured data from a file a user sent on WhatsApp (a screenshot, photo, or PDF). Return ONLY valid JSON, no markdown, no prose. Never invent values you cannot read — use null. For the human-facing fields (displayTitle, labelKeywords) you MUST NOT include full passport/ID/account/card numbers; those belong only in the raw `fields` object.'

const CLASSIFY_INSTRUCTION = `Classify this file into exactly one assetType and extract its details.

assetType (choose one):
- "payment_proof": a bank transfer / UPI / IMPS / NEFT / payment receipt / transaction confirmation screenshot.
- "passport": a passport data page (any country).
- "id_document": a national ID, driving licence, Aadhaar, PAN, voter ID, residence permit, etc.
- "invoice": a purchase invoice or bill.
- "generic_document": any other paperwork (lease, contract, letter, form, statement, report).
- "generic_image": a photo that is not primarily a document.

Return this exact JSON shape:
{
  "assetType": "<one of the above>",
  "displayTitle": "<clean short title, e.g. 'Abdul Rahiman Payment Proof — ₹51,000' or 'Srini Passport'. Never a sentence like 'This is a passport belonging to...'. No full ID/account numbers.>",
  "fields": { <see per-type keys below; use null for anything not clearly visible> },
  "docDateISO": "<the document's own date as YYYY-MM-DD, or null>",
  "expiryISO": "<expiry/validity date as YYYY-MM-DD, or null>",
  "expiryHuman": "<expiry as written, e.g. '15 Jun 2027', or null>",
  "labelKeywords": [ "<NON-sensitive search labels: person name, doc kind, bank, city — NEVER numbers>" ]
}

Per-type "fields" keys:
- payment_proof: { "counterparty": , "amount": , "date": , "bank": , "method": , "reference_number": }
- passport: { "name": , "passport_number": , "dob": , "issue_date": , "expiry_date": , "nationality": }
- id_document: { "name": , "document_kind": , "id_number": , "dob": , "expiry_date": }
- invoice / generic_document / generic_image: { "title": , "summary": }

Reply with ONLY the JSON object.`

function parseJsonLoose(text: string): any | null {
  const clean = (text || '').replace(/```json|```/g, '').trim()
  if (!clean) return null
  try {
    return JSON.parse(clean)
  } catch {
    // tolerate leading/trailing prose around the object
    const m = clean.match(/\{[\s\S]*\}/)
    if (m) { try { return JSON.parse(m[0]) } catch { return null } }
    return null
  }
}

function normalizeExtraction(raw: any): AssetExtraction | null {
  if (!raw || typeof raw !== 'object') return null
  const assetType = String(raw.assetType || '').trim() as AssetType
  const allowed: AssetType[] = ['payment_proof', 'passport', 'id_document', 'invoice', 'generic_document', 'generic_image']
  if (!allowed.includes(assetType)) return null
  const privacyClass: 'sensitive' | 'normal' =
    assetType === 'passport' || assetType === 'id_document' || assetType === 'payment_proof' ? 'sensitive' : 'normal'
  const fields: Record<string, string> = {}
  if (raw.fields && typeof raw.fields === 'object') {
    for (const [k, v] of Object.entries(raw.fields)) {
      if (v === null || v === undefined) continue
      const s = String(v).trim()
      if (s && s.toLowerCase() !== 'null') fields[k] = s
    }
  }
  const labelKeywords = Array.isArray(raw.labelKeywords)
    ? raw.labelKeywords.map((s: any) => String(s || '').trim()).filter(Boolean).filter((s: string) => !/\d{4,}/.test(s))
    : []
  return {
    assetType,
    privacyClass,
    displayTitle: String(raw.displayTitle || '').trim().slice(0, 200) || 'Document',
    fields,
    docDateISO: toIsoOrNull(raw.docDateISO),
    expiryISO: toIsoOrNull(raw.expiryISO),
    expiryHuman: raw.expiryHuman ? String(raw.expiryHuman).trim() : null,
    labelKeywords,
  }
}

function toIsoOrNull(v: any): string | null {
  const s = String(v || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

async function fetchTwilioBase64(mediaUrl: string, contentType: string): Promise<{ b64: string; isPdf: boolean }> {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const res = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) throw new Error(`Twilio fetch ${res.status}`)
  const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
  return { b64, isPdf: (contentType || '').toLowerCase().includes('pdf') }
}

/**
 * Classify + extract in a single Claude call. `kind` picks the content block:
 * 'image' sends an image block (base64 from Twilio), 'pdf' a document block.
 * Returns null on any failure so the caller falls back to the existing note path.
 */
export async function classifyAndExtractAsset(params: {
  mediaUrl: string
  contentType: string
  kind: 'image' | 'pdf'
  caption?: string
}): Promise<AssetExtraction | null> {
  try {
    let contentBlock: any
    if (params.kind === 'pdf') {
      const { b64 } = await fetchTwilioBase64(params.mediaUrl, params.contentType)
      contentBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    } else {
      // Reuse the shared image download (handles size cap + mime normalisation).
      const dataUrl = await downloadTwilioMediaAsDataUrl({ mediaUrl: params.mediaUrl, contentType: params.contentType })
      const m = dataUrl.match(/^data:(.+?);base64,(.*)$/)
      if (!m) return null
      contentBlock = { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
    }

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 900,
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: `User caption: ${params.caption || 'none'}\n\n${CLASSIFY_INSTRUCTION}` },
          ],
        },
      ],
    })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    console.log('[asset-memory] classify raw:', text.slice(0, 300))
    return normalizeExtraction(parseJsonLoose(text))
  } catch (err: any) {
    console.error('[asset-memory] classify failed (non-fatal):', err?.message || err)
    return null
  }
}

// ── Confirmation templates (masked, no calendar suggestion) ─────────────────────

function fmt(v?: string): string {
  return (v || '').trim()
}

function buildConfirmation(ex: AssetExtraction): string {
  const f = ex.fields
  if (ex.assetType === 'payment_proof') {
    const line2 = [fmt(f.counterparty), fmt(f.amount)].filter(Boolean).join(' — ')
    const line3 = [fmt(f.date), fmt(f.method), fmt(f.bank)].filter(Boolean).join(' · ')
    const asks = [
      f.counterparty ? `- "Show me ${f.counterparty} payment proof"` : null,
      f.amount ? `- "Find the ${f.amount} payment screenshot"` : `- "Find my payment screenshot"`,
      f.reference_number ? `- "What was the reference number?"` : null,
    ].filter(Boolean).join('\n')
    return (
      `✅ Saved payment proof` +
      (line2 ? `\n${line2}` : '') +
      (line3 ? `\n${line3}` : '') +
      `\n\nI've saved the original screenshot and its details.` +
      (asks ? `\n\nYou can ask later:\n${asks}` : '')
    )
  }

  const isPassport = ex.assetType === 'passport'
  const who = fmt(f.name) || 'the holder'
  const kind = isPassport
    ? `${fmt(f.nationality)} Passport`.trim()
    : (fmt(f.document_kind) || 'ID document')
  const expiry = ex.expiryHuman || fmt(f.expiry_date)
  const line2 = [kind, expiry ? `expires ${expiry}` : ''].filter(Boolean).join(' · ')
  const label = isPassport ? `${who}'s Passport` : `${who}'s ${kind}`
  const asks = [
    `- "Show me ${fmt(f.name) || who} ${isPassport ? 'passport' : 'ID'}"`,
    expiry ? `- "When does ${fmt(f.name) || who} ${isPassport ? 'passport' : 'ID'} expire?"` : null,
    `- "Send me the original ${isPassport ? 'passport' : 'ID'} file"`,
  ].filter(Boolean).join('\n')
  return (
    `✅ Saved — ${label}` +
    (line2 ? `\n${line2}` : '') +
    `\n\nI've securely saved the original file and the details.` +
    `\n\nYou can ask later:\n${asks}`
  )
}

// Label-only index text. NO values — only the person, doc kind, and the NAMES of
// the fields we hold, plus a digit-strip backstop. This is the only asset text
// that reaches memory_embeddings / the freeform LLM path.
function buildIndexLabels(ex: AssetExtraction): string {
  const fieldLabels = Object.keys(ex.fields)
    .filter((k) => !['summary', 'title'].includes(k))
    .map((k) => k.replace(/_/g, ' '))
  const parts = [
    ex.displayTitle,
    ex.assetType.replace(/_/g, ' '),
    ...ex.labelKeywords,
    fieldLabels.length ? `fields on file: ${fieldLabels.join(', ')}` : '',
  ].filter(Boolean)
  return stripLongDigits(parts.join(' · ')).slice(0, 500)
}

// Masked summary stored on the documents row (safe for retrieval to echo).
function buildStoredSummary(ex: AssetExtraction): string {
  const f = ex.fields
  if (ex.assetType === 'payment_proof') {
    return stripLongDigits(
      [fmt(f.counterparty), fmt(f.amount), fmt(f.date), fmt(f.method), fmt(f.bank)].filter(Boolean).join(' · '),
    )
  }
  const kind = ex.assetType === 'passport' ? `${fmt(f.nationality)} Passport`.trim() : fmt(f.document_kind)
  const expiry = ex.expiryHuman || fmt(f.expiry_date)
  return stripLongDigits([fmt(f.name), kind, expiry ? `expires ${expiry}` : ''].filter(Boolean).join(' · '))
}

/**
 * Persist a structured asset (payment_proof/passport/id_document): store the
 * original file + a masked documents row, index LABELS ONLY, and stash a
 * short-lived "last asset" context for field follow-ups. Returns the masked
 * confirmation, or null on any failure (caller falls back to the note path).
 */
export async function saveAssetMemory(params: {
  telegramId: number
  ex: AssetExtraction
  messageId?: string | null
  file: { mediaUrl: string; accountSid: string; authToken: string; contentType: string }
}): Promise<{ reply: string } | null> {
  const { ex } = params
  try {
    const stored = await storeDocument({
      telegramId: params.telegramId,
      docType: ex.assetType,
      docAction: 'document_save',
      title: ex.displayTitle,
      summary: buildStoredSummary(ex),
      // Full values live only in this private column; documents is never read into
      // the freeform LLM context (only memory_embeddings is), and we index labels only.
      extracted: {
        assetType: ex.assetType,
        privacyClass: ex.privacyClass,
        masked: true,
        fields: ex.fields,
        expiryHuman: ex.expiryHuman,
      },
      indexContent: buildIndexLabels(ex),
      docDate: ex.docDateISO,
      expiresOn: ex.expiryISO,
      messageId: params.messageId ?? null,
      file: params.file,
    })

    // Stash the doc id (id only — no values) so "what was the reference number?"
    // can resolve without conversation history. Keyed to the SOURCE message id (Case 5):
    // the binding names the exact message that produced it, never "the most recent media".
    // JSON followup_state rows are excluded from both indexing and the freeform prompt.
    if (stored.id && !stored.duplicate) {
      await saveFollowupState(params.telegramId, 'last_asset', {
        docId: stored.id,
        messageId: params.messageId ?? null,
        source: 'save',
      })
    }

    return { reply: buildConfirmation(ex) }
  } catch (err: any) {
    console.error('[asset-memory] save failed (non-fatal):', err?.message || err)
    return null
  }
}

/**
 * Full save path for the webhook: classify → if structured, store + confirm.
 * Returns null when the file is NOT a structured asset (or on any error), so the
 * caller runs its existing summarise-and-save note path unchanged.
 */
export async function tryHandleAssetSave(params: {
  telegramId: number
  mediaUrl: string
  contentType: string
  kind: 'image' | 'pdf'
  caption?: string
  messageId?: string | null
  accountSid: string
  authToken: string
}): Promise<{ reply: string } | null> {
  const ex = await classifyAndExtractAsset({
    mediaUrl: params.mediaUrl,
    contentType: params.contentType,
    kind: params.kind,
    caption: params.caption,
  })
  if (!ex || !isStructuredAsset(ex.assetType)) return null
  return saveAssetMemory({
    telegramId: params.telegramId,
    ex,
    messageId: params.messageId ?? null,
    file: {
      mediaUrl: params.mediaUrl,
      accountSid: params.accountSid,
      authToken: params.authToken,
      contentType: params.contentType,
    },
  })
}

// ── Retrieval ───────────────────────────────────────────────────────────────

// Loose verb-shape gate. Deliberately permissive on SHAPE — buildAssetRetrievalReply
// only actually CLAIMS the turn if a document is found above threshold, otherwise it
// returns null and the caller falls through to the freeform path. That existence
// gate (not the matcher) is what prevents this from hijacking unrelated messages.
export function isAssetRetrievalCommand(text: string): boolean {
  const t = (text || '').toLowerCase().trim()
  const verb = /\b(show me|find|send me|get me|pull up|do you have|where'?s|where is|open the|retrieve)\b/.test(t)
  // Document-shaped nouns only, so the (cost-bearing) semantic lookup in
  // buildAssetRetrievalReply runs on document-ish phrases — not "show me the weather".
  // The lookup itself is the real gate: it returns null (→ fall through) unless a
  // stored document actually matches, so a wide-but-document-shaped list is safe.
  const noun = /\b(passport|payment|proof|screenshot|receipt|invoice|document|pdf|file|id|licen[cs]e|statement|policy|aadhaar|pan|lease|agreement|contract|bill|certificate|report|letter|warranty|prescription)\b/.test(t)
  return verb && noun
}

// Field aliases for follow-up questions like "what was the reference number?" or
// "when does the passport expire?". Maps a phrase to the field key(s) to look up.
const FIELD_ALIASES: Array<{ re: RegExp; keys: string[]; label: string }> = [
  { re: /reference|ref\s*no|transaction\s*id|txn|utr\b/i, keys: ['reference_number'], label: 'Reference number' },
  { re: /passport\s*(number|no)/i, keys: ['passport_number'], label: 'Passport number' },
  { re: /\bid\s*(number|no)\b/i, keys: ['id_number'], label: 'ID number' },
  { re: /expir|valid\s*(till|until|to)|when.*expire/i, keys: ['expiry_date'], label: 'Expiry' },
  { re: /amount|how much|value/i, keys: ['amount'], label: 'Amount' },
  { re: /\bdate\b/i, keys: ['date', 'issue_date'], label: 'Date' },
  { re: /nationality/i, keys: ['nationality'], label: 'Nationality' },
  { re: /\bbank\b/i, keys: ['bank'], label: 'Bank' },
]

function requestedField(text: string): { keys: string[]; label: string } | null {
  for (const a of FIELD_ALIASES) if (a.re.test(text)) return { keys: a.keys, label: a.label }
  return null
}

async function fetchDocumentById(telegramId: number, id: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from('documents')
    .select('id, doc_type, title, summary, extracted, storage_path')
    .eq('telegram_id', telegramId)
    .eq('id', id)
    .single()
  return data || null
}

function fieldFromDoc(doc: any, keys: string[]): string | null {
  const fields = (doc?.extracted?.fields || {}) as Record<string, string>
  for (const k of keys) if (fields[k]) return fields[k]
  if (keys.includes('expiry_date') && doc?.extracted?.expiryHuman) return String(doc.extracted.expiryHuman)
  return null
}

// ── Sensitive-retrieval masking (Case 3) ──────────────────────────────────────
// A sensitive document (passport / ID / payment proof) must NEVER render
// documents.extracted wholesale. These helpers emit only the minimum useful
// metadata: a clean title, the document type, expiry/status, and a MASKED
// identifier — no DOB, address, birthplace, or any full number.

// The one primary identifier for a sensitive doc, masked for chat. Only known
// identifier keys are ever surfaced; anything else (DOB, address, birthplace,
// passwords, tokens) is deliberately omitted. Returns null when none is on file.
function maskedIdentifierLine(doc: any): string | null {
  const f = (doc?.extracted?.fields || {}) as Record<string, string>
  if (f.passport_number) return `Passport no. ${maskNumber(f.passport_number)}`
  if (f.id_number) return `ID no. ${maskNumber(f.id_number)}`
  if (f.account_number) return `A/c ${maskNumber(f.account_number)}`
  if (f.reference_number) return `Ref. ${maskNumber(f.reference_number)}`
  return null
}

// Masked default reply for a sensitive asset. Clean title + type/expiry + masked
// identifier + the original file link (short-TTL signed URL) + a hint. Never
// iterates extracted.fields, so no private field can leak by default.
async function buildMaskedSensitiveReply(doc: any): Promise<string> {
  const ex = (doc?.extracted || {}) as any
  const f = (ex.fields || {}) as Record<string, string>
  const assetType: string = ex.assetType || doc.doc_type || ''

  let typeLabel = ''
  if (assetType === 'passport') typeLabel = [fmt(f.nationality), 'Passport'].filter(Boolean).join(' ')
  else if (assetType === 'id_document') typeLabel = fmt(f.document_kind) || 'ID document'
  else if (assetType === 'payment_proof') typeLabel = 'Payment proof'
  const expiry = ex.expiryHuman || fmt(f.expiry_date)
  const line2 = [typeLabel, expiry ? `expires ${expiry}` : ''].filter(Boolean).join(' · ')

  const lines: string[] = [`📄 ${doc.title || 'Document'}`]
  if (line2) lines.push(line2)
  const idLine = maskedIdentifierLine(doc)
  if (idLine) lines.push(idLine)

  if (doc.storage_path) {
    const url = await getDocumentSignedUrl(doc.storage_path, 600)
    if (url) lines.push(`\nOriginal file: ${url}\n_link valid ~10 min_`)
  }
  lines.push(`\nAsk me for a specific detail if you need it.`)
  // Belt-and-braces: no full number can survive even if a title/summary held one.
  return stripLongDigits(lines.join('\n'))
}

// Explicit single-field answer for a sensitive doc: returns ONLY the requested
// field, nothing else. WhatsApp has no second factor, so the protections are (1)
// one field not the blob and (2) this audit log — never a confirmation prompt.
function buildSensitiveFieldReply(
  telegramId: number,
  doc: any,
  requested: { keys: string[]; label: string },
): string | null {
  const val = fieldFromDoc(doc, requested.keys)
  if (!val) return null
  console.log('[asset-memory] AUDIT sensitive_field_access', {
    telegramId,
    docId: doc?.id,
    field: requested.label,
  })
  return `${requested.label}: ${val}`
}

// Non-sensitive documents (invoice / generic / ticket notes): safe to show the
// masked-at-save summary and the file. Never used for sensitive assets.
async function buildAssetFileReply(telegramId: number, doc: any, requested?: { keys: string[]; label: string } | null): Promise<string> {
  const lines: string[] = [`📎 ${doc.title || 'Document'}`]
  if (doc.summary) lines.push(doc.summary)

  if (requested) {
    const val = fieldFromDoc(doc, requested.keys)
    if (val) lines.push(`\n${requested.label}: ${val}`)
    else lines.push(`\nI don't have the ${requested.label.toLowerCase()} on file for this one.`)
  }

  if (doc.storage_path) {
    const url = await getDocumentSignedUrl(doc.storage_path, 600)
    if (url) lines.push(`\nOriginal file: ${url}\n_link valid ~10 min_`)
  }
  return lines.join('\n')
}

/**
 * Answer a retrieval request from stored documents. Semantic match over the
 * documents-only slice of memory_embeddings; CLAIMS the turn only if a hit clears
 * the score floor — otherwise returns null so the caller falls through unchanged.
 */
export async function buildAssetRetrievalReply(telegramId: number, text: string, messageId?: string | null): Promise<string | null> {
  try {
    const embedding = await embedText(text)
    const { data: hits } = await supabaseAdmin.rpc('match_documents', {
      p_telegram_id: telegramId,
      p_query: embedding,
      p_k: 3,
    })
    const top = ((hits || []) as any[]).filter((h) => (h.score ?? 0) >= 0.2)[0]
    if (!top) return null
    const doc = await fetchDocumentById(telegramId, String(top.source_id))
    if (!doc) return null
    // Remember this asset so an immediate field follow-up resolves to it. Keyed to the
    // retrieval message id (Case 5) and read back under a strict, fail-closed TTL.
    await saveFollowupState(telegramId, 'last_asset', {
      docId: doc.id,
      messageId: messageId ?? null,
      source: 'retrieval',
    })

    const sensitive = doc?.extracted?.privacyClass === 'sensitive'
    const requested = requestedField(text)
    if (sensitive) {
      // Explicit single-field request → ONLY that field (logged). Otherwise the masked
      // default: title, type, expiry, masked identifier, file link, hint. Sensitive
      // retrieval ALWAYS claims the turn here so it can never fall through to the
      // freeform path (which is what dumped full passport/DOB/birthplace into chat).
      if (requested) {
        const only = buildSensitiveFieldReply(telegramId, doc, requested)
        if (only) return only
        return `I don't have the ${requested.label.toLowerCase()} on file for this one.`
      }
      return await buildMaskedSensitiveReply(doc)
    }
    return buildAssetFileReply(telegramId, doc, requested)
  } catch (err: any) {
    console.error('[asset-memory] retrieval failed (non-fatal):', err?.message || err)
    return null
  }
}

/**
 * Field follow-up with no asset named ("what was the reference number?"). Only
 * fires when a fresh last_asset context exists; otherwise returns null so the
 * message falls through to normal handling. This is the context-gated companion
 * to the shape-gated buildAssetRetrievalReply.
 */
export async function buildAssetFieldReply(telegramId: number, text: string): Promise<string | null> {
  const req = requestedField(text)
  if (!req) return null
  // Must be a bare field question (no asset noun) — otherwise let retrieval handle it.
  if (isAssetRetrievalCommand(text)) return null
  const state = await getLatestFollowupState(telegramId, 'last_asset')
  // Strict, fail-CLOSED freshness (Case 5): only the CURRENT last_asset, and only within
  // the window, may answer. A missing/old/unparseable timestamp expires the binding, so
  // "this"/a bare field question can never silently resolve to an unrelated older asset.
  if (!state || !isStrictlyFreshFollowupState(state, 15) || !state.payload?.docId) return null
  const doc = await fetchDocumentById(telegramId, String(state.payload.docId))
  if (!doc) return null
  const val = fieldFromDoc(doc, req.keys)
  if (!val) return null
  // Return ONLY the requested field. Audit the access (no confirmation prompt — see Case 3).
  if (doc?.extracted?.privacyClass === 'sensitive') {
    console.log('[asset-memory] AUDIT sensitive_field_access', { telegramId, docId: doc.id, field: req.label })
  }
  return `${req.label}: ${val}`
}
