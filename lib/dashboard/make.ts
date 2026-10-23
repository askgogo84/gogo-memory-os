// Duet parity step 3 (approved 22 Oct mock, screen 3): Make — the finished work Gogo produced (briefs, comparisons,
// plans, trackers), separate from Library (documents the person sent in). Reads agent_artifacts, owner-scoped.
import { supabaseAdmin } from '@/lib/supabase-admin'

export const MAKE_KINDS = [
  { key: 'all', label: 'All', types: [] as string[] },
  { key: 'briefs', label: 'Briefs', types: ['research_brief', 'meeting_brief', 'daily_brief', 'decision_summary'] },
  { key: 'comparisons', label: 'Comparisons', types: ['comparison'] },
  { key: 'plans', label: 'Plans', types: ['trip', 'goal_plan'] },
  { key: 'trackers', label: 'Trackers', types: ['application_tracker', 'reward_summary'] },
  // Make: real slides and sheets (approved 24 Oct mock, screen 4).
  { key: 'slides', label: 'Slides', types: ['slide_deck'] },
  { key: 'sheets', label: 'Sheets', types: ['spreadsheet'] },
] as const
export type MakeKind = typeof MAKE_KINDS[number]['key']

const TYPE_LABEL: Record<string, string> = {
  research_brief: 'Brief', meeting_brief: 'Meeting brief', comparison: 'Comparison', trip: 'Trip plan',
  goal_plan: 'Goal plan', application_tracker: 'Tracker', reward_summary: 'Rewards',
  // Make v2: registered kinds. No writer saves daily_brief yet (the morning brief is sent, not saved); see verify-make-artifacts-v2.
  daily_brief: 'Daily brief', decision_summary: 'Decision summary',
  slide_deck: 'Slides', spreadsheet: 'Sheet',
}
export function makeKind(raw: unknown): MakeKind {
  return (MAKE_KINDS.find(k => k.key === raw)?.key || 'all') as MakeKind
}
export function typeLabel(type: string) { return TYPE_LABEL[type] || 'Result' }

export type MadeItem = { id: string; type: string; label: string; title: string; subtitle: string; updatedAt: string | null; href: string }

export async function getMadeForYou(telegramId: string, kind: MakeKind = 'all'): Promise<{ ok: boolean; items: MadeItem[]; counts: Record<MakeKind, number> }> {
  const counts = Object.fromEntries(MAKE_KINDS.map(k => [k.key, 0])) as Record<MakeKind, number>
  const tg = String(telegramId || '')
  if (!tg) return { ok: true, items: [], counts }
  const { data, error } = await supabaseAdmin.from('agent_artifacts').select('id,type,title,subtitle,updated_at')
    .eq('telegram_id', tg).order('updated_at', { ascending: false }).limit(120)
  if (error) { console.error('MAKE_READ_FAILED:', error.message); return { ok: false, items: [], counts } }
  // 23 Oct live: Make listed "walk 8000 steps daily" and "Keep my upcoming travel documents…" twice each (a goal
  // tracker saved again). Same type + same title is one card (newest), noting the earlier copies.
  const seen = new Map<string, any>()
  for (const r of (data || []) as any[]) {
    const key = `${r.type}|${String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
    const first = seen.get(key)
    if (first) first.__copies = (first.__copies || 1) + 1
    else seen.set(key, r)
  }
  const rows: any[] = [...seen.values()]
  for (const k of MAKE_KINDS) counts[k.key] = k.key === 'all' ? rows.length : rows.filter(r => (k.types as readonly string[]).includes(String(r.type))).length
  const types = MAKE_KINDS.find(k => k.key === kind)!.types as readonly string[]
  const items = rows.filter(r => !types.length || types.includes(String(r.type))).slice(0, 60).map(r => ({
    id: String(r.id), type: String(r.type), label: typeLabel(String(r.type)), title: String(r.title || 'Saved result'),
    subtitle: [String(r.subtitle || ''), r.__copies > 1 ? `${r.__copies} saved versions` : ''].filter(Boolean).join(' · '), updatedAt: r.updated_at || null, href: `/dashboard/reports/${encodeURIComponent(String(r.id))}`,
  }))
  return { ok: true, items, counts }
}
