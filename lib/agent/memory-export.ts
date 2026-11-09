// Active Memory — the owner can take everything AskGogo remembers about them, with provenance (which table, which row,
// when). Exact-owner reads only: the telegram id stays a string end to end (no Number()), every query is .eq on it.
// Internal/system rows (usage counters, follow-up state JSON) are left out, exactly as the "my memory" view leaves them out.
import { supabaseAdmin } from '@/lib/supabase-admin'

export type ExportedFact = { id: string; source: 'memories' | 'user_insights' | 'user_memory_profile' | 'life_events' | 'reminders' | 'documents' | 'places'; text: string; at: string | null; provenance: Record<string, unknown> }
export type MemoryExport = { owner: string; generatedAt: string; counts: Record<string, number>; facts: ExportedFact[]; memoryEnabled: boolean | null; note: string }

const INTERNAL = /^(?:askgogo_usage:|askgogo_meeting_notes_created:|\s*[\[{])|followup_state|meeting_action_items|reminder_ampm|calendar_conflict|founder pricing \/ paid plan launch/i
const clean = (s: unknown) => String(s || '').replace(/^ASKGOGO_USAGE:[^:]+:[^:]+:/, '').replace(/\s+/g, ' ').trim()

type Db = { from: (t: string) => any }

/** Everything remembered for one owner. Tables that do not exist or refuse are reported in `note`, never thrown. */
export async function exportMemory(telegramId: string, db: Db = supabaseAdmin, now = Date.now()): Promise<MemoryExport> {
  const tg = String(telegramId)
  const facts: ExportedFact[] = []
  const skipped: string[] = []
  const read = async (table: string, q: (b: any) => any): Promise<any[]> => {
    try { const { data, error } = await q(db.from(table).select('*').eq('telegram_id', tg)); if (error) { skipped.push(table); return [] } return data || [] }
    catch { skipped.push(table); return [] }
  }
  const push = (f: ExportedFact) => { if (f.text && !INTERNAL.test(f.text)) facts.push(f) }

  for (const m of await read('memories', b => b.order('created_at', { ascending: false }).limit(1000)))
    if (!INTERNAL.test(String(m.content || ''))) push({ id: String(m.id), source: 'memories', text: clean(m.content), at: m.created_at || null, provenance: { table: 'memories', id: m.id, created_at: m.created_at } })
  for (const i of await read('user_insights', b => b.eq('status', 'active').order('confidence', { ascending: false }).limit(200)))
    push({ id: String(i.id), source: 'user_insights', text: clean(i.insight || i.summary || i.content || i.text), at: i.updated_at || i.created_at || null, provenance: { table: 'user_insights', id: i.id, confidence: i.confidence ?? null, kind: i.kind || i.insight_type || null } })
  for (const p of await read('user_memory_profile', b => b.limit(1)))
    for (const [k, v] of Object.entries(p)) { if (['telegram_id', 'id', 'created_at', 'updated_at'].includes(k) || v == null || v === '' || (Array.isArray(v) && !v.length)) continue; push({ id: `profile.${k}`, source: 'user_memory_profile', text: `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`.slice(0, 500), at: p.updated_at || null, provenance: { table: 'user_memory_profile', column: k } }) }
  for (const e of await read('life_events', b => b.order('start_at', { ascending: false }).limit(300)))
    push({ id: String(e.id), source: 'life_events', text: clean([e.title || e.summary, e.location, e.start_at ? `from ${e.start_at}` : '', e.end_at ? `to ${e.end_at}` : ''].filter(Boolean).join(' · ')), at: e.start_at || e.created_at || null, provenance: { table: 'life_events', id: e.id, kind: e.kind || e.event_type || null, status: e.status || null, source: e.source || null } })
  for (const r of await read('reminders', b => b.eq('sent', false).order('remind_at', { ascending: true }).limit(200)))
    push({ id: String(r.id), source: 'reminders', text: clean(`${r.message} — ${r.remind_at}`), at: r.remind_at || null, provenance: { table: 'reminders', id: r.id, timezone: r.timezone || null } })
  for (const d of await read('documents', b => b.order('created_at', { ascending: false }).limit(200)))
    push({ id: String(d.id), source: 'documents', text: clean([d.title || d.file_name || d.name, d.category || d.kind].filter(Boolean).join(' · ')), at: d.created_at || null, provenance: { table: 'documents', id: d.id } })

  let memoryEnabled: boolean | null = null
  try { const { data } = await db.from('user_consent_settings').select('*').eq('telegram_id', tg).maybeSingle(); if (data && typeof data.memory_enabled === 'boolean') memoryEnabled = data.memory_enabled } catch {}

  const counts: Record<string, number> = {}
  for (const f of facts) counts[f.source] = (counts[f.source] || 0) + 1
  return { owner: tg, generatedAt: new Date(now).toISOString(), counts, facts, memoryEnabled, note: skipped.length ? `Not included (unavailable right now): ${skipped.join(', ')}.` : 'Complete.' }
}

/** A readable version of the same export. Pure. */
export function formatMemoryExport(x: MemoryExport): string {
  const label: Record<ExportedFact['source'], string> = { memories: 'Notes and things you told me', user_insights: 'Patterns I noticed', user_memory_profile: 'Profile', life_events: 'Trips, bookings and events', reminders: 'Open reminders', documents: 'Documents', places: 'Places' }
  const lines = [`# What AskGogo remembers`, `Generated ${x.generatedAt} · memory ${x.memoryEnabled === false ? 'off' : 'on'} · ${x.facts.length} items`, '']
  for (const src of Object.keys(label) as ExportedFact['source'][]) {
    const rows = x.facts.filter(f => f.source === src)
    if (!rows.length) continue
    lines.push(`## ${label[src]} (${rows.length})`)
    for (const r of rows) lines.push(`- ${r.text}${r.at ? `  _(${String(r.at).slice(0, 10)})_` : ''}  \`${r.source}:${r.id}\``)
    lines.push('')
  }
  lines.push(x.note, '', 'To remove one item: "forget <what it says>". To remove everything: "forget everything".')
  return lines.join('\n')
}

export const EXPORT_ASK = /^(?:export|download|send me|give me)\s+(?:all\s+)?(?:my\s+)?(?:memory|memories|everything you (?:know|remember)(?: about me)?|my data)\s*[.!]?$/i
