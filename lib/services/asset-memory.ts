/**
 * Asset Memory — unified save + retrieve for WhatsApp images/screenshots/PDFs.
 *
 * Pass 2 adds natural two-turn save flows (command→media and media→command),
 * evidence-first receipt/estimate classification, generic explicit saves, metadata
 * retrieval, and safe upgrading of a legacy documents row when the same inbound
 * media is explicitly saved a moment later.
 *
 * Privacy invariants:
 *  1. Sensitive VALUES never reach memory_embeddings. Sensitive assets index
 *     labels/field names only; values remain in documents.extracted.
 *  2. Default sensitive retrieval is masked and never renders extracted wholesale.
 *  3. Passwords/PINs/OTPs/CVVs/API keys/tokens are never revealed from this flow.
 */

import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { safeDocumentSummary, redactDocumentMetadata } from '@/lib/services/document-summary-privacy'
import { storeDocument, getDocumentSignedUrl } from '@/lib/services/document-store'
import { createDocumentShortLink, shortLinkUrl } from '@/lib/services/document-links'
import { embedText } from '@/lib/services/embeddings'
import { indexMemory } from '@/lib/services/memory-index'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'
import {
  saveFollowupState,
  getLatestFollowupState,
  isStrictlyFreshFollowupState,
  clearFollowupState,
} from '@/lib/bot/handlers/followup-state'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export type AssetType =
  | 'payment_proof'
  | 'passport'
  | 'id_document'
  | 'receipt'
  | 'order_estimate'
  | 'invoice'
  | 'generic_document'
  | 'generic_image'
  | 'business_card'

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

// These are still auto-saved when confidently detected, preserving Pass 1.
// Business cards are saved too: a contact is only useful if it can be found again later.
const AUTO_SAVE_TYPES: AssetType[] = ['payment_proof', 'passport', 'id_document', 'business_card']

export function isStructuredAsset(t: AssetType): boolean {
  return AUTO_SAVE_TYPES.includes(t)
}

// ── Save-intent / two-turn state ──────────────────────────────────────────────

export function isExplicitAssetSaveCommand(text: string): boolean {
  const t = (text || '').toLowerCase().trim()
  if (!/^(save|remember|keep)\b/.test(t)) return false

  // Bare deictic requests are specifically the command→media UX.
  if (/^(?:save|remember|keep)\s+(?:this|that|it)\s*[.!?]*$/.test(t)) return true

  // Asset-shaped requests. Deliberately does NOT claim generic “save this as X”
  // because save-last-context owns that text/link workflow when no asset noun exists.
  return /\b(screenshot|image|photo|picture|document|pdf|file|passport|identity|\bid\b|licen[cs]e|payment|proof|receipt|invoice|estimate|estimation|quotation|quote|slip|bill|statement|agreement|contract|certificate|report|letter|warranty|prescription)\b/.test(t)
}

