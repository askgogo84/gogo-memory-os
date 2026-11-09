// Production provider access for procedure nodes. Every read goes through an existing, owner-scoped loader; nothing
// here invents data. Writes: only what already has a verified executor is wired. A node without a wired executor
// fails closed with outcomeKnown=true (nothing was attempted), so the run ends 'failed', never 'done'.
import type { AgentActor } from '@/lib/agent/actor'
import type { ExecutionEvidence } from '@/lib/agent/execution-evidence'
import { ProcedureExecuteError, type ProcedureIO } from './runtime'

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

async function readCalendarEvent(actor: AgentActor, eventId: string) {
  const { executeReadOnlyCalendarStep } = await import('@/lib/agent/calendar-read')
  const out: any = await executeReadOnlyCalendarStep({ actor, instruction: 'what is on my calendar this week', missionText: 'what is on my calendar this week' })
  const events: any[] = Array.isArray(out?.output?.events) ? out.output.events : []
  const ev = events.find(e => String(e.id || '') === eventId) || (eventId === 'next' ? events.find(e => Date.parse(e.start) > Date.now()) : null)
  if (!ev) throw new Error('calendar_event_not_found')
  return { id: String(ev.id || eventId), title: clip(ev.summary, 160), start: ev.start, label: ev.label, meetLink: ev.meetLink || null, attendees: Array.isArray(ev.attendees) ? ev.attendees : [] }
}

async function readMeetingContext(actor: AgentActor, event: { attendees?: any[] }) {
  const guests = (event.attendees || []).filter((a: any) => !a.self && !a.resource && a.email).slice(0, 6)
  let threads: unknown[] | null = []
  if (guests.length) {
    try {
      const { searchWorkspaceEmailsByQuery } = await import('@/lib/agent/google-workspace-read')
      threads = await searchWorkspaceEmailsByQuery(actor, `(${guests.map((g: any) => `from:${g.email} OR to:${g.email}`).join(' OR ')}) newer_than:60d`, 3)
    } catch { threads = null }
  }
  const notes = await import('@/lib/agent/people').then(m => m.guestNotes(actor, guests), () => new Map<string, string[]>())
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { data: loops } = await supabaseAdmin.from('agent_open_loops').select('title').eq('telegram_id', String(actor.legacyTelegramId)).eq('status', 'active').order('created_at', { ascending: false }).limit(10)
  return {
    participants: guests.map((g: any) => ({ email: g.email, name: g.displayName || null, notes: notes.get(g.email) || [] })),
    threads: threads === null ? null : (threads as any[]).map(t => ({ subject: clip(t.subject, 120), from: clip(t.from, 80), date: t.date, snippet: clip(t.snippet, 200) })),
    openTasks: (loops || []).map((l: any) => clip(l.title, 120)),
    documentsAvailable: false, // Drive is not read in this procedure; the brief says so instead of guessing
    gmailAvailable: threads !== null,
  }
}

