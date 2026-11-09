import { supabaseAdmin } from '@/lib/supabase-admin'
import { eligibleThrowbackMemory } from './throwback-quality'

// Phase 1B — "Throwback": resurface a random old saved memory.
// Piggybacks on the weekly (Sunday) briefing; also triggerable via `test throwback`.

const OLDER_DAYS = 21
const COOLDOWN_DAYS = 90

function clip(s: string, n = 140): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

/**
 * Pick a random old memory (not resurfaced recently) and mark it resurfaced.
 * Pass { ignoreAge: true } for the `test throwback` command.
 */
export async function buildThrowbackLine(
  telegramId: number,
  opts: { ignoreAge?: boolean } = {}
): Promise<string | null> {
  const cooldownIso = new Date(Date.now() - COOLDOWN_DAYS * 864e5).toISOString()

  let q = supabaseAdmin
    .from('memory_embeddings')
    .select('id, content, created_at, resurfaced_at, source_table')
    .eq('telegram_id', telegramId)
    .eq('source_table', 'memories')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(100)

  if (!opts.ignoreAge) {
    q = q.lt('created_at', new Date(Date.now() - OLDER_DAYS * 864e5).toISOString())
  }

  const { data } = await q
  const pool = (data || []).filter(
    (r: any) =>
      eligibleThrowbackMemory(r.content, r.source_table) &&
      (!r.resurfaced_at || r.resurfaced_at < cooldownIso)
  )
  if (!pool.length) return null

  const pick = pool[Math.floor(Math.random() * pool.length)]
  await supabaseAdmin
    .from('memory_embeddings')
    .update({ resurfaced_at: new Date().toISOString() })
    .eq('id', pick.id)

  const ageWeeks = Math.max(
    1,
    Math.round((Date.now() - new Date(pick.created_at).getTime()) / (7 * 864e5))
  )
  const whenText = opts.ignoreAge && ageWeeks < 1 ? 'a little while' : `${ageWeeks} week${ageWeeks > 1 ? 's' : ''}`
  return `🎞️ *Throwback*: ${whenText} ago you saved —\n"${clip(pick.content)}"\n\nReply *keep* or *forget*.`
}

/** Was the last bot message a throwback, and is this a keep/forget reply? */
export function isThrowbackReply(text: string, lastBotMessage: string | null): 'keep' | 'forget' | null {
  if (!lastBotMessage || !/🎞️ \*?Throwback/i.test(lastBotMessage)) return null
  const t = (text || '').trim().toLowerCase()
  if (t === 'keep') return 'keep'
  if (t === 'forget') return 'forget'
  return null
}

/** Get the most recent assistant message for context-gating throwback replies. */
export async function getLastAssistantMessage(telegramId: number): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('content')
    .eq('telegram_id', telegramId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
  return data?.[0]?.content ?? null
}

/** keep = do nothing; forget = owner-bound source removal + verified index tombstone. */
export async function handleThrowbackReply(telegramId: number, action: 'keep' | 'forget'): Promise<string> {
  if (action === 'keep') return 'Kept 👍 I\'ll hold onto that.'

  // Legacy numeric IDs must be safe before service-role reads; an unsafe number can alias another owner.
  const unverified = 'I couldn\'t verify that this throwback was fully forgotten. Please check your saved memories.'
  if (!Number.isSafeInteger(telegramId) || telegramId === 0) return unverified

  try {
    const { data: rows, error: findError } = await supabaseAdmin
      .from('memory_embeddings')
      .select('id, source_id, source_table')
      .eq('telegram_id', telegramId)
      .eq('source_table', 'memories')
      .not('resurfaced_at', 'is', null)
      .is('deleted_at', null)
      .order('resurfaced_at', { ascending: false })
      .limit(1)
    if (findError || !Array.isArray(rows)) return unverified
    const row = rows[0]
    if (!row) return 'Nothing to forget right now.'
    const sourceId = String(row.source_id || '').trim()
    if (!sourceId) return unverified

    // Never delete the source until this exact owner/source index is marked forgotten.
    const { data: marked, error: markError } = await supabaseAdmin
      .from('memory_embeddings')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('telegram_id', telegramId)
      .eq('source_table', 'memories')
      .is('deleted_at', null)
      .select('id')
    if (markError || !Array.isArray(marked) || marked.length !== 1) return unverified

    const { error: deleteError } = await supabaseAdmin
      .from('memories')
      .delete()
      .eq('id', sourceId)
      .eq('telegram_id', telegramId)
    if (deleteError) return unverified

    // Positive success is conditional on both source absence and no live index for this owner.
    const [source, index] = await Promise.all([
      supabaseAdmin.from('memories').select('id').eq('id', sourceId).eq('telegram_id', telegramId).limit(1),
      supabaseAdmin.from('memory_embeddings').select('id').eq('id', row.id).eq('telegram_id', telegramId).is('deleted_at', null).limit(1),
    ])
    if (source.error || index.error || !Array.isArray(source.data) || !Array.isArray(index.data) || source.data.length || index.data.length) return unverified
    return 'Gone — I won\'t resurface that one again.'
  } catch {
    // Unknown DB outcomes must never be described as a confirmed deletion.
    return unverified
  }
}