function cleanUserLabel(text: string | null | undefined): string | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  const cleaned = raw
    .replace(/^\s*(?:save|remember|keep)\s+(?:this|that|it)?\s*(?:as\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  return stripLongDigits(cleaned).slice(0, 180)
}

function userTagsFromLabel(label: string | null): string[] {
  if (!label) return []
  const stop = new Set(['save', 'remember', 'keep', 'this', 'that', 'it', 'as', 'the', 'a', 'an', 'my', 'our', 'please'])
  return Array.from(new Set(
    label.toLowerCase().split(/[^a-z0-9]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3 && !stop.has(x) && !/^\d+$/.test(x)),
  )).slice(0, 12)
}

export async function armPendingAssetSave(telegramId: number, commandText: string): Promise<void> {
  await clearFollowupState(telegramId, 'pending_asset_save')
  await saveFollowupState(telegramId, 'pending_asset_save', {
    commandText: String(commandText || '').slice(0, 500),
    oneNextMedia: true,
  })
}

async function rememberExactMedia(params: {
  telegramId: number
  mediaUrl: string
  contentType: string
  kind: 'image' | 'pdf'
  messageId?: string | null
  caption?: string
}): Promise<void> {
  // Case 5: never retain an ambiguous/stale “latest media” binding. The state is
  // replaced on every asset-capable media turn and is usable only with a real SID.
  await clearFollowupState(params.telegramId, 'last_asset_media')
  if (!params.messageId || !params.mediaUrl) return
  await saveFollowupState(params.telegramId, 'last_asset_media', {
    messageId: params.messageId,
    mediaUrl: params.mediaUrl,
    contentType: params.contentType,
    kind: params.kind,
    caption: String(params.caption || '').slice(0, 500),
  })
}

// ── Masking ───────────────────────────────────────────────────────────────────

export function maskNumber(value: string | null | undefined): string {
  const s = String(value || '').replace(/\s+/g, '').trim()
  if (!s) return ''
  if (s.length <= 4) return '••' + s.slice(-1)
  return s.slice(0, 3) + '••••' + s.slice(-1)
}

// Collapse identifier-like long digit runs. Commas/decimal punctuation intentionally
// break the run so ordinary money amounts such as ₹51,000 remain useful.
// A plain digit run with a money-style fraction ("29900.00") is an amount, not an identifier: card,
// account and passport numbers never carry ".00". Without this a bill's total showed as "••••.00".
function stripLongDigits(text: string): string {
  const source = String(text || '')
  return source.replace(/\d[\d\s-]{3,}\d/g, (run, offset: number) => {
    const after = source.slice(offset + run.length)
    return /^\.\d{1,2}(?!\d)/.test(after) && /^\d+$/.test(run) && run.length <= 9 ? run : '••••'
  })
}

export const __test_stripLongDigits = stripLongDigits

// ── Classification + extraction ──────────────────────────────────────────────

const CLASSIFY_SYSTEM =
  'You are AskGogo classifying and extracting structured data from a file a user sent on WhatsApp (a screenshot, photo, or PDF). Return ONLY valid JSON, no markdown, no prose. Classify from visual/document EVIDENCE, not merely from the user caption. The caption is a user label and may be wrong. Never invent values you cannot read — use null. For displayTitle and labelKeywords, never include full passport/ID/account/card numbers; those belong only in the raw fields object.'

const CLASSIFY_INSTRUCTION = `Classify this file into exactly one assetType and extract its details.

IMPORTANT: the file evidence wins over the user wording. In particular, do NOT call an estimate, quotation, order slip, pro-forma, amount-due screen, or unpaid invoice a payment_proof just because the user calls it a "payment screenshot". payment_proof requires evidence that payment/transfer actually completed.

assetType (choose one):
- "payment_proof": completed bank transfer / UPI / IMPS / NEFT / card payment / transaction confirmation, with evidence payment succeeded.
- "receipt": completed purchase receipt / paid merchant receipt, not merely an amount due.
- "order_estimate": quotation, estimate, order estimation slip, pro-forma, work order estimate, amount due / quotation without completed-payment evidence.
- "passport": a passport data page (any country).
- "id_document": national ID, driving licence, Aadhaar, PAN, voter ID, residence permit, etc.
- "invoice": invoice or bill requesting/recording payment, where it is not clearly a completed-payment receipt.
- "business_card": a visiting / business card (a person's name with their company, role and contact details).
- "generic_document": any other paperwork (lease, contract, letter, form, statement, report).
- "generic_image": a photo that is not primarily a document.

Return this exact JSON shape:
{
  "assetType": "<one of the above>",
  "displayTitle": "<clean short title. Never a long sentence. No full ID/account numbers.>",
  "fields": { <see per-type keys below; use null for anything not clearly visible> },
  "docDateISO": "<document date YYYY-MM-DD, or null>",
  "expiryISO": "<expiry/validity YYYY-MM-DD, or null>",
  "expiryHuman": "<expiry as written, e.g. '15 Jun 2027', or null>",
  "labelKeywords": [ "<NON-sensitive search labels: person, company, doc kind, bank, city — NEVER full numbers>" ]
}

Per-type fields:
- payment_proof: { "counterparty": , "amount": , "date": , "bank": , "method": , "reference_number": }
- receipt: { "merchant": , "amount": , "date": , "reference_number": , "summary": }
- order_estimate: { "vendor": , "customer": , "amount": , "date": , "reference_number": , "summary": }
- passport: { "name": , "passport_number": , "dob": , "issue_date": , "expiry_date": , "nationality": }
- id_document: { "name": , "document_kind": , "id_number": , "dob": , "expiry_date": }
- invoice: { "vendor": , "amount": , "date": , "reference_number": , "summary": }
- business_card: { "name": , "designation": , "company": , "phones": "<all phone/mobile numbers, comma-separated, as printed>", "emails": "<comma-separated>", "address": , "website": }
- generic_document / generic_image: { "title": , "summary": }

Reply with ONLY the JSON object.`

function parseJsonLoose(text: string): any | null {
  const clean = (text || '').replace(/```json|```/g, '').trim()
  if (!clean) return null
  try {
    return JSON.parse(clean)
  } catch {
    const m = clean.match(/\{[\s\S]*\}/)
    if (m) { try { return JSON.parse(m[0]) } catch { return null } }
    return null
  }
}

function toIsoOrNull(v: any): string | null {
  const s = String(v || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

export function normalizeExtraction(raw: any): AssetExtraction | null {
  if (!raw || typeof raw !== 'object') return null
  const assetType = String(raw.assetType || '').trim() as AssetType
  const allowed: AssetType[] = [
    'payment_proof', 'passport', 'id_document', 'receipt', 'order_estimate',
    'invoice', 'generic_document', 'generic_image', 'business_card',
  ]
  let assetType2 = assetType
  // Older prompts (and the occasional miss) call a visiting card a generic document.
  if ((assetType === 'generic_document' || assetType === 'generic_image') && isBusinessCardText(`${raw.displayTitle || ''} ${raw.fields?.title || ''} ${raw.fields?.summary || ''}`)) assetType2 = 'business_card'
  if (!allowed.includes(assetType2)) return null

  const privacyClass: 'sensitive' | 'normal' =
    ['passport', 'id_document', 'payment_proof'].includes(assetType2) ? 'sensitive' : 'normal'

  const fields: Record<string, string> = {}
  if (raw.fields && typeof raw.fields === 'object') {
    for (const [k, v] of Object.entries(raw.fields)) {
      if (v === null || v === undefined) continue
      const s = String(v).trim()
      if (s && s.toLowerCase() !== 'null') fields[k] = s
    }
  }

  const labelKeywords = Array.isArray(raw.labelKeywords)
    ? raw.labelKeywords
        .map((s: any) => String(s || '').trim())
        .filter(Boolean)
        .filter((s: string) => !/\d{4,}/.test(s))
        .slice(0, 20)
    : []

  if (assetType2 === 'business_card' && !fields.name) {
    // Recover the person from a generic extraction ("Business Card - Pradip Kumar, SkyHi Technologies").
    const m = String(raw.displayTitle || '').match(/(?:business|visiting)\s*card\s*[-–—:·]\s*([^,(]+?)(?:\s*[,(]\s*([^)]+)\)?)?$/i)
    if (m) { fields.name = m[1].trim(); if (m[2] && !fields.company) fields.company = m[2].trim() }
  }
  return {
    assetType: assetType2,
    privacyClass,
    displayTitle: (assetType2 === 'business_card' && fields.name ? `Business card · ${fields.name}${fields.company ? ` (${fields.company})` : ''}` : stripLongDigits(String(raw.displayTitle || '').trim())).slice(0, 200) || 'Document',
    fields,
    docDateISO: toIsoOrNull(raw.docDateISO),
    expiryISO: toIsoOrNull(raw.expiryISO),
    expiryHuman: raw.expiryHuman ? String(raw.expiryHuman).trim() : null,
    labelKeywords,
  }
}

function fallbackExtraction(kind: 'image' | 'pdf', userLabel: string | null): AssetExtraction {
  const assetType: AssetType = kind === 'pdf' ? 'generic_document' : 'generic_image'
  const title = userLabel || (kind === 'pdf' ? 'Saved Document' : 'Saved Image')
  return {
    assetType,
    privacyClass: 'normal',
    displayTitle: title.slice(0, 200),
    fields: { title },
    docDateISO: null,
    expiryISO: null,
    expiryHuman: null,
    labelKeywords: userTagsFromLabel(userLabel),
  }
}

async function fetchTwilioBase64(mediaUrl: string, contentType: string): Promise<{ b64: string; isPdf: boolean }> {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const res = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } })
  if (!res.ok) throw new Error(`Twilio fetch ${res.status}`)
  const b64 = Buffer.from(await res.arrayBuffer()).toString('base64')
  return { b64, isPdf: (contentType || '').toLowerCase().includes('pdf') }
}

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
      const dataUrl = await downloadTwilioMediaAsDataUrl({ mediaUrl: params.mediaUrl, contentType: params.contentType })
      const m = dataUrl.match(/^data:(.+?);base64,(.*)$/)
      if (!m) return null
      contentBlock = { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }
    }

    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      system: CLASSIFY_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          contentBlock,
          { type: 'text', text: `User label/caption (may be inaccurate): ${params.caption || 'none'}\n\n${CLASSIFY_INSTRUCTION}` },
        ],
      }],
    })
    const text = result.content[0]?.type === 'text' ? result.content[0].text : ''
    console.log('[asset-memory] classify raw:', text.slice(0, 300))
    return normalizeExtraction(parseJsonLoose(text))
  } catch (err: any) {
    console.error('[asset-memory] classify failed (non-fatal):', err?.message || err)
    return null
  }
}