export const productionIO: ProcedureIO = {
  async read({ actor, def, node, context }) {
    const key = `${def.id}:${node.id}`
    switch (key) {
      case 'meetings.prepare:read_event': return { event: await readCalendarEvent(actor, String(context.eventId)) }
      case 'meetings.prepare:read_context': return readMeetingContext(actor, context.event as any)
      case 'travel.day:read_leg': {
        const { supabaseAdmin } = await import('@/lib/supabase-admin')
        const { data } = await supabaseAdmin.from('life_events').select('id,title,start_at,end_at,metadata_json,provider,location').eq('telegram_id', String(actor.legacyTelegramId)).eq('id', String(context.legId)).maybeSingle()
        if (!data) throw new Error('leg_not_found')
        const m = (data.metadata_json as any) || {}
        return { leg: { id: data.id, title: data.title, startAt: data.start_at, endAt: data.end_at, flightNo: m.flightNo || m.flight_no || null, from: m.from || null, to: m.to || null, provider: data.provider || null } }
      }
      case 'travel.day:read_live': {
        const leg = context.leg as any
        if (!leg?.flightNo) throw new Error('flight_number_unknown')
        const { lookupLiveFlight, formatLiveFlight } = await import('@/lib/agent/flight-track')
        const live = await lookupLiveFlight(String(leg.flightNo), new Date(), actor.timezone || 'Asia/Kolkata')
        if (!live) throw new Error('live_status_unavailable')
        return { flightStatus: live.status?.state || 'unknown', eta: live.arrRevisedLocal || live.arrLocal || null, liveText: formatLiveFlight(live) }
      }
      case 'enterprise.cancellation_incident:read_order': {
        // Internal pilot records only (merchant_orders, scoped by the outlet's workspace). Never a merchant endpoint.
        const { supabaseAdmin } = await import('@/lib/supabase-admin')
        const { data: outlets } = await supabaseAdmin.from('merchant_outlets').select('id,name').eq('workspace_id', String(context.workspaceId))
        const ids = (outlets || []).map((o: any) => String(o.id))
        if (!ids.length) throw new Error('workspace_has_no_outlets')
        const { data } = await supabaseAdmin.from('merchant_orders').select('id,outlet_id,source,state,cancel_reason,items,created_at').eq('id', String(context.orderRef)).in('outlet_id', ids).maybeSingle()
        if (!data) throw new Error('order_not_found')
        return { order: { ...data, outlet: (outlets || []).find((o: any) => o.id === data.outlet_id)?.name || data.outlet_id } }
      }
      case 'enterprise.cancellation_incident:read_history': {
        const { supabaseAdmin } = await import('@/lib/supabase-admin')
        const order = context.order as any
        const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
        const { data } = await supabaseAdmin.from('merchant_orders').select('id,cancel_reason,created_at').eq('outlet_id', String(order?.outlet_id || '')).eq('state', 'cancelled').gte('created_at', since).limit(50)
        return { recentCancellations: data || [], stockSignal: (data || []).some((r: any) => r.cancel_reason === 'out_of_stock') ? 'low' : 'none' }
      }
      case 'enterprise.cancellation_incident:create_task': {
        // An internal record for the store team, keyed so a re-run does not create a second one.
        const { supabaseAdmin } = await import('@/lib/supabase-admin')
        const text = `Cancellation incident ${context.orderRef}: ${context.cause || 'cause unknown'} (${context.severity || 'medium'})`.slice(0, 240)
        const { data: existing } = await supabaseAdmin.from('todos').select('id').eq('whatsapp_id', actor.whatsappId).eq('text', text).eq('done', false).maybeSingle()
        if (existing?.id) return { taskId: String(existing.id) }
        const { data, error } = await supabaseAdmin.from('todos').insert({ whatsapp_id: actor.whatsappId, text, done: false, created_at: new Date().toISOString() }).select('id').single()
        if (error || !data?.id) throw new Error(`task_create_failed:${error?.message || 'unknown'}`)
        return { taskId: String(data.id) }
      }
      default: throw new Error(`read_not_wired:${key}`)
    }
  },

  async reason({ def, node, context }) {
    const key = `${def.id}:${node.id}`
    // Deterministic reasoning for now: these briefs are composed from the reads, so nothing is invented.
    if (key === 'meetings.prepare:brief') {
      const ev = context.event as any; const ps = (context.participants as any[]) || []; const th = context.threads as any[] | null; const tasks = (context.openTasks as string[]) || []
      const missing: string[] = []
      if (context.documentsAvailable === false) missing.push('documents (Drive not read in this prep; say so rather than guess)')
      if (th === null) missing.push('email threads (Gmail not connected or not readable)')
      const lines = [
        `${ev?.title || 'Meeting'} · ${ev?.label || ev?.start || ''}`.trim(),
        ps.length ? `With: ${ps.map(p => p.name || p.email).join(', ')}` : 'No other guests on the invite.',
        ...ps.filter(p => p.notes?.length).map(p => `${p.name || p.email}: ${p.notes.slice(0, 2).join('; ')}`),
        th && th.length ? `Recent mail: ${th.slice(0, 3).map(t => t.subject).join(' · ')}` : '',
        tasks.length ? `Open with you: ${tasks.slice(0, 3).join(' · ')}` : '',
        missing.length ? `Not checked: ${missing.join('; ')}` : '',
      ].filter(Boolean)
      return { brief: lines.join('\n').slice(0, 1500), missing }
    }
    if (key === 'travel.day:reason') {
      const status = String(context.flightStatus || 'unknown')
      return { plan: `Flight ${status}${context.eta ? `, arriving ${context.eta}` : ''}. ${context.liveText || ''}`.trim().slice(0, 600), needsCab: context.wantsCab === true }
    }
    if (key === 'enterprise.cancellation_incident:classify') {
      const order = context.order as any; const recent = (context.recentCancellations as any[]) || []
      const reason = String(order?.cancel_reason || '').toLowerCase()
      const cause = reason === 'out_of_stock' ? 'out_of_stock' : reason === 'no_response' ? 'no_response' : reason === 'rider_unavailable' ? 'rider_unavailable' : reason === 'customer' ? 'customer' : 'unknown'
      return { cause, severity: recent.length >= 3 ? 'high' : recent.length >= 1 ? 'medium' : 'low' }
    }
    if (key === 'email.follow_up:draft') return { draft: '' } // no model draft without the owner's words; the approval step will show an empty draft and the owner edits via Change
    throw new Error(`reason_not_wired:${key}`)
  },

  preview({ def, node, context }) {
    if (def.id === 'travel.day') return [{ label: 'Action', value: node.approval?.title || 'Book the cab' }, { label: 'Flight', value: clip((context.leg as any)?.flightNo || (context.leg as any)?.title, 60) }, { label: 'Status', value: clip(context.flightStatus, 40) }, { label: 'ETA', value: clip(context.eta || 'unknown', 40) }]
    if (def.id === 'email.follow_up') return [{ label: 'Thread', value: clip((context.thread as any)?.subject || context.threadId, 120) }, { label: 'Draft', value: clip(context.draft || '(empty)', 300) }]
    return [{ label: 'Action', value: node.approval?.title || node.title }]
  },

  async execute({ def, node }) {
    // Writes are wired one at a time, each with its own verified executor. Until then: fail closed, nothing attempted.
    throw new ProcedureExecuteError(`execute_not_wired:${def.id}:${node.id}`, true)
  },

  async verify(): Promise<ExecutionEvidence | null> { return null },

  async waitEvent({ actor, def, node, context }) {
    if (def.id === 'travel.day' && node.event === 'flight.landed') {
      const leg = context.leg as any
      if (!leg?.flightNo) return null
      const { lookupLiveFlight } = await import('@/lib/agent/flight-track')
      const live = await lookupLiveFlight(String(leg.flightNo), new Date(), actor.timezone || 'Asia/Kolkata').catch(() => null)
      return live?.status?.state === 'landed' ? { landedAt: live.arrRevisedLocal || live.arrLocal || new Date().toISOString() } : null
    }
    return null
  },
}
