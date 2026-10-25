// Morning intelligence (Duet brief Phase 3): the top of the daily brief answers "what needs me, what is Gogo
// doing, what's coming up, what got done" from saved state only — approvals, attention items, meeting prep,
// running tasks, active watches and tasks completed in the last day. Empty sections are left out; a failed read
// leaves its section out rather than claiming "nothing" (the dashboard remains the full view).
import { supabaseAdmin } from '@/lib/supabase-admin'

export type IntelInput = {
  approvals: Array<{ title?: string | null }>
  loops: Array<{ title?: string | null; summary?: string | null; priority?: number | null; source_type?: string | null; due_at?: string | null }>
  running: Array<{ title?: string | null }>
  watchers: Array<{ title?: string | null; condition_json?: any }>
  done: Array<{ title?: string | null; summary?: string | null }>
}

const clean = (s: unknown, n = 90) => String(s ?? '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim().slice(0, n)
const list = (items: string[], max: number) => items.slice(0, max).map(x => `• ${x}`).join('\n') + (items.length > max ? `\n• +${items.length - max} more on your dashboard` : '')
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]

export function composeIntelligence(i: IntelInput): string[] {
  const blocks: string[] = []
  const urgent = i.loops.filter(l => Number(l.priority || 0) >= 0.85 && l.source_type !== 'meeting_prep')
  const need = uniq([
    ...(i.approvals.length ? [`${i.approvals.length} approval${i.approvals.length > 1 ? 's' : ''} waiting: ${clean(i.approvals[0].title, 60)}${i.approvals.length > 1 ? ' and more' : ''}`] : []),
    ...urgent.map(l => clean(l.title)),
  ])
  if (need.length) blocks.push(`🎯 *Needs you*\n${list(need, 4)}`)
  const prep = i.loops.filter(l => l.source_type === 'meeting_prep').sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
  if (prep.length) blocks.push(`📝 *Meeting prep*\n${prep.slice(0, 3).map(p => `• ${clean(p.title, 80)}\n  ${clean(p.summary, 220)}`).join('\n')}`)
  const doing = uniq([...i.running.map(r => clean(r.title)), ...i.watchers.map(w => clean(w.title || w.condition_json?.title))])
  if (doing.length) blocks.push(`🤖 *Gogo is handling*\n${list(doing, 4)}`)
  const done = uniq(i.done.map(d => clean(d.title)))
  if (done.length) blocks.push(`✅ *Done since yesterday*\n${list(done, 4)}`)
  const later = i.loops.filter(l => Number(l.priority || 0) < 0.85 && l.source_type !== 'meeting_prep').length
  if (later) blocks.push(`⏳ *Can wait*\n• ${later} lower-priority item${later > 1 ? 's' : ''} — on your dashboard when you have time`)
  return blocks
}

export async function loadIntelligence(telegramId: number | string, now = new Date()): Promise<string[]> {
  const tg = String(telegramId)
  const since = new Date(now.getTime() - 86_400_000).toISOString()
  const [approvals, loops, running, watchers, done] = await Promise.all([
    supabaseAdmin.from('agent_approvals').select('title').eq('telegram_id', tg).eq('status', 'pending').limit(10),
    supabaseAdmin.from('agent_open_loops').select('title,summary,priority,source_type,due_at').eq('telegram_id', tg).eq('status', 'active').order('priority', { ascending: false }).limit(30),
    supabaseAdmin.from('agent_runs').select('title').eq('telegram_id', tg).in('status', ['running', 'queued']).limit(8),
    supabaseAdmin.from('agent_watchers').select('condition_json').eq('telegram_id', tg).eq('active', true).neq('type', 'goal_review').limit(10),
    supabaseAdmin.from('agent_runs').select('title,summary').eq('telegram_id', tg).eq('status', 'completed').is('error', null).gte('updated_at', since).neq('type', 'secure_browser').order('updated_at', { ascending: false }).limit(8),
  ])
  for (const r of [approvals, loops, running, watchers, done] as any[]) if (r?.error) throw new Error('briefing_intelligence_unavailable')
  const rows = (r: any) => (Array.isArray(r?.data) ? r.data : [])
  // Past meetings and loops due long ago are not "now".
  const live = rows(loops).filter((l: any) => l.source_type !== 'meeting_prep' || Date.parse(String(l.due_at || '')) > now.getTime())
  return composeIntelligence({ approvals: rows(approvals), loops: live, running: rows(running), watchers: rows(watchers), done: rows(done) })
}
