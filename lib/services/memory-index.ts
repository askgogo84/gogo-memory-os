import { supabaseAdmin } from '@/lib/supabase-admin'
import { embedText } from '@/lib/services/embeddings'

// Content that should never be embedded/searched (system rows, JSON state, etc.)
// Mirrors the isInternalMemory filter in memory-control.ts.
function isIndexable(content: string): boolean {
  const lower = (content || '').toLowerCase().trim()
  if (!lower) return false
  if (lower.startsWith('{') || lower.startsWith('[')) return false
  if (lower.startsWith('askgogo_usage:')) return false
  if (lower.startsWith('askgogo_meeting_notes_created:')) return false
  if (lower.includes('followup_state')) return false
  if (lower.includes('meeting_action_items')) return false
  if (lower.includes('reminder_ampm')) return false
  if (lower.includes('calendar_conflict')) return false
  if (lower.includes('day_plan')) return false
  if (lower.includes('founder pricing / paid plan launch')) return false
  if (lower.startsWith('askgogo_')) return false
  return true
}

// Asset-memory defense in depth. Sensitive document embeddings are useful for
// labels such as a person's name and "passport", but must never contain the raw
// identifier/date/amount that happened to appear in a user caption or model title.
// The asset-memory writer already builds a label-only payload; this boundary makes
// that invariant fail closed even if a future caller accidentally passes a value.
function sanitizeSensitiveDocumentIndex(content: string, sourceTable?: string): string {
  if (sourceTable !== 'documents') return content
  const lower = (content || '').toLowerCase()
  const looksSensitive = /\b(passport|identity\s*document|\bid\s*document|aadhaar|aadhar|pan\s*card|driving\s*licen[cs]e|payment\s*proof|bank\s*statement|account\s*statement)\b/.test(lower)
  if (!looksSensitive) return content

  return String(content || '')
    // Alphanumeric identifiers such as S5863938, ABC123456, card/account refs.
    .replace(/\b(?=[A-Za-z0-9-]{5,}\b)(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+\b/g, '[redacted]')
    // Numeric identifiers, dates, phone-like sequences and formatted amounts.
    .replace(/\b\d[\d\s,./-]{2,}\d\b/g, '[redacted]')
    .replace(/\[redacted\](?:\s*·\s*\[redacted\])+/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fire-and-forget: embed a saved memory and upsert into memory_embeddings.
 * NEVER throws — an embedding failure must not affect the user-facing save.
 */
export async function indexMemory(params: {
  telegramId: number
  sourceId: string
  content: string
  sourceTable?: string
  topic?: string | null
}): Promise<void> {
  try {
    const raw = (params.content || '').slice(0, 2000).trim()
    const content = sanitizeSensitiveDocumentIndex(raw, params.sourceTable)
    if (!isIndexable(content)) return
    const embedding = await embedText(content)
    await supabaseAdmin.from('memory_embeddings').upsert(
      {
        telegram_id: params.telegramId,
        source_table: params.sourceTable || 'memories',
        source_id: params.sourceId,
        content,
        topic: params.topic ?? null,
        embedding,
        deleted_at: null,
      },
      { onConflict: 'source_table,source_id' }
    )
  } catch (err: any) {
    console.error('[memory-index] non-fatal embedding failure:', err?.message)
  }
}

/** Soft-delete an embedding when the user forgets a memory. */
export async function unindexMemory(sourceId: string, sourceTable = 'memories'): Promise<void> {
  try {
    await supabaseAdmin
      .from('memory_embeddings')
      .update({ deleted_at: new Date().toISOString() })
      .eq('source_table', sourceTable)
      .eq('source_id', sourceId)
  } catch (err: any) {
    console.error('[memory-index] unindex failure:', err?.message || err)
  }
}

/**
 * One-off backfill: embed existing memories rows that aren't indexed yet.
 * Processes in batches; safe to run repeatedly (upsert on source_id).
 */
export async function backfillEmbeddings(limit = 500): Promise<{ scanned: number; indexed: number }> {
  const { data: existing } = await supabaseAdmin
    .from('memory_embeddings')
    .select('source_id')
    .eq('source_table', 'memories')

  const done = new Set((existing || []).map((r: any) => r.source_id))

  // Paginate through memories so internal usage/tracking rows don't eat the budget.
  // Reads are cheap; the OpenAI embed calls are the real cost, so we cap how many
  // NEW rows we embed per invocation (embedCap) to stay under the function timeout.
  const pageSize = 1000
  const embedCap = limit          // max embeddings to create this call
  let indexed = 0
  let scanned = 0
  for (let from = 0; from < 20000 && indexed < embedCap; from += pageSize) {
    const { data: rows } = await supabaseAdmin
      .from('memories')
      .select('id, telegram_id, content')
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (!rows || rows.length === 0) break
    scanned += rows.length
    for (const r of rows as any[]) {
      if (indexed >= embedCap) break
      if (done.has(String(r.id))) continue
      if (!isIndexable(r.content)) continue
      await indexMemory({ telegramId: r.telegram_id, sourceId: String(r.id), content: r.content })
      indexed++
    }
    if (rows.length < pageSize) break
  }
  return { scanned, indexed }
}
