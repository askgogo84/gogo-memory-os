// Production deps for Space block reads: the dashboard's own read functions, owner-scoped Supabase reads, and the
// Tipplr pilot adapter for workspace Spaces. Nothing here writes, sends or records "shown" events.
import type { AgentCapability, AgentPermissionLevel } from '@/lib/agent/policy'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { SourceDeps } from './sources'

const DAY = 86_400_000
// The dashboard calendar/reminder/mail reads take the id as a number. Only ids a JS number holds exactly go to them;
// anything else is reported as unreadable rather than converted.
const safeNumericId = (owner: string) => { const n = Number(owner); return Number.isSafeInteger(n) && String(n) === String(owner) }
const istStart = (now: number) => { const ist = now + 5.5 * 3_600_000; return ist - (ist % DAY) - 5.5 * 3_600_000 }

/** The one workspace whose Tipplr pilot tables Spaces may read. Unset → no Tipplr block reads anywhere. */
export function tipplrPilotWorkspace(env: Record<string, string | undefined> = process.env): string | null {
  const id = String(env.TIPPLR_PILOT_WORKSPACE_ID || '').trim()
  return /^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : null
}

export function liveSourceDeps(): SourceDeps {
  const pilot = tipplrPilotWorkspace()
  const onlyPilot = (ws: string) => { if (!pilot || ws.toLowerCase() !== pilot) throw new Error('not the Tipplr pilot workspace') }
  return {
    todayCalendar: async owner => safeNumericId(owner) ? (await import('@/lib/dashboard/queries')).getTodayCalendar(owner) : { ok: false },
    todayReminders: async owner => {
      if (!safeNumericId(owner)) return { ok: false }
      const r = await (await import('@/lib/dashboard/queries')).getTodayReminders(owner)
      return r.ok ? { ok: true, reminders: r.reminders.map(x => ({ message: String(x.message || ''), remind_at: x.remind_at })) } : { ok: false }
    },
    openLoops: async owner => {
      const { data, error } = await supabaseAdmin.from('agent_open_loops').select('title,summary,due_at,kind').eq('telegram_id', String(owner)).eq('status', 'active').not('source_type', 'in', '(approval,agent_run,life_event_action)').order('priority', { ascending: false }).order('updated_at', { ascending: false }).limit(16)
      if (error) { console.error('SPACE_LOOPS_READ_FAILED:', error.message); return null }
      return data || []
    },
    mailNeedsYou: async owner => {
      // The attention reader takes a number; refuse ids that a JS number cannot hold exactly instead of converting them.
      if (!safeNumericId(owner)) return null
      const n = Number(owner)
      const store = await import('@/lib/email/attention-store'); const att = await import('@/lib/email/attention')
      const [read, rules] = await Promise.all([store.readAttentionSources(n), store.loadRules(n)])
      if (!read.connected) return { connected: false, items: [] }
      const pick = att.pickAttention(read.emails, { rules, ownEmail: read.ownEmail, repliedSenders: read.repliedSenders } as any)
      return { connected: true, items: pick.picked.map((s: any) => ({ subject: s.email.subject, from: s.senderName || s.senderEmail, ask: s.ask || null })) }
    },
    nextTrip: async (owner, nowIso) => {
      const { data, error } = await supabaseAdmin.from('life_events').select('title,location,start_at,end_at,lifecycle_state').eq('telegram_id', String(owner)).eq('event_type', 'travel').gte('start_at', nowIso).order('start_at', { ascending: true }).limit(6)
      if (error) { console.error('SPACE_TRIPS_READ_FAILED:', error.message); return null }
      return (data || []).map((r: any) => ({ title: r.title, location: r.location, start_at: r.start_at, end_at: r.end_at, status: r.lifecycle_state }))
    },
    tipplr: {
      exceptions: async (workspaceId, now) => {
        onlyPilot(workspaceId)
        const { SupabaseAdapter } = await import('@/lib/enterprise/tipplr/supabase-adapter')
        const a = new SupabaseAdapter(supabaseAdmin, workspaceId)
        const out: { orderId: string; outlet: string; items: string; waitingMin: number }[] = []
        for (const o of await a.listOutlets()) {
          if (out.length >= 20) break
          for (const ord of await a.listNewOrders(o.id)) out.push({ orderId: ord.id, outlet: o.name, items: ord.items.map(l => `${l.qty}× ${l.name}`).join(', '), waitingMin: Math.max(0, Math.round((now - Date.parse(ord.createdAt)) / 60_000)) })
        }
        return out.sort((x, y) => y.waitingMin - x.waitingMin)
      },
      oosToday: async (workspaceId, now) => {
        onlyPilot(workspaceId)
        const { SupabaseAdapter } = await import('@/lib/enterprise/tipplr/supabase-adapter')
        const { dayStats } = await import('@/lib/enterprise/tipplr/stock-rules')
        const a = new SupabaseAdapter(supabaseAdmin, workspaceId)
        const from = new Date(istStart(now)).toISOString(), to = new Date(now).toISOString()
        let total = 0, outlets = 0; const byHour = new Map<number, number>()
        for (const o of await a.listOutlets()) {
          const list = await a.listOrders(o.id, from)
          const s = dayStats(o.id, list, from, to)
          if (s.outOfStock) { total += s.outOfStock; outlets++ }
          for (const ord of list) if (ord.cancelReason === 'out_of_stock') { const h = Math.floor(((Date.parse(ord.createdAt) / 3_600_000) + 5.5) % 24); byHour.set(h, (byHour.get(h) || 0) + 1) }
        }
        const peak = [...byHour.entries()].sort((x, y) => y[1] - x[1])[0]
        return { cancelledOos: total, outlets, peak: peak ? `${String(peak[0]).padStart(2, '0')}:00` : null }
      },
      digest: async (workspaceId, now) => {
        onlyPilot(workspaceId)
        const { SupabaseAdapter } = await import('@/lib/enterprise/tipplr/supabase-adapter')
        const { SupabaseScheduleStore } = await import('@/lib/enterprise/tipplr/schedules')
        const dg = await import('@/lib/enterprise/tipplr/digest')
        return dg.formatDigest(await dg.buildDigest(new SupabaseAdapter(supabaseAdmin, workspaceId), new SupabaseScheduleStore(supabaseAdmin), now))
      },
    },
  }
}

/** The owner's permission levels; anything not set reads as allowed-to-read. 'off' is respected. */
export async function permissionReader(owner: string): Promise<(c: AgentCapability) => AgentPermissionLevel> {
  const { data } = await supabaseAdmin.from('agent_permissions').select('capability,level').eq('telegram_id', String(owner))
  const m = new Map<string, AgentPermissionLevel>((data || []).map((r: any) => [r.capability, r.level]))
  return c => m.get(c) || 'read'
}

export function spacesEnabledFor(owner: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.GOGO_SPACES === '1') return true
  return String(env.GOGO_SPACES_OWNERS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(owner))
}

/** v2 three-tab navigation (9 Nov mock). Off by default; GOGO_NAV_V2=1 for everyone or GOGO_NAV_V2_OWNERS=<ids>. */
export function navV2EnabledFor(owner: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.GOGO_NAV_V2 === '1') return true
  return String(env.GOGO_NAV_V2_OWNERS || '').split(',').map(s => s.trim()).filter(Boolean).includes(String(owner))
}
