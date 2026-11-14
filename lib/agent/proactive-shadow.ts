// Proactive comparison (13 Nov, owner-approved): Gogo's volunteered messages are off by the owner's 4 Nov quiet rule,
// while Instinct sent the four that mattered (WeWork dues, a meeting in 10 minutes, a stale-list cleanup, a provider
// breach). For owners listed in GOGO_PROACTIVE_SHADOW only, the email pulse and the meeting nudge compute what they
// WOULD send and log it as agent_activity 'proactive_shadow'. Nothing is claimed, sent, backed off or marked shown.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { isRelevantOpenLoop } from './task-lifecycle'

/** Exact legacy ids only (negative allowed: the owner's id is negative). Anything else is ignored. */
export function proactiveShadowOwners(env: Record<string, string | undefined> = process.env): string[] {
  return [...new Set(String(env.GOGO_PROACTIVE_SHADOW || '').split(',').map(s => s.trim()).filter(s => /^-?[1-9]\d{0,19}$/.test(s)))]
}

/** Logged text: secrets redacted, long digit runs masked (account numbers), codes near code words, PAN-shaped ids and
 *  link query strings removed, bounded. Line breaks kept so a logged card reads like the real one. */
export function shadowText(value: unknown, max = 200): string {
  return redactSecretShapedText(String(value ?? '').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').trim())
    .replace(/\b\d{9,20}\b/g, d => '••••' + d.slice(-4))
    .replace(/\b\d{4,8}\b(?=[^\n]{0,30}\b(?:code|otp|pin|passcode|verification)\b)|(?<=\b(?:code|otp|pin|passcode)\b[^\n]{0,15})\b\d{4,8}\b/gi, '••••')
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '••••')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1')
    .slice(0, max)
}

/** The once-a-day cleanup list: stale open loops a person would recognise, never ones that must stay open. Pure. */
export function cleanupCandidates(loops: any[], now = Date.now()): any[] {
  const seen = new Set<string>(), out: any[] = []
  for (const l of loops || []) {
    if (!isRelevantOpenLoop(l)) continue
    if (l.kind === 'approval' || ['outcome_unknown', 'waiting_approval', 'running', 'queued'].includes(String(l.evidence_json?.status || ''))) continue
    if (l.proactive_backoff_until && Date.parse(String(l.proactive_backoff_until)) > now) continue
    // 13 Nov comparison: the list was all "Reply to <bill / newsletter / receipt>" items made from inbound mail. Only
    // what the person said or is waiting on belongs here, not inbound mail Gogo guessed needed a reply.
    if ((l.source_type === 'gmail_thread' && l.kind !== 'waiting_on') || l.source_type === 'gmail_service_notice') continue
    const key = `${l.source_type || ''}|${l.source_id || l.id}`
    if (seen.has(key)) continue
    seen.add(key); out.push(l)
  }
  return out
}

export type ShadowKind = 'email' | 'meeting' | 'cleanup' | 'followup'
export async function logProactiveShadow(telegramId: string, kind: ShadowKind, metadata: Record<string, unknown>, deps: { insert?: (row: any) => Promise<{ error?: any }> } = {}): Promise<boolean> {
  const row = { telegram_id: telegramId, event_type: 'proactive_shadow', message: `proactive shadow: ${kind}`, metadata_json: { kind, mode: 'shadow_only_nothing_sent', ...metadata } }
  try {
    const r: any = deps.insert ? await deps.insert(row) : await supabaseAdmin.from('agent_activity').insert(row)
    if (r?.error) { console.error('PROACTIVE_SHADOW_WRITE_FAILED:', JSON.stringify({ kind })); return false }
    return true
  } catch { console.error('PROACTIVE_SHADOW_WRITE_FAILED:', JSON.stringify({ kind })); return false }
}

/** Earlier shadow rows of one kind (for once-only keys and the emulated daily cap). */
export async function recentShadowRows(telegramId: string, kind: ShadowKind, hours: number): Promise<{ at: string; meta: any }[] | null> {
  // Filtered by kind on the server and only the small fields read (review: full rows every minute were heavy).
  const { data, error } = await supabaseAdmin.from('agent_activity')
    .select('created_at,key:metadata_json->>key,item_keys:metadata_json->item_keys,daily_summary:metadata_json->daily_summary')
    .eq('telegram_id', telegramId).eq('event_type', 'proactive_shadow').eq('metadata_json->>kind', kind)
    .gte('created_at', new Date(Date.now() - hours * 3600_000).toISOString()).order('created_at', { ascending: false }).limit(300)
  if (error) return null
  return (data || []).map((r: any) => ({ at: String(r.created_at || ''), meta: { key: r.key ?? null, item_keys: Array.isArray(r.item_keys) ? r.item_keys : [], daily_summary: r.daily_summary === true } }))
}

/** A shadow pass never holds up the real cron: it gets a bounded time, then the real path carries on. */
export async function withShadowBudget<T>(job: () => Promise<T>, ms = 15_000): Promise<T | 'timeout'> {
  let timer: any
  try { return await Promise.race([job(), new Promise<'timeout'>(r => { timer = setTimeout(() => r('timeout'), ms) })]) }
  finally { clearTimeout(timer) }
}
