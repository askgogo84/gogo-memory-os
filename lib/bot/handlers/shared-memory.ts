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

/**
 * Sharing a topic grants *read access* to private memories. Authorization may
 * never be inferred from a domestic last-ten-digit suffix or an uncertain
 * lookup. Only a complete stored international phone identity can match.
 */
export function canonicalShareRecipientPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^whatsapp:\s*/i, '').trim()
  if (!/^\+?[1-9][0-9\s()\-]*$/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 11 && digits.length <= 15 ? digits : null
}

/** Match only supported, exactly saved phone variants; no ILIKE or suffix. */
export function shareRecipientPhoneCandidates(full: string): string[] {
  return [`whatsapp:+${full}`, `+${full}`, full, `whatsapp:${full}`]
}

/** Reject imprecise BIGINTs instead of granting another owner's memory access. */
export function exactShareRecipientOwnerId(value: unknown): number | null {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isSafeInteger(value))) return null
  const raw = String(value)
  if (!/^-?[1-9]\d*$/.test(raw)) return null
  const numeric = Number(raw)
  return Number.isSafeInteger(numeric) && String(numeric) === raw ? numeric : null
}

/** Resolve saved contact -> ONE verified AskGogo account, or refuse sharing. */
export async function resolveRecipientTelegramId(
  ownerTelegramId: number,
  name: string
): Promise<{ telegramId: number | null; hasContact: boolean }> {
  if (exactShareRecipientOwnerId(ownerTelegramId) === null) return { telegramId: null, hasContact: false }
  const { data: contact, error: contactError } = await supabaseAdmin
    .from('friend_contacts')
    .select('whatsapp_id')
    .eq('owner_telegram_id', ownerTelegramId)
    .eq('name', name)
    .maybeSingle()
  if (contactError || !contact?.whatsapp_id) return { telegramId: null, hasContact: false }

  const fullPhone = canonicalShareRecipientPhone(contact.whatsapp_id)
  if (!fullPhone) return { telegramId: null, hasContact: true }
  const { data: rows, error: recipientError } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id')
    .in('whatsapp_id', shareRecipientPhoneCandidates(fullPhone))
    .not('telegram_id', 'is', null)
    .limit(2)
  // A second linked users row is not automatically the intended recipient.
  // Fail closed until the exact target account is independently disambiguated.
  if (recipientError || !Array.isArray(rows) || rows.length !== 1) return { telegramId: null, hasContact: true }
  const target = rows[0]
  if (canonicalShareRecipientPhone(target.whatsapp_id) !== fullPhone) return { telegramId: null, hasContact: true }
  return { telegramId: exactShareRecipientOwnerId(target.telegram_id), hasContact: true }
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
    if (!rid) return `I couldn't verify one exact AskGogo account for ${capName(share.name)}. Check their saved full international number before sharing.`
    await grantShare(telegramId, rid, share.topic)
    return `Shared your *${share.topic}* bucket with ${capName(share.name)}. They can now ask me about it.`
  }
  return null
}
