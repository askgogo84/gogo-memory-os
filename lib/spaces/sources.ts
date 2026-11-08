// Gogo Spaces — block data (six docs §2 "Source resolvers"). One read per registered source, owner- or workspace-
// scoped, reusing the dashboard's existing reads. A block whose capability is 'off' is not read at all
// (refreshableBlocks); a source whose connector isn't linked says so; nothing here writes or sends.
import type { AgentCapability, AgentPermissionLevel } from '@/lib/agent/policy'
import { SPACE_SOURCES, refreshableBlocks, type Space, type SpaceBlock, type SpaceSourceId } from './schema'

export type Tone = 'warn' | 'crit' | 'good' | 'plum'
export type BlockItem = { title: string; sub?: string; time?: string; pill?: { text: string; tone: Tone } }
export type BlockData =
  | { status: 'ok'; items?: BlockItem[]; stats?: { n: string; label: string }[]; table?: { columns: string[]; rows: string[][] }; note?: string; readAt: string }
  | { status: 'empty'; message: string; readAt: string }
  | { status: 'not_connected'; capability: AgentCapability; message: string }
  | { status: 'error'; message: string }

export type Reader = (ctx: ReadCtx, params: Record<string, unknown>) => Promise<BlockData>
export type ReadCtx = { owner: string; workspaceId: string | null; now: number; tz: string; deps: SourceDeps }

/** Everything a resolver touches comes through deps, so tests run without Supabase or Gmail. */
export type SourceDeps = {
  todayCalendar: (owner: string) => Promise<{ ok: boolean; connected?: boolean; events?: { title: string; time: string | null; startAt?: string | null }[] }>
  todayReminders: (owner: string) => Promise<{ ok: boolean; reminders?: { message: string; remind_at: string }[] }>
  openLoops: (owner: string) => Promise<{ title: string; summary?: string | null; due_at?: string | null; kind?: string }[] | null>
  mailNeedsYou: (owner: string) => Promise<{ connected: boolean; items: { subject: string; from: string; ask?: string | null }[] } | null>
  nextTrip: (owner: string, nowIso: string) => Promise<{ title: string; location?: string | null; start_at: string; end_at?: string | null; status?: string | null }[] | null>
  tipplr: null | {
    exceptions: (workspaceId: string, now: number) => Promise<{ orderId: string; outlet: string; items: string; waitingMin: number }[]>
    oosToday: (workspaceId: string, now: number) => Promise<{ cancelledOos: number; outlets: number; peak: string | null }>
    digest: (workspaceId: string, now: number) => Promise<string>
  }
}

