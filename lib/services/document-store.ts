/**
 * Document Store (Step 2a — durable storage only; retrieval is 2b).
 *
 * Uploads an inbound WhatsApp file to the private `user-documents` bucket and
 * records a row in public.documents so the artifact survives the Twilio media
 * URL expiring. Every path here is ADDITIVE and NON-FATAL: an upload or insert
 * failure is logged and swallowed so it can never break the note/ticket reply
 * the caller already sent. If the upload fails we still write the row (with a
 * null storage_path) — losing the file must not lose the summary.
 *
 * Usage is COUNTED, never enforced: recordUsage increments the `document`
 * counter, but there is no allowance check or block on this path. The count is
 * gated behind METER_ENABLED (same as the web_search counter) so dev/preview
 * traffic against the shared production Supabase doesn't pollute real counts.
 *
 * Retries are idempotent: the row is inserted FIRST keyed by source_message_id,
 * so a Twilio webhook retry trips the (telegram_id, source_message_id) partial
 * unique index before any file is re-downloaded, re-uploaded, or re-counted.
 */

import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { indexMemory } from '@/lib/services/memory-index'
import { recordUsage, type DocumentAction } from '@/lib/services/meter'
import { extractNoteFields } from '@/lib/services/image-note-reader'
import type { TicketInfo, FlightInfo, TrainInfo, EventInfo } from '@/lib/services/pdf-reader'

const BUCKET = 'user-documents'
const METER_ENABLED = process.env.METER_ENABLED === 'true'

type FileRef = { mediaUrl: string; accountSid: string; authToken: string; contentType: string }

function extFromMime(mime: string): string {
  const m = (mime || '').toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('png')) return 'png'
  if (m.includes('webp')) return 'webp'
  if (m.includes('heic')) return 'heic'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  return 'bin'
}

// Download the Twilio-hosted file (same Basic sid:token auth used everywhere else)
// and upload it to user-documents/{telegram_id}/{uuid}.{ext}. Never throws — on any
// failure returns storage_path null so the row still saves. size_bytes is populated
// whenever the fetch succeeded, even if the upload itself failed.
async function uploadToBucket(
  telegramId: number,
  file: FileRef,
): Promise<{ storagePath: string | null; mime: string | null; sizeBytes: number | null }> {
  const mime = file.contentType || null
  let sizeBytes: number | null = null
  try {
    const res = await fetch(file.mediaUrl, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${file.accountSid}:${file.authToken}`).toString('base64'),
      },
    })
    if (!res.ok) throw new Error(`Twilio fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    sizeBytes = buf.byteLength
    const path = `${telegramId}/${randomUUID()}.${extFromMime(file.contentType)}`
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.contentType, upsert: false })
    if (error) throw error
    return { storagePath: path, mime, sizeBytes }
  } catch (err: any) {
    console.error('DOCUMENT_UPLOAD_FAILED:', err?.message || err)
    return { storagePath: null, mime, sizeBytes }
  }
}

/**
 * Core: upload the file (best-effort) → insert the documents row → index for
 * semantic search → count usage. Returns the new row id (or null on insert
 * failure) and the storage_path actually written.
 */