// ── Save / confirmation ───────────────────────────────────────────────────────

function fmt(v?: string): string {
  return (v || '').trim()
}

function shortSafeSummary(value: string | undefined, max = 220): string {
  return stripLongDigits(fmt(value)).replace(/\s+/g, ' ').slice(0, max)
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
    return `✅ Saved payment proof${line2 ? `\n${line2}` : ''}${line3 ? `\n${line3}` : ''}\n\nI've saved the original screenshot and its details.${asks ? `\n\nYou can ask later:\n${asks}` : ''}`
  }

  if (ex.assetType === 'passport' || ex.assetType === 'id_document') {
    const isPassport = ex.assetType === 'passport'
    const who = fmt(f.name) || 'the holder'
    const kind = isPassport ? `${fmt(f.nationality)} Passport`.trim() : (fmt(f.document_kind) || 'ID document')
    const expiry = ex.expiryHuman || fmt(f.expiry_date)
    const line2 = [kind, expiry ? `expires ${expiry}` : ''].filter(Boolean).join(' · ')
    const label = isPassport ? `${who}'s Passport` : `${who}'s ${kind}`
    const asks = [
      `- "Show me ${fmt(f.name) || who} ${isPassport ? 'passport' : 'ID'}"`,
      expiry ? `- "When does ${fmt(f.name) || who} ${isPassport ? 'passport' : 'ID'} expire?"` : null,
      `- "Send me the original ${isPassport ? 'passport' : 'ID'} file"`,
    ].filter(Boolean).join('\n')
    return `✅ Saved — ${label}${line2 ? `\n${line2}` : ''}\n\nI've securely saved the original file and the details.\n\nYou can ask later:\n${asks}`
  }

  if (ex.assetType === 'business_card') return `${businessCardLines(f, `📇 Saved ${fmt(f.name) ? `${fmt(f.name)}'s card` : 'business card'}`)}\n\nI've kept the original too. Ask anytime, e.g. "${fmt(f.name) || 'their'}${fmt(f.name) ? "'s" : ''} number" or "show me ${fmt(f.name) || 'that'} card".`

  const noun: Record<string, string> = {
    receipt: 'receipt',
    order_estimate: 'order estimate',
    invoice: 'invoice',
    generic_document: 'document',
    generic_image: 'image',
  }
  const summary = shortSafeSummary(f.summary)
  return (
    `✅ Saved ${noun[ex.assetType] || 'file'}\n${ex.displayTitle}` +
    (summary && summary.toLowerCase() !== ex.displayTitle.toLowerCase() ? `\n${summary}` : '') +
    `\n\nI've saved the original file so you can ask for it later.`
  )
}

function buildIndexLabels(ex: AssetExtraction, userLabel: string | null): string {
  const fieldLabels = Object.keys(ex.fields)
    .filter((k) => !['summary', 'title'].includes(k))
    .map((k) => k.replace(/_/g, ' '))
  const safeNormalSummary = ex.privacyClass === 'normal'
    ? shortSafeSummary(ex.fields.summary || ex.fields.title, 300)
    : ''
  const parts = [
    ex.displayTitle,
    ex.assetType.replace(/_/g, ' '),
    ...ex.labelKeywords,
    ...userTagsFromLabel(userLabel),
    userLabel || '',
    safeNormalSummary,
    fieldLabels.length ? `fields on file: ${fieldLabels.join(', ')}` : '',
  ].filter(Boolean)
  return stripLongDigits(parts.join(' · ')).slice(0, 900)
}

function buildStoredSummary(ex: AssetExtraction): string {
  const f = ex.fields
  if (ex.assetType === 'payment_proof') {
    return stripLongDigits([fmt(f.counterparty), fmt(f.amount), fmt(f.date), fmt(f.method), fmt(f.bank)].filter(Boolean).join(' · '))
  }
  if (ex.assetType === 'passport' || ex.assetType === 'id_document') {
    const kind = ex.assetType === 'passport' ? `${fmt(f.nationality)} Passport`.trim() : fmt(f.document_kind)
    const expiry = ex.expiryHuman || fmt(f.expiry_date)
    return stripLongDigits([fmt(f.name), kind, expiry ? `expires ${expiry}` : ''].filter(Boolean).join(' · '))
  }
  if (ex.assetType === 'business_card') {
    return ['Business card', fmt(f.name), fmt(f.designation), fmt(f.company), fmt(f.address)].filter(Boolean).join(' · ')
  }
  if (ex.assetType === 'receipt') {
    return stripLongDigits([fmt(f.merchant), fmt(f.amount), fmt(f.date), shortSafeSummary(f.summary, 240)].filter(Boolean).join(' · '))
  }
  if (ex.assetType === 'order_estimate') {
    return stripLongDigits([fmt(f.vendor), fmt(f.customer), fmt(f.amount), fmt(f.date), shortSafeSummary(f.summary, 240)].filter(Boolean).join(' · '))
  }
  if (ex.assetType === 'invoice') {
    return stripLongDigits([fmt(f.vendor), fmt(f.amount), fmt(f.date), shortSafeSummary(f.summary, 240)].filter(Boolean).join(' · '))
  }
  return shortSafeSummary(f.summary || f.title || ex.displayTitle, 500)
}

async function findDocumentByMessageId(telegramId: number, messageId: string | null | undefined): Promise<any | null> {
  if (!messageId) return null
  const { data } = await supabaseAdmin
    .from('documents')
    .select('id, storage_path, source_message_id')
    .eq('telegram_id', telegramId)
    .eq('source_message_id', messageId)
    .maybeSingle()
  return data || null
}

async function upgradeExistingDocument(params: {
  telegramId: number
  docId: string
  ex: AssetExtraction
  userLabel: string | null
}): Promise<boolean> {
  const extracted = {
    assetType: params.ex.assetType,
    detectedAssetType: params.ex.assetType,
    privacyClass: params.ex.privacyClass,
    masked: params.ex.privacyClass === 'sensitive',
    userLabel: params.userLabel,
    userTags: userTagsFromLabel(params.userLabel),
    fields: params.ex.fields,
    expiryHuman: params.ex.expiryHuman,
  }
  const { error } = await supabaseAdmin
    .from('documents')
    .update({
      doc_type: params.ex.assetType,
      title: redactDocumentMetadata(params.ex.displayTitle).slice(0, 300),
      summary: safeDocumentSummary(buildStoredSummary(params.ex), params.ex.assetType, extracted).slice(0, 4000),
      extracted,
      doc_date: params.ex.docDateISO,
      expires_on: params.ex.expiryISO,
    })
    .eq('telegram_id', params.telegramId)
    .eq('id', params.docId)

  if (error) {
    console.error('[asset-memory] legacy row upgrade failed:', error.message)
    return false
  }

  // Crucial for media→command: replace the legacy OCR-heavy embedding with the
  // safe Pass-2 index for the SAME documents source id.
  await indexMemory({
    telegramId: params.telegramId,
    sourceId: params.docId,
    sourceTable: 'documents',
    content: buildIndexLabels(params.ex, params.userLabel),
  })
  return true
}