const fmtTime = (iso: string | null | undefined, tz: string) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : ''
const fmtDay = (iso: string, tz: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
const at = (now: number) => new Date(now).toISOString()
const clip = (s: unknown, n: number) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

export const READERS: Record<SpaceSourceId, Reader> = {
  'today.calendar': async ({ owner, now, tz, deps }) => {
    const c = await deps.todayCalendar(owner)
    if (!c.ok) return { status: 'error', message: "I couldn't read your calendar just now." }
    if (!c.connected) return { status: 'not_connected', capability: 'calendar', message: 'Connect Google Calendar and today shows here.' }
    if (!c.events?.length) return { status: 'empty', message: 'Nothing on your calendar today.', readAt: at(now) }
    return { status: 'ok', items: c.events.slice(0, 12).map(e => ({ time: e.time || fmtTime(e.startAt, tz) || 'All day', title: clip(e.title, 80) })), readAt: at(now) }
  },
  'today.reminders': async ({ owner, now, tz, deps }) => {
    const r = await deps.todayReminders(owner)
    if (!r.ok) return { status: 'error', message: "I couldn't read your reminders just now." }
    if (!r.reminders?.length) return { status: 'empty', message: 'No reminders left today.', readAt: at(now) }
    return { status: 'ok', items: r.reminders.slice(0, 10).map(x => ({ time: fmtTime(x.remind_at, tz), title: clip(x.message, 100) })), readAt: at(now) }
  },
  'today.open_loops': async ({ owner, now, deps }) => {
    const rows = await deps.openLoops(owner)
    if (!rows) return { status: 'error', message: "I couldn't read your open loops just now." }
    if (!rows.length) return { status: 'empty', message: 'No open loops. Nice.', readAt: at(now) }
    return { status: 'ok', readAt: at(now), items: rows.slice(0, 8).map(l => {
      const due = l.due_at ? Date.parse(l.due_at) : NaN
      const pill = Number.isFinite(due) ? (due < now ? { text: 'overdue', tone: 'crit' as Tone } : due - now < 86_400_000 ? { text: 'today', tone: 'warn' as Tone } : undefined) : undefined
      return { title: clip(l.title, 90), sub: clip(l.summary, 120) || undefined, pill }
    }) }
  },
  'mail.attention': async ({ owner, now, deps }) => {
    const m = await deps.mailNeedsYou(owner)
    if (!m) return { status: 'error', message: "I couldn't read your mail just now." }
    if (!m.connected) return { status: 'not_connected', capability: 'email', message: 'Connect Gmail and the emails that need you show here. Nothing is read until you do.' }
    if (!m.items.length) return { status: 'empty', message: 'No email needs you right now.', readAt: at(now) }
    return { status: 'ok', readAt: at(now), items: m.items.slice(0, 6).map(e => ({ title: clip(e.subject, 90), sub: clip([e.from, e.ask].filter(Boolean).join(' · '), 140) })) }
  },
  'trip.next': async ({ owner, now, tz, deps }) => {
    const rows = await deps.nextTrip(owner, at(now))
    if (!rows) return { status: 'error', message: "I couldn't read your trips just now." }
    if (!rows.length) return { status: 'empty', message: 'No upcoming trip. Forward a booking or ask Gogo to plan one.', readAt: at(now) }
    return { status: 'ok', readAt: at(now), items: rows.slice(0, 6).map(t => ({ time: fmtDay(t.start_at, tz), title: clip(t.title, 80), sub: clip([t.location, t.end_at ? `until ${fmtDay(t.end_at, tz)}` : ''].filter(Boolean).join(' · '), 100) || undefined })) }
  },
  'trip.fares': async ({ now }) => ({ status: 'empty', message: 'No fare watch for this trip yet. Ask Gogo: "watch fares BLR to GOI on 12 Dec".', readAt: at(now) }),
  'tipplr.exceptions': async ({ workspaceId, now, deps }) => {
    if (!workspaceId || !deps.tipplr) return { status: 'error', message: 'This block belongs to a Tipplr workspace Space.' }
    const rows = await deps.tipplr.exceptions(workspaceId, now)
    if (!rows.length) return { status: 'empty', message: 'No order is waiting for a decision.', readAt: at(now) }
    return { status: 'ok', readAt: at(now), table: { columns: ['Order', 'Outlet', 'Items', 'Waiting'], rows: rows.slice(0, 20).map(r => [`#${r.orderId}`, r.outlet, clip(r.items, 60), `${r.waitingMin} min`]) } }
  },
  'tipplr.oos_today': async ({ workspaceId, now, deps }) => {
    if (!workspaceId || !deps.tipplr) return { status: 'error', message: 'This block belongs to a Tipplr workspace Space.' }
    const s = await deps.tipplr.oosToday(workspaceId, now)
    return { status: 'ok', readAt: at(now), stats: [{ n: String(s.cancelledOos), label: 'cancelled out of stock' }, { n: String(s.outlets), label: 'outlets' }, ...(s.peak ? [{ n: s.peak, label: 'peak' }] : [])] }
  },
  'tipplr.digest': async ({ workspaceId, now, deps }) => {
    if (!workspaceId || !deps.tipplr) return { status: 'error', message: 'This block belongs to a Tipplr workspace Space.' }
    return { status: 'ok', readAt: at(now), note: await deps.tipplr.digest(workspaceId, now) }
  },
}

/** Data for every block of a Space. Off capabilities are never read; a reader that throws becomes an error block. */
export async function resolveSpace(space: Space, ctx: Omit<ReadCtx, 'workspaceId'>, permission: (c: AgentCapability) => AgentPermissionLevel): Promise<Record<string, BlockData>> {
  const workspaceId = space.scope.kind === 'workspace' ? space.scope.workspaceId : null
  const { ok, blocked } = refreshableBlocks(space, permission)
  const out: Record<string, BlockData> = {}
  for (const b of blocked) out[b.block.id] = { status: 'not_connected', capability: b.capability, message: `Turned off in your permissions (${b.capability}). Nothing is read.` }
  await Promise.all(ok.filter((b): b is SpaceBlock & { source: NonNullable<SpaceBlock['source']> } => !!b.source).map(async b => {
    try { out[b.id] = await READERS[b.source.id]({ ...ctx, workspaceId }, b.source.params || {}) }
    catch (e: any) { console.error('SPACE_SOURCE_FAILED:', b.source.id, String(e?.message || e).slice(0, 120)); out[b.id] = { status: 'error', message: "Couldn't read this just now." } }
  }))
  return out
}

export function sourceCapability(id: SpaceSourceId): AgentCapability { return SPACE_SOURCES[id].capability }
