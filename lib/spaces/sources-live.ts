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

export function liveSourceDeps(): SourceDeps {
  return {
    todayCalendar: async owner => safeNumericId(owner) ? (await import('@/lib/dashboard/queries')).getTodayCalendar(owner) : { ok: false },
    todayReminders: async owner => {
      if (!safeNumericId(owner)) return { ok: false }
      const r = await (await import('@/lib/dashboard/queries')).getTodayReminders(owner)
      return r.ok ? { ok: true, reminders: r.reminders.map(x => ({ message: String(x.message || ''), remind_at: x.remind_at })) } : { ok: false }
    },
    openLoops: async owner => {
      const { data, error } = await supabaseAdmin.from('agent_open_loops').select('title,summary,due_at,kind').eq('telegram_id', String(owner)).eq('status', 'active').not('source_type', 'in', '(approval,agent_run,life_event_action)').order('priority', { ascending: false }).order('updated_at', { ascending: false }).limit(8)
      return error ? null : (data || [])
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
      const { data, error } = await supabaseAdmin.from('life_events').select('title,location,start_at,end_at,status').eq('telegram_id', String(owner)).gte('start_at', nowIso).order('start_at', { ascending: true }).limit(6)
      return error ? null : (data || [])
    },
    tipplr: {
      exceptions: async (workspaceId, now) => {
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