export async function saveAssetMemory(params: {
  telegramId: number
  ex: AssetExtraction
  messageId?: string | null
  userLabel?: string | null
  file: { mediaUrl: string; accountSid: string; authToken: string; contentType: string }
}): Promise<{ reply: string } | null> {
  const { ex } = params
  const userLabel = cleanUserLabel(params.userLabel)
  try {
    // If this media was already stored by the legacy note path (media first, save
    // command second), upgrade that exact row instead of fighting the unique
    // source_message_id constraint or creating a parallel document.
    const existing = await findDocumentByMessageId(params.telegramId, params.messageId)
    let docId: string | null = null

    if (existing?.id) {
      const upgraded = await upgradeExistingDocument({
        telegramId: params.telegramId,
        docId: String(existing.id),
        ex,
        userLabel,
      })
      if (!upgraded) return null
      docId = String(existing.id)
    } else {
      const stored = await storeDocument({
        telegramId: params.telegramId,
        docType: ex.assetType,
        docAction: 'document_save',
        title: ex.displayTitle,
        summary: buildStoredSummary(ex),
        extracted: {
          assetType: ex.assetType,
          detectedAssetType: ex.assetType,
          privacyClass: ex.privacyClass,
          masked: ex.privacyClass === 'sensitive',
          userLabel,
          userTags: userTagsFromLabel(userLabel),
          fields: ex.fields,
          expiryHuman: ex.expiryHuman,
        },
        indexContent: buildIndexLabels(ex, userLabel),
        docDate: ex.docDateISO,
        expiresOn: ex.expiryISO,
        messageId: params.messageId ?? null,
        file: params.file,
      })
      if (stored.id) docId = stored.id
      if (stored.duplicate && params.messageId) {
        const dup = await findDocumentByMessageId(params.telegramId, params.messageId)
        if (dup?.id) {
          const upgraded = await upgradeExistingDocument({
            telegramId: params.telegramId,
            docId: String(dup.id),
            ex,
            userLabel,
          })
          if (upgraded) docId = String(dup.id)
        }
      }
    }

    if (docId) {
      await clearFollowupState(params.telegramId, 'last_asset')
      await saveFollowupState(params.telegramId, 'last_asset', {
        docId,
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
  // Always retain an exact, short-lived reference for media→command. Generic media
  // falls through today, but the next “save this …” can bind to this exact SID.
  await rememberExactMedia(params)

  const directExplicit = isExplicitAssetSaveCommand(params.caption || '')
  const pending = await getLatestFollowupState(params.telegramId, 'pending_asset_save')
  const pendingFresh = Boolean(pending && isStrictlyFreshFollowupState(pending, 10))
  if (pending && !pendingFresh) await clearFollowupState(params.telegramId, 'pending_asset_save')

  // One-next-media semantics: consume the pending command as soon as an asset-capable
  // media turn reaches this handler, whether classification succeeds or falls back.
  const pendingText = pendingFresh ? String(pending?.payload?.commandText || '') : ''
  if (pendingFresh) await clearFollowupState(params.telegramId, 'pending_asset_save')

  const explicitSave = directExplicit || pendingFresh
  const effectiveLabel = directExplicit ? String(params.caption || '') : pendingText
  let ex = await classifyAndExtractAsset({
    mediaUrl: params.mediaUrl,
    contentType: params.contentType,
    kind: params.kind,
    caption: effectiveLabel || params.caption,
  })

  // Explicit save must never fall back into an OCR dump merely because vision JSON
  // failed. Preserve the original as a generic asset with the user's label instead.
  if (!ex && explicitSave) ex = fallbackExtraction(params.kind, cleanUserLabel(effectiveLabel))
  if (!ex) return null
  if (!isStructuredAsset(ex.assetType) && !explicitSave) return null

  const saved = await saveAssetMemory({
    telegramId: params.telegramId,
    ex,
    messageId: params.messageId ?? null,
    userLabel: effectiveLabel || null,
    file: {
      mediaUrl: params.mediaUrl,
      accountSid: params.accountSid,
      authToken: params.authToken,
      contentType: params.contentType,
    },
  })

  if (saved) await clearFollowupState(params.telegramId, 'last_asset_media')
  return saved
}

function safeAlreadySavedTitle(doc: any): string {
  if (!isSensitiveDoc(doc)) return String(doc?.title || 'Document').slice(0, 200)
  const f = (doc?.extracted?.fields || {}) as Record<string, string>
  const kind = deriveAssetKind(doc)
  const name = fmt(f.name) || fmt(f.counterparty)
  const noun = kind === 'passport' ? 'Passport' : kind === 'id_document' ? (fmt(f.document_kind) || 'ID') : 'Payment proof'
  return name ? `${name}'s ${noun}` : noun
}

/** Resolve a save command to the exact immediately preceding media, without resend. */
export async function saveRecentMediaAsAsset(telegramId: number, text: string): Promise<{ reply: string } | null> {
  if (!isExplicitAssetSaveCommand(text)) return null

  const state = await getLatestFollowupState(telegramId, 'last_asset_media')
  if (state && isStrictlyFreshFollowupState(state, 10)) {
    const p = state.payload || {}
    if (p.messageId && p.mediaUrl && (p.kind === 'image' || p.kind === 'pdf')) {
      let ex = await classifyAndExtractAsset({
        mediaUrl: String(p.mediaUrl),
        contentType: String(p.contentType || ''),
        kind: p.kind,
        caption: text,
      })
      if (!ex) ex = fallbackExtraction(p.kind, cleanUserLabel(text))
      const saved = await saveAssetMemory({
        telegramId,
        ex,
        messageId: String(p.messageId),
        userLabel: text,
        file: {
          mediaUrl: String(p.mediaUrl),
          accountSid: process.env.TWILIO_ACCOUNT_SID || '',
          authToken: process.env.TWILIO_AUTH_TOKEN || '',
          contentType: String(p.contentType || ''),
        },
      })
      if (saved) await clearFollowupState(telegramId, 'last_asset_media')
      return saved
    }
  } else if (state) {
    await clearFollowupState(telegramId, 'last_asset_media')
  }

  // A passport/payment proof may have been auto-saved on the media turn already.
  // Treat an immediate redundant “save Srini passport” naturally instead of arming
  // a new pending command that would bind to the NEXT unrelated photo.
  const lastAsset = await getLatestFollowupState(telegramId, 'last_asset')
  if (lastAsset && isStrictlyFreshFollowupState(lastAsset, 10) && lastAsset.payload?.docId && lastAsset.payload?.source === 'save') {
    const doc = await fetchDocumentById(telegramId, String(lastAsset.payload.docId))
    if (doc) return { reply: `✅ Already saved — ${safeAlreadySavedTitle(doc)}` }
  }

  return null
}

// ── Retrieval ────────────────────────────────────────────────────────────────

export function isAssetRetrievalCommand(text: string): boolean {
  const t = (text || '').toLowerCase().trim()
  const verb = /\b(show me|find|send me|get me|pull up|do you have|where'?s|where is|open the|retrieve)\b/.test(t)
  const fieldQuestion = /\b(what(?:'s| is)|when does|when is|expiry|expire|reference|transaction\s*id|utr|amount|how much|nationality)\b/.test(t)
  const noun = /\b(passport|payment|proof|screenshot|receipt|invoice|estimate|estimation|quotation|slip|document|pdf|file|id|licen[cs]e|statement|policy|aadhaar|pan|lease|agreement|contract|bill|certificate|report|letter|warranty|prescription)\b/.test(t)
  if (noun && (verb || fieldQuestion)) return true
  return isTicketRetrievalAsk(t)
}

// 19 Oct live: "Jailer qr code" fell through to general chat, which said "I don't have a QR code saved" although
// the ticket screenshot (QR, Audi 04, K18–K20, TSAJKDX) was saved the day before. A short ask naming a ticket,
// QR or pass is a retrieval, unless it is about booking, buying or cancelling one.
const TICKET_NOUN = /\b(?:tickets?|qr(?:\s*code)?|boarding\s*pass|e-?tickets?|m-?tickets?|booking\s+confirmation)\b/i
export function isTicketRetrievalAsk(text: string): boolean {
  const t = String(text || '').toLowerCase().trim()
  if (!TICKET_NOUN.test(t)) return false
  if (/\b(?:book|buy|purchase|reserve|cancel|refund|price|cost|how much|available|availability|get\s+tickets?\s+for)\b/.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean).length
  const verb = /\b(show|send|share|give|find|get|pull up|open|where'?s|where is|need|my)\b/.test(t)
  return words <= 6 || verb
}

/** Extra metadata score for a saved ticket when the ask names a ticket/QR (title token alone scores only 1). */
export function ticketDocumentBoost(query: string, doc: { title?: string | null; summary?: string | null; doc_type?: string | null; extracted?: any }): number {
  if (!TICKET_NOUN.test(String(query || ''))) return 0
  const hay = `${doc?.title || ''} ${doc?.summary || ''} ${doc?.doc_type || ''} ${JSON.stringify(doc?.extracted || {})}`.toLowerCase()
  return /\b(?:ticket|tickets|qr|barcode|booking id|seats?|audi|screen|boarding pass|pnr|showtime|cinema|movie)\b/.test(hay) ? 2 : 0
}

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

const NEVER_REVEAL_RE = /\b(password|passcode|\bpin\b|otp|one[\s-]?time\s*password|cvv|cvc|api[\s_-]?key|auth(?:entication)?\s*token|access\s*token|secret(?:\s*key)?)\b/i

function isVagueIdentifierRequest(text: string): boolean {
  return /^\s*(?:what(?:'s|\s+is)|give\s+me|tell\s+me|show\s+me|reveal)\s+(?:the\s+)?(?:number|value|it)\s*[?.!]*\s*$/i.test(text || '')
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

const SENSITIVE_FIELD_KEYS = [
  'passport_number', 'id_number', 'aadhaar', 'aadhar', 'pan', 'pan_number',
  'account_number', 'card_number', 'licence_number', 'license_number', 'national_id',
]

const SENSITIVE_TITLE_RE =
  /\b(passport|aadhaar|aadhar|pan\s*card|driving\s*licen[cs]e|driver'?s\s*licen[cs]e|identity\s*card|national\s*id(?:entity)?|government\s*id|govt\s*id|voter\s*id|residence\s*permit|bank\s*statement|account\s*statement|financial\s*account)\b/i

function deriveAssetKind(doc: any): 'passport' | 'id_document' | 'payment_proof' | 'other' {
  const ex = (doc?.extracted || {}) as any
  const explicit = String(ex.assetType || ex.detectedAssetType || '')
  if (explicit === 'passport' || explicit === 'id_document' || explicit === 'payment_proof') return explicit
  // Explicit receipt/estimate/invoice must NOT be collapsed back into payment_proof.
  if (['receipt', 'order_estimate', 'invoice'].includes(explicit)) return 'other'

  const hay = `${doc?.title || ''} ${doc?.doc_type || ''}`.toLowerCase()
  const keys = Object.keys(ex.fields || {}).map((k) => k.toLowerCase())
  if (/passport/.test(hay) || keys.includes('passport_number')) return 'passport'
  if (/payment\s*proof|transfer|\bupi\b|\bimps\b|\bneft\b|transaction\s*confirmation/.test(hay)) return 'payment_proof'
  if (
    /aadhaar|aadhar|pan\s*card|driving\s*licen|driver'?s\s*licen|identity\s*card|national\s*id|government\s*id|govt\s*id|voter\s*id|residence\s*permit/.test(hay) ||
    keys.some((k) => ['id_number', 'aadhaar', 'aadhar', 'pan', 'pan_number', 'national_id', 'licence_number', 'license_number', 'card_number', 'account_number'].includes(k))
  ) return 'id_document'
  return 'other'
}

function isSensitiveDoc(doc: any): boolean {
  const ex = (doc?.extracted || {}) as any
  if (ex.privacyClass === 'sensitive') return true
  if (['passport', 'id_document', 'payment_proof'].includes(String(ex.assetType || ''))) return true
  if (SENSITIVE_TITLE_RE.test(`${doc?.title || ''} ${doc?.doc_type || ''}`)) return true
  const keys = Object.keys(ex.fields || {}).map((k) => k.toLowerCase())
  return keys.some((k) => SENSITIVE_FIELD_KEYS.includes(k))
}

function primaryIdentifierRequest(doc: any): { keys: string[]; label: string } | null {
  const kind = deriveAssetKind(doc)
  if (kind === 'passport') return { keys: ['passport_number'], label: 'Passport number' }
  if (kind === 'id_document') return { keys: ['id_number'], label: 'ID number' }
  if (kind === 'payment_proof') return { keys: ['reference_number'], label: 'Reference number' }
  return null
}

function sensitiveOwnerLabel(doc: any): string {
  const f = (doc?.extracted?.fields || {}) as Record<string, string>
  const name = fmt(f.name) || fmt(f.counterparty)
  if (name) return `${name}'s`
  const kind = deriveAssetKind(doc)
  if (kind === 'passport') return `This passport's`
  if (kind === 'id_document') return `This ID's`
  return `This document's`
}

async function gateSensitiveFieldRequest(
  telegramId: number,
  doc: any,
  requested: { keys: string[]; label: string },
): Promise<string> {
  if (NEVER_REVEAL_RE.test(requested.label) || requested.keys.some((k) => NEVER_REVEAL_RE.test(k))) {
    await clearFollowupState(telegramId, 'pending_field_reveal')
    return `🔒 I can't reveal ${requested.label.toLowerCase()} in chat.`
  }

  await clearFollowupState(telegramId, 'pending_field_reveal')
  await saveFollowupState(telegramId, 'pending_field_reveal', {
    docId: String(doc.id),
    fieldKeys: requested.keys,
    label: requested.label,
  })
  const confirm = `show ${requested.label.toLowerCase()}`
  return `🔒 ${sensitiveOwnerLabel(doc)} ${requested.label.toLowerCase()} is sensitive. Reply "${confirm}" to reveal it here.`
}

async function buildAssetRevealConfirmation(telegramId: number, text: string): Promise<string | null> {
  const pending = await getLatestFollowupState(telegramId, 'pending_field_reveal')
  if (!pending) return null
  if (!isStrictlyFreshFollowupState(pending, 2)) {
    await clearFollowupState(telegramId, 'pending_field_reveal')
    return null
  }

  const requested = requestedField(text)
  const explicitReveal = /^\s*(?:show|reveal)\b/i.test(text || '')
  const payload = pending.payload || {}
  const pendingKeys = Array.isArray(payload.fieldKeys) ? payload.fieldKeys.map(String) : []
  const pendingLabel = String(payload.label || '')
  const fieldMatches = requested && requested.label.toLowerCase() === pendingLabel.toLowerCase()
  if (!explicitReveal || !fieldMatches || !payload.docId || !pendingKeys.length) return null

  await clearFollowupState(telegramId, 'pending_field_reveal')
  if (NEVER_REVEAL_RE.test(pendingLabel) || pendingKeys.some((k) => NEVER_REVEAL_RE.test(k))) {
    return `🔒 I can't reveal ${pendingLabel.toLowerCase()} in chat.`
  }

  const doc = await fetchDocumentById(telegramId, String(payload.docId))
  if (!doc || !isSensitiveDoc(doc)) return `I can't safely resolve that sensitive detail anymore.`
  const val = fieldFromDoc(doc, pendingKeys)
  if (!val) return `I don't have the ${pendingLabel.toLowerCase()} stored as a structured field. Open the original file instead.`

  console.log('[asset-memory] AUDIT sensitive_field_access', { telegramId, docId: doc?.id, field: pendingLabel })
  return `${pendingLabel}: ${val}`
}

function maskedIdentifierLine(doc: any): string | null {
  const f = (doc?.extracted?.fields || {}) as Record<string, string>
  if (f.passport_number) return `Passport no. ${maskNumber(f.passport_number)}`
  if (f.id_number) return `ID no. ${maskNumber(f.id_number)}`
  if (f.account_number) return `A/c ${maskNumber(f.account_number)}`
  if (f.reference_number) return `Ref. ${maskNumber(f.reference_number)}`
  return null
}

async function buildOriginalFileLink(telegramId: number, doc: any, sensitive: boolean): Promise<string | null> {
  if (!doc?.storage_path) return null
  const token = await createDocumentShortLink({ telegramId, documentId: String(doc.id), sensitive })
  if (token) return `Open original: ${shortLinkUrl(token)}`
  const url = await getDocumentSignedUrl(doc.storage_path, 120)
  return url ? `Open original: ${url}` : null
}

async function buildMaskedSensitiveReply(telegramId: number, doc: any): Promise<string> {
  const ex = (doc?.extracted || {}) as any
  const f = (ex.fields || {}) as Record<string, string>
  const kind = deriveAssetKind(doc)
  const kindNoun = kind === 'passport'
    ? 'Passport'
    : kind === 'id_document'
      ? (fmt(f.document_kind) || 'ID')
      : kind === 'payment_proof'
        ? 'Payment proof'
        : 'Document'

  const name = fmt(f.name) || fmt(f.counterparty)
  const displayTitle = name ? `${name}'s ${kindNoun}` : kindNoun
  let typeLabel = ''
  if (kind === 'passport') typeLabel = [fmt(f.nationality), 'Passport'].filter(Boolean).join(' ')
  else if (kind === 'id_document') typeLabel = fmt(f.document_kind) || 'ID document'
  else if (kind === 'payment_proof') typeLabel = 'Payment proof'
  const expiry = ex.expiryHuman || fmt(f.expiry_date)
  const line2 = [typeLabel, expiry ? `expires ${expiry}` : ''].filter(Boolean).join(' · ')

  const lines: string[] = [`📄 ${displayTitle}`]
  if (line2 && line2 !== displayTitle) lines.push(line2)
  const idLine = maskedIdentifierLine(doc)
  if (idLine) lines.push(idLine)
  lines.push(`\nYou can ask for a specific non-secret detail.`)

  let out = stripLongDigits(lines.join('\n'))
  const link = await buildOriginalFileLink(telegramId, doc, true)
  if (link) out += `\n\n${link}`
  return out
}

// Documents saved before decimal amounts were exempt from digit masking carry "••••.00" in their
// stored summary. The extracted fields are still on file, so rebuild the line from them at read time.
const AMOUNT_BEARING_TYPES = ['invoice', 'receipt', 'order_estimate', 'payment_proof']
export function refreshedStoredSummary(doc: any): string {
  const stored = String(doc?.summary || '')
  const ex = doc?.extracted
  if (!stored.includes('••••.') || !ex?.fields || ex.privacyClass === 'sensitive' || !AMOUNT_BEARING_TYPES.includes(String(ex.assetType || doc?.doc_type || ''))) return stored
  try {
    const rebuilt = buildStoredSummary({ assetType: ex.assetType || doc.doc_type, fields: ex.fields, displayTitle: String(doc?.title || ''), expiryHuman: ex.expiryHuman } as any)
    return rebuilt || stored
  } catch { return stored }
}

async function buildAssetFileReply(
  telegramId: number,
  doc: any,
  requested?: { keys: string[]; label: string } | null,
): Promise<string> {
  const isCard = String(doc?.extracted?.assetType || doc?.doc_type || '') === 'business_card'
  const lines: string[] = isCard
    ? [businessCardLines((doc?.extracted?.fields || {}) as Record<string, string>, `📇 ${doc.title || 'Business card'}`)]
    : [`📎 ${doc.title || 'Document'}`]
  const shownSummary = isCard ? '' : refreshedStoredSummary(doc)
  if (shownSummary) lines.push(shownSummary)
  if (requested && !isCard) {
    const val = fieldFromDoc(doc, requested.keys)
    if (val) lines.push(`\n${requested.label}: ${val}`)
    else lines.push(`\nI don't have the ${requested.label.toLowerCase()} on file for this one.`)
  }
  const link = await buildOriginalFileLink(telegramId, doc, false)
  if (link) lines.push(`\n${link}`)
  return lines.join('\n')
}

// ── Metadata-assisted document matching ──────────────────────────────────────

function normalizeWords(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function onlyDigits(s: string): string {
  return String(s || '').replace(/\D/g, '')
}

async function findDocumentByMetadata(telegramId: number, text: string): Promise<any | null> {
  const { data } = await supabaseAdmin
    .from('documents')
    .select('id, doc_type, title, summary, extracted, storage_path, created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (!data?.length) return null

  const q = normalizeWords(text)
  const qDigits = onlyDigits(text)
  let best: any | null = null
  let bestScore = 0

  for (const doc of data as any[]) {
    const ex = doc.extracted || {}
    const f = (ex.fields || {}) as Record<string, string>
    let score = 0

    // Strong private-field matches allow amount/date/reference/person retrieval
    // without ever putting those values into memory_embeddings.
    for (const [key, raw] of Object.entries(f)) {
      const value = String(raw || '').trim()
      if (!value) continue
      const words = normalizeWords(value)
      const digits = onlyDigits(value)
      if (words.length >= 3 && q.includes(words)) {
        score += ['name', 'counterparty', 'merchant', 'vendor', 'customer'].includes(key) ? 5 : 3
      }
      if (digits.length >= 3 && qDigits.includes(digits)) score += 5
    }

    const titleTokens = normalizeWords(String(doc.title || '')).split(' ').filter((x) => x.length >= 3)
    const titleHits = titleTokens.filter((x) => q.includes(x)).length
    score += Math.min(titleHits, 3)

    const userLabel = normalizeWords(String(ex.userLabel || ''))
    if (userLabel && q.includes(userLabel)) score += 3
    const tags = Array.isArray(ex.userTags) ? ex.userTags.map(String) : []
    score += Math.min(tags.filter((x: string) => x.length >= 3 && q.includes(normalizeWords(x))).length, 2)

    const type = String(ex.assetType || doc.doc_type || '').replace(/_/g, ' ')
    if (type && q.includes(normalizeWords(type))) score += 2
    score += ticketDocumentBoost(text, doc)

    if (score > bestScore) {
      bestScore = score
      best = doc
    }
  }

  return bestScore >= 3 ? best : null
}

export async function buildAssetRetrievalReply(
  telegramId: number,
  text: string,
  messageId?: string | null,
): Promise<string | null> {
  try {
    // Metadata first handles searches by amount/reference/date/person while keeping
    // those values out of the embedding index. Semantic search remains the fallback.
    let doc = await findDocumentByMetadata(telegramId, text)
    if (!doc) {
      const embedding = await embedText(text)
      const { data: hits } = await supabaseAdmin.rpc('match_documents', {
        p_telegram_id: telegramId,
        p_query: embedding,
        p_k: 3,
      })
      const top = ((hits || []) as any[]).filter((h) => (h.score ?? 0) >= 0.2)[0]
      if (!top) return null
      doc = await fetchDocumentById(telegramId, String(top.source_id))
    }
    if (!doc) return null

    await clearFollowupState(telegramId, 'last_asset')
    await saveFollowupState(telegramId, 'last_asset', {
      docId: doc.id,
      messageId: messageId ?? null,
      source: 'retrieval',
    })

    const sensitive = isSensitiveDoc(doc)
    const requested = requestedField(text)
    if (sensitive) {
      if (requested) return await gateSensitiveFieldRequest(telegramId, doc, requested)
      return await buildMaskedSensitiveReply(telegramId, doc)
    }
    return buildAssetFileReply(telegramId, doc, requested)
  } catch (err: any) {
    console.error('[asset-memory] retrieval failed (non-fatal):', err?.message || err)
    return null
  }
}

// ── Ticket / QR retrieval through the saved booking ─────────────────────────
// 19 Oct live (after #679): "Jailer qr code" was a retrieval ask, but no `documents` row matched by
// title or embedding, so it fell through to general chat. The verified ticket screenshot is attached
// to the saved booking itself: booking-screenshot-worker and booking-closure write
// life_events.metadata_json.credential.documentId (and screenshotEvidence / a ticket source_ref).
// "<event> qr code / ticket" now finds the booking by name, then sends that exact document.

const TICKET_QUERY_STOP = new Set(['ticket', 'tickets', 'code', 'boarding', 'pass', 'eticket', 'mticket', 'etickets', 'mtickets', 'booking', 'confirmation', 'show', 'send', 'share', 'give', 'find', 'get', 'pull', 'open', 'where', 'need', 'the', 'for', 'please', 'movie', 'event', 'tonight', 'today', 'tomorrow', 'and', 'with', 'from', 'this', 'that', 'saved', 'image', 'photo', 'screenshot'])

export function ticketQueryTokens(text: string): string[] {
  return normalizeWords(String(text || '').replace(/\b[em]-tickets?\b/gi, ' ')).split(' ').filter((t) => t.length >= 3 && !TICKET_QUERY_STOP.has(t) && t !== 'qr')
}

/** The ticket/QR document attached to a saved booking, if any. Pure. */
export function ticketDocumentIdFromLifeEvent(ev: any): string | null {
  const m = ev?.metadata_json || {}
  const refs = Array.isArray(ev?.source_refs) ? ev.source_refs : []
  const fromRef = refs.find((r: any) => r?.documentId && /ticket|credential|qr/i.test(String(r?.kind || '')))?.documentId
  const id = m?.credential?.documentId || m?.screenshotEvidence?.documentId || fromRef
  return id ? String(id) : null
}

/**
 * The saved booking a ticket ask names. Every name word in the ask must appear in the booking's
 * title/venue/provider; with no name ("my ticket", "qr code") only a single booking with an attached
 * ticket qualifies. Several equally good bookings prefer the one with a ticket, then the one nearest
 * now. Pure.
 */
export function pickTicketLifeEvent(events: any[], text: string, now: number = Date.now()): any | null {
  const words = ticketQueryTokens(text)
  const pool = (events || []).filter((ev) => ev && ev.lifecycle_state !== 'cancelled')
  let candidates: any[]
  if (words.length) {
    candidates = pool.filter((ev) => {
      const hay = ` ${normalizeWords([ev.title, ev.location, ev.provider].filter(Boolean).join(' '))} `
      return words.every((w) => hay.includes(` ${w} `) || (w.length >= 4 && hay.includes(` ${w}`)))
    })
  } else {
    const withTicket = pool.filter((ev) => ticketDocumentIdFromLifeEvent(ev))
    candidates = withTicket.length === 1 ? withTicket : []
  }
  if (!candidates.length) return null
  const distance = (ev: any) => { const at = Date.parse(String(ev?.start_at || '')); return Number.isFinite(at) ? Math.abs(at - now) : Number.MAX_SAFE_INTEGER }
  return [...candidates].sort((a, b) => Number(Boolean(ticketDocumentIdFromLifeEvent(b))) - Number(Boolean(ticketDocumentIdFromLifeEvent(a))) || distance(a) - distance(b))[0]
}

function bookingWhen(ev: any): string {
  const at = Date.parse(String(ev?.start_at || ''))
  if (!Number.isFinite(at)) return ''
  const tz = typeof ev?.timezone === 'string' && ev.timezone ? ev.timezone : 'Asia/Kolkata'
  try {
    return new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(at)).replace(/\s?([ap])m\b/i, (_m, a) => `${a.toLowerCase()}m`)
  } catch { return '' }
}

export type TicketRetrievalReply = { text: string; mediaUrl?: string | null }

/**
 * "Jailer qr code", "show my Jailer 2 ticket": the ticket attached to the saved booking, else a saved
 * ticket document, else one honest line. Owner-bound throughout. Returns null only for asks that are
 * not ticket retrievals.
 */
export async function buildTicketRetrievalReply(telegramId: number, text: string, messageId?: string | null): Promise<TicketRetrievalReply | null> {
  if (!isTicketRetrievalAsk(text)) return null
  let event: any = null
  try {
    const { data } = await supabaseAdmin
      .from('life_events')
      .select('id,title,provider,location,start_at,timezone,lifecycle_state,metadata_json,source_refs')
      .eq('telegram_id', String(telegramId))
      .order('updated_at', { ascending: false })
      .limit(60)
    event = pickTicketLifeEvent((data || []) as any[], text)
  } catch (err: any) {
    console.error('[asset-memory] ticket booking lookup failed (non-fatal):', err?.message || err)
  }
  const docId = event ? ticketDocumentIdFromLifeEvent(event) : null
  if (docId) {
    const { data: doc } = await supabaseAdmin
      .from('documents')
      .select('id, doc_type, title, summary, extracted, storage_path, mime')
      .eq('telegram_id', telegramId)
      .eq('id', docId)
      .maybeSingle()
    if (doc) {
      await clearFollowupState(telegramId, 'last_asset')
      await saveFollowupState(telegramId, 'last_asset', { docId: doc.id, messageId: messageId ?? null, source: 'retrieval' })
      if (isSensitiveDoc(doc)) return { text: await buildMaskedSensitiveReply(telegramId, doc) }
      const when = bookingWhen(event)
      const head = `🎟️ ${String(event.title || doc.title || 'Your ticket').slice(0, 160)}${when ? ` — ${when}` : ''}${event.location ? `, ${String(event.location).slice(0, 120)}` : ''}`
      const body = await buildAssetFileReply(telegramId, { ...doc, title: doc.title || event.title }, null)
      const mime = String(doc.mime || '')
      const mediaUrl = doc.storage_path && /^(?:image\/|application\/pdf)/i.test(mime) ? await getDocumentSignedUrl(String(doc.storage_path), 600).catch(() => null) : null
      return { text: `${head}\n${body}`, mediaUrl }
    }
  }
  // No ticket on the booking: a saved ticket document may still match (metadata + #679 ticket boost).
  const fromDocuments = await buildAssetRetrievalReply(telegramId, text, messageId ?? null)
  if (fromDocuments) return { text: fromDocuments }
  if (event) {
    const when = bookingWhen(event)
    return { text: `I have your ${String(event.title || 'booking').slice(0, 160)} booking saved${when ? ` (${when}${event.location ? `, ${String(event.location).slice(0, 120)}` : ''})` : ''}, but no ticket or QR image is attached to it.` }
  }
  const words = ticketQueryTokens(text)
  return { text: `I don't have a saved ticket or QR${words.length ? ` for ${words.join(' ')}` : ''}.` }
}

export async function buildAssetFieldReply(telegramId: number, text: string): Promise<string | null> {
  const confirmed = await buildAssetRevealConfirmation(telegramId, text)
  if (confirmed) return confirmed

  if (NEVER_REVEAL_RE.test(text || '')) {
    return `🔒 I can't reveal passwords, PINs, OTPs, CVVs, API keys, tokens, or similar secrets in chat.`
  }
  if (isAssetRetrievalCommand(text)) return null

  const state = await getLatestFollowupState(telegramId, 'last_asset')
  if (!state || !isStrictlyFreshFollowupState(state, 15) || !state.payload?.docId) return null
  const doc = await fetchDocumentById(telegramId, String(state.payload.docId))
  if (!doc) return null

  let req = requestedField(text)
  if (!req && isVagueIdentifierRequest(text) && isSensitiveDoc(doc)) req = primaryIdentifierRequest(doc)
  if (!req) return null

  if (isSensitiveDoc(doc)) return await gateSensitiveFieldRequest(telegramId, doc, req)
  const val = fieldFromDoc(doc, req.keys)
  if (!val) return null
  return `${req.label}: ${val}`
}

export function isBusinessCardText(text: string): boolean {
  return /\b(business|visiting|name)\s*card\b/i.test(String(text || ''))
}

/** A contact card as WhatsApp lines. Contact details on a card the user saved are not secrets. */
export function businessCardLines(f: Record<string, string>, head: string): string {
  const v = (x?: string) => String(x || '').trim()
  return [
    head,
    [v(f.designation), v(f.company)].filter(Boolean).join(' · '),
    v(f.phones) && `📞 ${v(f.phones)}`,
    v(f.emails) && `✉️ ${v(f.emails)}`,
    v(f.website) && `🌐 ${v(f.website)}`,
    v(f.address) && `📍 ${v(f.address)}`,
  ].filter(Boolean).join('\n')
}

/** Reply for one known document (used when the caller already resolved which one). */
export async function buildDocumentReplyById(telegramId: number, docId: string, text: string, messageId?: string | null): Promise<string | null> {
  const doc = await fetchDocumentById(telegramId, docId)
  if (!doc) return null
  await clearFollowupState(telegramId, 'last_asset')
  await saveFollowupState(telegramId, 'last_asset', { docId: doc.id, messageId: messageId ?? null, source: 'retrieval' })
  const requested = requestedField(text)
  if (isSensitiveDoc(doc)) return requested ? await gateSensitiveFieldRequest(telegramId, doc, requested) : await buildMaskedSensitiveReply(telegramId, doc)
  return buildAssetFileReply(telegramId, doc, requested)
}
