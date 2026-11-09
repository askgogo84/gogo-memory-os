// Writes today's topic brief for one owner into Make (agent_artifacts, type daily_brief) and reads it back for the
// dashboard chat. One row per owner per IST day (title is the key). Reads are the Spaces resolvers, owner-scoped,
// permission-aware (an 'off' capability is never read). Nothing here sends.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { templateSpace } from '@/lib/spaces/schema'
import { resolveSpace, type BlockData } from '@/lib/spaces/sources'
import { liveSourceDeps, permissionReader, tipplrPilotWorkspace } from '@/lib/spaces/sources-live'
import { briefTitle, composeTopicBrief, type TopicBrief } from './topic-brief'

export const DAILY_BRIEF_SCHEMA = 2

export function istDate(now = Date.now()): string { return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10) }

/** Build and save today's brief. Returns the brief, or null when the owner id is unusable. Idempotent per day. */
export async function writeDailyBrief(owner: string, now = Date.now()): Promise<TopicBrief | null> {
  const tg = String(owner)
  if (!/^-?\d{1,20}$/.test(tg)) return null
  const date = istDate(now)
  const deps = liveSourceDeps()
  const permission = await permissionReader(tg)
  const ctx = { owner: tg, now, tz: 'Asia/Kolkata', deps }
  const blocks: Record<string, BlockData | undefined> = {}
  const scope = { kind: 'user' as const, telegramId: tg }
  for (const t of ['my_day', 'trip_board'] as const) {
    const data = await resolveSpace(templateSpace(t, scope, now), ctx, permission).catch(() => ({}))
    Object.assign(blocks, data)
  }
  // Tipplr only for members of the pilot workspace.
  let tipplrHref: string | null = null
  const pilot = tipplrPilotWorkspace()
  if (pilot) {
    const access = await import('@/lib/workspaces/access')
    const member = await access.getMembership(tg, pilot).catch(() => null)
    if (member) {
      tipplrHref = `/dashboard/spaces/tipplr_exceptions?workspace=${pilot}`
      const data = await resolveSpace(templateSpace('tipplr_exceptions', { kind: 'workspace', workspaceId: pilot }, now), ctx, () => 'read').catch(() => ({}))
      Object.assign(blocks, data)
    }
  }
  const brief = composeTopicBrief(blocks, { date, now, tipplrHref })
  const title = briefTitle(date)
  const { data: existing } = await supabaseAdmin.from('agent_artifacts').select('id').eq('telegram_id', tg).eq('type', 'daily_brief').eq('title', title).maybeSingle()
  // Sections so the saved brief reads in /dashboard/reports like any other Make result.
  const sections = [
    { title: 'Needs you', tool: 'brief', result: { text: brief.items.filter(i => i.tone === 'needs_you').map(i => `${i.topic}: ${i.text}`).join('\n') || 'Nothing needs you this morning.' } },
    { title: 'Gogo has it', tool: 'brief', result: { text: brief.items.filter(i => i.tone === 'handled').map(i => `${i.topic}: ${i.text}`).join('\n') || 'Nothing else to report.' } },
  ]
  const row = { telegram_id: tg, type: 'daily_brief', title, subtitle: `${brief.items.length} items · ${brief.needsYou} needed you`, schema_version: DAILY_BRIEF_SCHEMA, content_json: { format: 'topic_brief', ...brief, sections }, source_refs: Object.keys(blocks).map(k => `space_block:${k}`) }
  const res = existing?.id
    ? await supabaseAdmin.from('agent_artifacts').update({ ...row, updated_at: new Date(now).toISOString() }).eq('id', existing.id).eq('telegram_id', tg)
    : await supabaseAdmin.from('agent_artifacts').insert(row)
  if (res.error) { console.error('DAILY_BRIEF_WRITE_FAILED:', res.error.message); return brief }
  console.log('DAILY_BRIEF_WRITTEN:', JSON.stringify({ owner: tg, date, items: brief.items.length, needsYou: brief.needsYou }))
  return brief
}

/** Today's saved brief for the chat, or null. Never builds one (that is the cron's job). */
export async function readTodaysBrief(owner: string, now = Date.now()): Promise<(TopicBrief & { artifactId: string }) | null> {
  const tg = String(owner)
  const { data } = await supabaseAdmin.from('agent_artifacts').select('id,content_json').eq('telegram_id', tg).eq('type', 'daily_brief').eq('title', briefTitle(istDate(now))).maybeSingle()
  const c: any = data?.content_json
  if (!data?.id || !c || c.format !== 'topic_brief' || !Array.isArray(c.items)) return null
  return { artifactId: String(data.id), date: String(c.date), items: c.items, needsYou: Number(c.needsYou || 0), generatedAt: String(c.generatedAt || '') }
}
