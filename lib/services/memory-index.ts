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

/**
 * Fire-and-forget: embed a saved memory and upsert into memory_embeddings.
 * NEVER throws — an embedding failure must not affect the user-facing save.
 */
export async function indexMemory(params: {
  telegramId: number
  sourceId: string
  content: string
  sourceTable?: string
}): Promise<void> {
  try {
    const content = (params.content || '').slice(0, 2000).trim()
    if (!isIndexable(content)) return
    const embedding = await embedText(content)
    await supabaseAdmin.from('memory_embeddings').upsert(
      {
        telegram_id: params.telegramId,
        source_table: params.sourceTable || 'memories',
        source_id: params.sourceId,
        content,
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
    console.error('[memory-index] unindex failure:', err?.message)
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

  const { data: rows } = await supabaseAdmin
    .from('memories')
    .select('id, telegram_id, content')
    .order('created_at', { ascending: false })
    .limit(limit)

  let indexed = 0
  for (const r of (rows || []) as any[]) {
    if (done.has(String(r.id))) continue
    if (!isIndexable(r.content)) continue
    await indexMemory({ telegramId: r.telegram_id, sourceId: String(r.id), content: r.content })
    indexed++
  }
  return { scanned: (rows || []).length, indexed }
}