export async function storeDocument(params: {
  telegramId: number
  docType: string
  docAction: DocumentAction
  title: string
  summary: string
  extracted: Record<string, any>
  indexContent: string
  docDate?: string | null
  expiresOn?: string | null
  messageId?: string | null
  file?: FileRef
}): Promise<{ id: string | null; storagePath: string | null; duplicate?: boolean }> {
  // Insert the row FIRST with the file columns null, so a Twilio webhook retry trips
  // the (telegram_id, source_message_id) partial unique index BEFORE we re-download or
  // re-upload the file. The file is uploaded and patched in afterwards.
  const { data, error } = await supabaseAdmin
    .from('documents')
    .insert({
      telegram_id: params.telegramId,
      doc_type: params.docType,
      title: (params.title || 'Document').slice(0, 300),
      summary: (params.summary || '').slice(0, 4000),
      doc_date: params.docDate ?? null,
      expires_on: params.expiresOn ?? null,
      storage_path: null,
      mime: params.file?.contentType ?? null,
      size_bytes: null,
      extracted: params.extracted ?? {},
      source_message_id: params.messageId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // 23505 = unique_violation on (telegram_id, source_message_id): this inbound
    // message was already stored (a retry). Do NOT re-upload, re-insert, or count it.
    if ((error as { code?: string }).code === '23505') {
      console.log('DOCUMENT_DUPLICATE_SKIPPED: message already stored', params.messageId)
      return { id: null, storagePath: null, duplicate: true }
    }
    console.error('DOCUMENT_INSERT_FAILED:', error.message)
    return { id: null, storagePath: null }
  }
  if (!data) {
    console.error('DOCUMENT_INSERT_FAILED: no row returned')
    return { id: null, storagePath: null }
  }
  const id = String(data.id)

  // Upload the file now (best-effort) and patch the row with its path. An upload
  // failure leaves storage_path null but keeps the row + summary.
  let storagePath: string | null = null
  if (params.file) {
    const up = await uploadToBucket(params.telegramId, params.file)
    storagePath = up.storagePath
    if (up.storagePath) {
      await supabaseAdmin
        .from('documents')
        .update({ storage_path: up.storagePath, mime: up.mime, size_bytes: up.sizeBytes })
        .eq('id', id)
    }
  }

  // Semantic index so 2b can answer "show my <thing>" by meaning. Never throws.
  await indexMemory({
    telegramId: params.telegramId,
    sourceId: id,
    sourceTable: 'documents',
    content: params.indexContent,
  })

  // COUNT ONLY — no allowance check, no block. Gated behind METER_ENABLED so
  // dev/preview traffic doesn't pollute production counts (same gate as web_search).
  if (METER_ENABLED) {
    await recordUsage(
      params.telegramId,
      'document',
      params.docAction,
      params.messageId ? { message_id: params.messageId } : {},
    )
  }

  return { id, storagePath }
}

// ── Note documents (image DOCUMENT/OTHER + PDF non-ticket) ────────────────────

function deriveNoteTitle(summary: string, medicalMode: boolean): string {
  if (medicalMode) return 'Medical note / prescription'
  const first = (summary.split('\n')[0] || '').replace(/\.$/, '').trim()
  if (!first) return 'Document'
  return first.length > 80 ? first.slice(0, 77) + '…' : first
}

// The title saveDocumentNote will file this reader output under — exposed so the
// WhatsApp reply can name it WITHOUT re-deriving (and drifting from) the stored value.
// Pure: same readerText in → same title saveDocumentNote persists.
export function deriveNoteTitleFromReader(readerText: string): string {
  const { summary, medicalMode } = extractNoteFields(readerText)
  return deriveNoteTitle(summary, medicalMode)
}

/**
 * Store a non-ticket document that was read by one of the note summarisers
 * (readAndSummarizeImageNote / readAndSummarizePdfDocument). Parses title,
 * summary and extracted text out of the summariser's sectioned output. Fully
 * self-contained and non-fatal.
 */
export async function saveDocumentNote(params: {
  telegramId: number
  readerText: string
  docType?: string
  docAction?: DocumentAction
  messageId?: string | null
  file?: FileRef
}): Promise<void> {
  try {
    const { summary, extracted, medicalMode } = extractNoteFields(params.readerText)
    const title = deriveNoteTitle(summary, medicalMode)
    const expiresOn = scanExpiry(params.readerText)
    await storeDocument({
      telegramId: params.telegramId,
      docType: params.docType || 'document',
      docAction: params.docAction || 'document_save',
      title,
      summary: summary || extracted.slice(0, 400),
      extracted: { text: extracted || summary, summary, medical: medicalMode },
      indexContent: `${title}\n${summary}\n${extracted}`.slice(0, 2000),
      docDate: null,
      expiresOn,
      messageId: params.messageId ?? null,
      file: params.file,
    })
  } catch (err: any) {
    console.error('DOCUMENT_SAVE_FAILED:', err?.message || err)
  }
}

// ── Ticket documents (alongside travel_tickets; that table is untouched) ──────

function ticketTitleAndDate(info: NonNullable<TicketInfo>): { title: string; travelDate: string | null } {
  if (info.type === 'flight') {
    const f = (info as FlightInfo).flights[0]
    const title = f ? `Flight ${f.from} → ${f.to}${f.pnr ? ' · PNR ' + f.pnr : ''}` : 'Flight ticket'
    return { title, travelDate: f ? parseLooseDate(f.date) : null }
  }
  if (info.type === 'train') {
    const t = info as TrainInfo
    return { title: `Train ${t.from} → ${t.to}${t.pnr ? ' · PNR ' + t.pnr : ''}`, travelDate: parseLooseDate(t.date) }
  }
  const e = info as EventInfo
  return { title: `Event: ${e.name}`, travelDate: parseLooseDate(e.date) }
}

/**
 * Store a documents row alongside a parsed travel ticket so the file is
 * retrievable in 2b. Does NOT touch travel_tickets or its reminder logic — this
 * is purely additive. Non-fatal.
 */
export async function saveTicketDocument(params: {
  telegramId: number
  info: NonNullable<TicketInfo>
  replyText: string
  messageId?: string | null
  file?: FileRef
}): Promise<void> {
  try {
    const { title, travelDate } = ticketTitleAndDate(params.info)
    const plainReply = params.replyText.replace(/[*_`~]/g, '').trim()
    await storeDocument({
      telegramId: params.telegramId,
      docType: 'ticket',
      docAction: 'ticket_parse',
      title,
      summary: plainReply.slice(0, 4000),
      extracted: { ...(params.info as Record<string, any>) },
      indexContent: `${title}\n${plainReply}`.slice(0, 2000),
      // A ticket's travel date is both its natural date and its "spent-after" date,
      // so a future cleanup sweep can drop past tickets.
      docDate: travelDate,
      expiresOn: travelDate,
      messageId: params.messageId ?? null,
      file: params.file,
    })
  } catch (err: any) {
    console.error('TICKET_DOCUMENT_SAVE_FAILED:', err?.message || err)
  }
}

// ── Loose date helpers ────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Parse a single loose date token to YYYY-MM-DD (day defaults to 01 for a
// month/year-only value). Numeric dates are read India-style as DD/MM/YYYY.
// Returns null when it can't parse confidently or the year is implausible.
function parseLooseDate(raw: string | undefined | null): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  let y: number | null = null
  let mo: number | null = null
  let d = 1
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { y = +m[1]; mo = +m[2]; d = +m[3] }
  else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3] }
  else if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/))) { d = +m[1]; mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = +m[3] }
  else if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/))) { mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; y = +m[2] }
  else if ((m = s.match(/^(\d{1,2})[\/\-.](\d{4})$/))) { mo = +m[1]; y = +m[2] }
  else return null
  if (!y || !mo || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  if (y < 100) y += 2000
  if (y < 2000 || y > 2100) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

const DATE_SRC =
  '(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{1,2}\\s+[A-Za-z]{3,9}\\.?\\s+\\d{4}|[A-Za-z]{3,9}\\.?\\s+\\d{4}|\\d{1,2}[\\/\\-.]\\d{4})'

// Best-effort expiry finder: only fires when an explicit expiry/validity/end-date
// keyword sits right before a date, so we never grab an unrelated date. Returns
// null when nothing matches confidently.
function scanExpiry(text: string): string | null {
  const t = (text || '').replace(/\s+/g, ' ')
  const re = new RegExp(
    '(?:expir\\w*|valid\\s+(?:until|till|upto|up to|through|thru|to)|end\\s+date|expires?\\s+on)[^\\dA-Za-z]{0,12}' + DATE_SRC,
    'i',
  )
  const m = t.match(re)
  if (!m) return null
  return parseLooseDate(m[1])
}
