import { supabaseAdmin } from '@/lib/supabase-admin'

// Phase 1D — Personalization rules ("standing preferences").
// Standing instructions like "always keep my lists in capitals", "from now on
// address me as boss", "whenever I say DW I mean my wife" — injected into the
// assistant's system prompt so they're always honored.

export const MAX_RULES = 20

const PERSONALITY_PROMPTS: Record<string, string> = {
  calm_companion: 'Use a calm, warm, capable tone. Be concise and reassuring without being sugary, patronizing, or vague.',
  sharp_professional: 'Use a crisp professional tone. Lead with the answer, structure only when useful, and keep wording efficient.',
  straight_talking_coach: 'Use a direct, action-oriented coaching tone. Be clear about the next move and avoid motivational fluff.',
  quiet_minimalist: 'Use the shortest useful answer. Keep chatter low, avoid unnecessary headings, and surface only what matters.',
}

/** Detect a standing-instruction save. Returns the rule text, or null. */
export function detectPreferenceSave(text: string): string | null {
  const t = (text || '').trim()
  const m =
    t.match(/^always\s+(.+)/i) ||
    t.match(/^from now on,?\s+(.+)/i) ||
    t.match(/^(?:set|add|save) a rule[:,]?\s+(.+)/i) ||
    t.match(/^my preference(?:\s+is)?[:,]?\s+(.+)/i) ||
    t.match(/^whenever i\s+(.+)/i) ||
    t.match(/^remember to always\s+(.+)/i) ||
    t.match(/^(?:please\s+)?address me as\s+(.+)/i)
  if (!m) return null
  const rule = m[1].trim().replace(/[.\s]+$/, '')
  return rule.length > 2 ? rule : null
}

export function isPreferenceList(text: string): boolean {
  const l = (text || '').trim().toLowerCase()
  return (
    l === 'my rules' || l === 'show my rules' || l === 'rules' ||
    l === 'my preferences' || l === 'show my preferences' || l === 'preferences'
  )
}

export function detectPreferenceForget(text: string): string | null {
  const m = (text || '').trim().match(/^forget (?:the )?(?:rule|preference)\s+(?:about\s+)?(.+)/i)
  return m ? m[1].trim() : null
}

export async function savePreference(
  telegramId: number,
  ruleText: string
): Promise<{ ok: boolean; count: number; capped?: boolean }> {
  const { count } = await supabaseAdmin
    .from('user_preferences')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
  if ((count || 0) >= MAX_RULES) return { ok: false, count: count || 0, capped: true }
  await supabaseAdmin.from('user_preferences').insert({ telegram_id: telegramId, rule_text: ruleText })
  return { ok: true, count: (count || 0) + 1 }
}

export async function listPreferences(telegramId: number): Promise<{ id: string; rule_text: string }[]> {
  const { data } = await supabaseAdmin
    .from('user_preferences')
    .select('id, rule_text')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: true })
  return (data || []) as { id: string; rule_text: string }[]
}

export async function forgetPreference(telegramId: number, match: string): Promise<number> {
  const rules = await listPreferences(telegramId)
  const q = match.toLowerCase().trim()
  const hits = rules.filter((r) => r.rule_text.toLowerCase().includes(q))
  if (!hits.length) return 0
  await supabaseAdmin.from('user_preferences').delete().in('id', hits.map((h) => h.id))
  return hits.length
}

/** System-prompt block injected into every Claude freeform call. */
export async function getPreferenceBlock(telegramId: number): Promise<string> {
  const [rules, experienceResult] = await Promise.all([
    listPreferences(telegramId),
    supabaseAdmin
      .from('user_experience_preferences')
      .select('personality')
      .eq('telegram_id', telegramId)
      .maybeSingle(),
  ])

  const personality = String(experienceResult.data?.personality || 'calm_companion')
  const tone = PERSONALITY_PROMPTS[personality] || PERSONALITY_PROMPTS.calm_companion
  const parts = [
    `\n\nAskGogo conversation style for this user:\n- ${tone}\n- Personality changes tone only. Never change facts, privacy rules, safety boundaries, or action semantics.`,
  ]

  if (rules.length) {
    parts.push(
      `\nStanding preferences for this user (ALWAYS follow — they override defaults):\n` +
      rules.map((r) => `- ${r.rule_text}`).join('\n')
    )
  }

  return parts.join('\n')
}
