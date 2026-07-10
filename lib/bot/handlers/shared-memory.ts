import { supabaseAdmin } from '@/lib/supabase-admin'
import { embedText } from '@/lib/services/embeddings'
import { indexMemory } from '@/lib/services/memory-index'

// Phase 1.5 — Shared Memory: share a topic "bucket" with a contact who is an
// AskGogo user; they can then retrieve your notes in that topic (read-only).

export function detectShareIntent(text: string): { topic: string; name: string } | null {
  const m =
    (text || '').match(/^\s*share\s+(?:my\s+)?(.+?)\s+(?:bucket|space|topic)\s+with\s+([a-z][\w'-]{1,24})\s*$/i) ||
    (text || '').match(/^\s*share\s+(?:my\s+)?(?:notes|memories|saves)\s+(?:about|on)\s+(.+?)\s+with\s+([a-z][\w'-]{1,24})\s*$/i)
  if (!m) return null
  return { topic: m[1].trim().toLowerCase(), name: m[2].trim().toLowerCase() }
}

export async function hasTopic(telegramId: number, topic: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from('memory_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .ilike('topic', topic)
    .is('deleted_at', null)
  return (count || 0) > 0
}

/** Resolve a contact name -> recipient telegram_id (must be an existing AskGogo user). */
export async function resolveRecipientTelegramId(
  ownerTelegramId: number,
  name: string
): Promise<{ telegramId: number | null; hasContact: boolean }> {
  const { data: c } = await supabaseAdmin
    .from('friend_contacts')
    .select('whatsapp_id')
    .eq('owner_telegram_id', ownerTelegramId)
    .eq('name', name)
    .maybeSingle()
  if (!c?.whatsapp_id) return { telegramId: null, hasContact: false }
  const last10 = String(c.whatsapp_id).replace(/\D/g, '').slice(-10)
  const { data: u } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id')
    .ilike('whatsapp_id', `%${last10}%`)
    .limit(1)
  return { telegramId: u?.[0]?.telegram_id ?? null, hasContact: true }
}

export async function grantShare(owner: number, recipient: number, topic: string): Promise<void> {
  await supabaseAdmin
    .from('memory_shares')
    .upsert(
      { owner_telegram_id: owner, recipient_telegram_id: recipient, topic },
      { onConflict: 'owner_telegram_id,recipient_telegram_id,topic' }
    )
}

/** Read path: memories shared TO this user, semantically matched to a query. */
export async function getSharedMemories(
  recipientTelegramId: number,
  query: string,
  k = 3
): Promise<{ owner_telegram_id: number; topic: string; content: string }[]> {
  try {
    const vec = await embedText(query)
    const { data } = await supabaseAdmin.rpc('match_shared_memories', {
      p_recipient: recipientTelegramId,
      p_query: vec,
      p_k: k,
    })
    return ((data || []) as any[]).filter((r) => (r.score ?? 0) >= 0.12)
  } catch (err: any) {
    console.error('[shared-memory] read failed:', err?.message)
    return []
  }
}


export function parseTopicSave(text: string): { topic: string; fact: string } | null {
  let m = text.match(/^\s*remember\s+(?:for|in|to)\s+(?:my\s+)?(.+?)\s+(?:bucket|space|topic)\s*[:,\-]?\s*(.+)$/i)
  if (m) return { topic: m[1].trim().toLowerCase(), fact: m[2].trim() }
  m = text.match(/^\s*(?:save|add)\s+to\s+(?:my\s+)?(.+?)\s+(?:bucket|space|topic)\s*[:,\-]?\s*(.+)$/i)
  if (m) return { topic: m[1].trim().toLowerCase(), fact: m[2].trim() }
  m = text.match(/^\s*remember\s+for\s+(.+?)\s*:\s*(.+)$/i)
  if (m) return { topic: m[1].trim().toLowerCase(), fact: m[2].trim() }
  return null
}

const capName = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Handle topic-bucket save + share. Returns a reply string, or null if not a bucket command.
 *  Called from the webhook BEFORE feature-routing so time-like text ("...at 6pm") isn't
 *  hijacked by the reminder/split-bill handlers. */
export async function handleBucketCommand(telegramId: number, text: string): Promise<string | null> {
  const ts = parseTopicSave(text)
  if (ts) {
    const { data } = await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content: ts.fact }).select('id').single()
    if (data?.id) await indexMemory({ telegramId, sourceId: String(data.id), content: ts.fact, topic: ts.topic })
    return `Got it — saved to your *${ts.topic}* bucket: "${ts.fact}".`
  }
  const share = detectShareIntent(text)
  if (share) {
    if (!(await hasTopic(telegramId, share.topic))) {
      return `You don't have a "${share.topic}" bucket yet. Save to it first, e.g. remember for ${share.topic}: <something>.`
    }
    const { telegramId: rid, hasContact } = await resolveRecipientTelegramId(telegramId, share.name)
    if (!hasContact) return `I don't have ${capName(share.name)}'s number yet. Do a friend reminder once (remind ${share.name} to ...) so I save it, then share.`
    if (!rid) return `${capName(share.name)} isn't on AskGogo yet — ask them to message the bot first, then share.`
    await grantShare(telegramId, rid, share.topic)
    return `Shared your *${share.topic}* bucket with ${capName(share.name)}. They can now ask me about it.`
  }
  return null
}
