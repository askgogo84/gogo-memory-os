// Proactive comparison (13 Nov, owner-approved): Gogo's volunteered messages are off by the owner's 4 Nov quiet rule,
// while Instinct sent the four that mattered (WeWork dues, a meeting in 10 minutes, a stale-list cleanup, a provider
// breach). For owners listed in GOGO_PROACTIVE_SHADOW only, the email pulse and the meeting nudge compute what they
// WOULD send and log it as agent_activity 'proactive_shadow'. Nothing is claimed, sent, backed off or marked shown.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

/** Exact legacy ids only (negative allowed: the owner's id is negative). Anything else is ignored. */
export function proactiveShadowOwners(env: Record<string, string | undefined> = process.env): string[] {
  return [...new Set(String(env.GOGO_PROACTIVE_SHADOW || '').split(',').map(s => s.trim()).filter(s => /^-?[1-9]\d{0,19}$/.test(s)))]
}

/** Logged text: secrets redacted, long digit runs masked (account numbers), bounded. */
export function shadowText(value: unknown, max = 200): string {
  return redactSecretShapedText(String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim())
    .replace(/\b\d{9,20}\b/g, d => '••••' + d.slice(-4)).slice(0, max)
}

export type ShadowKind = 'email' | 'meeting' | 'cleanup'
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
  const { data, error } = await supabaseAdmin.from('agent_activity').select('metadata_json,created_at').eq('telegram_id', telegramId)
    .eq('event_type', 'proactive_shadow').gte('created_at', new Date(Date.now() - hours * 3600_000).toISOString()).order('created_at', { ascending: false }).limit(300)
  if (error) return null
  return (data || []).filter((r: any) => r.metadata_json?.kind === kind).map((r: any) => ({ at: String(r.created_at || ''), meta: r.metadata_json || {} }))
}
