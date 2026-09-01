import { supabaseAdmin } from '@/lib/supabase-admin'
import { createDocumentShortLink, shortLinkUrl } from '@/lib/services/document-links'

type RawDoc = {
  id: string | number
  doc_type: string | null
  title: string | null
  summary: string | null
  extracted: any
  doc_date: string | null
  expires_on: string | null
  storage_path: string | null
  mime: string | null
  created_at: string | null
}

export type DashboardMemoryItem = {
  id: string
  title: string
  kind: 'document' | 'image' | 'payment' | 'travel' | 'identity'
  subtitle: string
  savedAt: string | null
  sensitive: boolean
  openUrl: string | null
}

export type DashboardMemory = { ok: true; items: DashboardMemoryItem[] } | { ok: false }

const SENSITIVE_TITLE_RE = /\b(passport|aadhaar|aadhar|pan\s*card|driving\s+licen[cs]e|identity\s+card|national\s+id|government\s+id|govt\s+id|voter\s+id|residence\s+permit|bank\s+statement|account\s+statement)\b/i

function stripIdentifiers(text: string): string {
  return String(text || '')
    .replace(/\b[A-Z]{1,4}\d{5,}\b/gi, '[hidden]')
    .replace(/\b\d[\d\s-]{5,}\d\b/g, '[hidden]')
    .trim()
}

function extractedObject(doc: RawDoc): any {
  return doc.extracted && typeof doc.extracted === 'object' ? doc.extracted : {}
}

function isSensitive(doc: RawDoc): boolean {
  const ex = extractedObject(doc)
  if (ex.privacyClass === 'sensitive') return true
  if (['passport', 'id_document', 'payment_proof'].includes(String(ex.assetType || ''))) return true
  return SENSITIVE_TITLE_RE.test(`${doc.doc_type || ''} ${doc.title || ''}`)
}

function deriveKind(doc: RawDoc): DashboardMemoryItem['kind'] {
  const ex = extractedObject(doc)
  const type = String(ex.assetType || doc.doc_type || '').toLowerCase()
  if (type.includes('passport') || type.includes('id_document') || type.includes('licence') || type.includes('license')) return 'identity'
  if (type.includes('payment')) return 'payment'
  if (type.includes('ticket') || type.includes('flight') || type.includes('train')) return 'travel'
  if ((doc.mime || '').toLowerCase().startsWith('image/')) return 'image'
  return 'document'
}

function holderName(ex: any): string | null {
  const name = ex?.fields?.name || ex?.name || null
  if (!name || typeof name !== 'string') return null
  return name.trim().split(/\s+/).slice(0, 2).join(' ')
}

function safeTitle(doc: RawDoc, sensitive: boolean): string {
  const ex = extractedObject(doc)
  const type = String(ex.assetType || doc.doc_type || '').toLowerCase()
  if (type === 'passport' || /passport/i.test(doc.title || '')) {
    const who = holderName(ex)
    return who ? `${who}'s Passport` : 'Passport'
  }
  if (type === 'payment_proof') return 'Payment proof'
  if (type === 'id_document') {
    const kind = String(ex?.fields?.document_kind || 'Identity document').trim()
    const who = holderName(ex)
    return who ? `${who}'s ${kind}` : kind
  }
  const raw = stripIdentifiers(doc.title || '')
  if (!raw || sensitive) return deriveKind(doc) === 'identity' ? 'Identity document' : 'Saved document'
  return raw.length > 72 ? raw.slice(0, 69) + '…' : raw
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d)
}

function safeSubtitle(doc: RawDoc, sensitive: boolean): string {
  const ex = extractedObject(doc)
  if (sensitive) {
    const expiry = ex.expiryHuman || ex?.fields?.expiry_date || doc.expires_on
    const exp = formatDate(expiry) || (typeof expiry === 'string' ? stripIdentifiers(expiry) : null)
    return exp ? `Sensitive details hidden · expires ${exp}` : 'Sensitive details hidden'
  }
  const summary = stripIdentifiers(doc.summary || '')
  if (summary) return summary.length > 110 ? summary.slice(0, 107) + '…' : summary
  return doc.storage_path ? 'Original file saved' : 'Saved memory'
}

export async function getDashboardMemory(telegramId: string): Promise<DashboardMemory> {
  const tgNum = parseInt(telegramId, 10)
  if (!Number.isFinite(tgNum)) return { ok: true, items: [] }

  try {
    const { data, error } = await supabaseAdmin
      .from('documents')
      .select('id, doc_type, title, summary, extracted, doc_date, expires_on, storage_path, mime, created_at')
      .eq('telegram_id', tgNum)
      .order('created_at', { ascending: false })
      .limit(80)

    if (error) {
      console.error('DASHBOARD_MEMORY_FAILED:', error)
      return { ok: false }
    }

    const items = await Promise.all(((data || []) as RawDoc[]).map(async (doc) => {
      const sensitive = isSensitive(doc)
      let openUrl: string | null = null
      if (doc.storage_path) {
        const token = await createDocumentShortLink({ telegramId: tgNum, documentId: String(doc.id), sensitive })
        if (token) openUrl = shortLinkUrl(token)
      }
      return {
        id: String(doc.id),
        title: safeTitle(doc, sensitive),
        kind: deriveKind(doc),
        subtitle: safeSubtitle(doc, sensitive),
        savedAt: doc.created_at,
        sensitive,
        openUrl,
      } satisfies DashboardMemoryItem
    }))

    return { ok: true, items }
  } catch (err) {
    console.error('DASHBOARD_MEMORY_FAILED:', err)
    return { ok: false }
  }
}
