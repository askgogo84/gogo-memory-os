/**
 * The context pack understand-first reads before deciding (founder, 19 Oct: "any context it should read").
 *
 * Rules:
 *  - Owner-bound: every read is filtered by the actor's own telegram_id (and calendar reads use only the
 *    owner's connected accounts).
 *  - Each source is optional and has its own short timeout, so one slow source never blocks the others.
 *    The status of every source (included / empty / timeout / error / skipped) is returned and recorded.
 *  - Size-capped per source here; the whole request is bounded again in buildUnderstandingRequest.
 *  - Reuses context-brain's buildContextPack for watches, travel and long-term memory (semantic + lexical)
 *    instead of new queries for those.
 *  - Sensitive documents appear only as "masked <type>"; no raw document content is read.
 */
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isSecretShapedMemory } from '@/lib/bot/memory-redaction'
import { detectPendingQuestion, emptyUnderstandingContext, type ContextItem, type Turn, type UnderstandingContext } from './understanding'

export type UnderstandingSource =
  | 'recent_turns' | 'open_tasks' | 'pending_approvals' | 'saved_documents' | 'saved_tickets' | 'upcoming_reminders'
  | 'context_pack' | 'calendar' | 'preferences' | 'profile'

export type ContextActor = { legacyTelegramId: number; name?: string | null; timezone?: string | null; userId?: string; whatsappId?: string }
export type SourceArgs = { actor: ContextActor; text: string; now: Date; timezone: string }
export type SourceLoaders = Partial<Record<UnderstandingSource, (args: SourceArgs) => Promise<any>>>

export const SOURCE_TIMEOUT_MS: Record<UnderstandingSource, number> = {
  recent_turns: 500, open_tasks: 500, pending_approvals: 500, saved_documents: 500, saved_tickets: 500, upcoming_reminders: 500,
  preferences: 500, profile: 400, context_pack: 900, calendar: 900,
}

const ACTIVE_RUN = ['queued', 'running', 'waiting_approval', 'paused', 'outcome_unknown']
const SENSITIVE_DOC = /passport|aadhaar|aadhar|\bpan\b|pan_card|driving|licen[cs]e|voter|\bid\b|id_card|bank|cheque|card|insurance|medical|health|visa/i

function clean(v: unknown, max = 160) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function rows(result: any) { if (result?.error) throw new Error(String(result.error.message || 'read_failed')); return (result?.data || []) as any[] }
function localTime(iso: unknown, tz: string) {
  const t = Date.parse(String(iso || ''))
  if (!Number.isFinite(t)) return null
  try { return new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(t)) + ` (${tz})` }
  catch { return new Date(t).toISOString() }
}

export const defaultSourceLoaders: Required<SourceLoaders> = {
  // Same ordering as getConversationHistory: newest first with role ascending, so a user/assistant
  // pair saved in the same instant reverses to user -> assistant.
  async recent_turns({ actor }) {
    const data = rows(await supabaseAdmin.from('conversations').select('role,content,created_at')
      .eq('telegram_id', actor.legacyTelegramId).order('created_at', { ascending: false }).order('role', { ascending: true }).limit(8))
    return data.filter(r => r.role === 'user' || r.role === 'assistant').reverse()
      .map((r): Turn => ({ role: r.role, content: clean(r.content, 600), createdAt: r.created_at || null }))
  },
  async open_tasks({ actor }) {
    const data = rows(await supabaseAdmin.from('agent_runs').select('id,title,status,type,updated_at')
      .eq('telegram_id', String(actor.legacyTelegramId)).in('status', ACTIVE_RUN).order('updated_at', { ascending: false }).limit(6))
    return data.map((r): ContextItem => ({ id: `run:${r.id}`, title: clean(r.title || r.type, 120), detail: clean(r.status, 30), at: r.updated_at || null }))
  },
  async pending_approvals({ actor }) {
    const data = rows(await supabaseAdmin.from('agent_approvals').select('id,title,risk_level,requested_at')
      .eq('telegram_id', String(actor.legacyTelegramId)).eq('status', 'pending').order('requested_at', { ascending: false }).limit(5))
    return data.map((r): ContextItem => ({ id: `approval:${r.id}`, title: clean(r.title, 120), detail: r.risk_level ? `risk ${clean(r.risk_level, 20)}` : null, at: r.requested_at || null }))
  },
  async saved_documents({ actor }) {
    const data = rows(await supabaseAdmin.from('documents').select('id,doc_type,title,created_at')
      .eq('telegram_id', actor.legacyTelegramId).order('created_at', { ascending: false }).limit(12))
    return data.map(r => {
      const type = clean(r.doc_type, 30) || 'document'
      const sensitive = SENSITIVE_DOC.test(type) || isSecretShapedMemory(String(r.title || ''))
      return { id: `doc:${r.id}`, kind: 'document' as const, type, title: sensitive ? `masked ${type}` : clean(r.title, 100) || type, at: r.created_at || null }
    })
  },
  async saved_tickets({ actor, now, timezone }) {
    const since = new Date(now.getTime() - 2 * 86400_000).toISOString()
    const data = rows(await supabaseAdmin.from('travel_tickets').select('id,type,from_city,to_city,depart_at,airline,flight_no,event_name,venue')
      .eq('telegram_id', actor.legacyTelegramId).or(`depart_at.is.null,depart_at.gte.${since}`).order('depart_at', { ascending: true }).limit(10))
    return data.map(r => {
      const type = clean(r.type, 20) || 'ticket'
      const event = clean(r.event_name, 80)
      const venue = clean(r.venue, 60)
      const title = type === 'event' ? [event || 'event', venue].filter(Boolean).join(' at ') : [clean(r.from_city, 40), clean(r.to_city, 40)].filter(Boolean).join(' to ') + (r.flight_no ? ` ${clean(r.flight_no, 12)}` : '')
      return { id: `ticket:${r.id}`, kind: 'ticket' as const, type: `${type} ticket`, title: title || `${type} ticket`, at: localTime(r.depart_at, timezone) }
    })
  },
  async upcoming_reminders({ actor, now, timezone }) {
    const data = rows(await supabaseAdmin.from('reminders').select('id,message,remind_at')
      .eq('telegram_id', actor.legacyTelegramId).eq('sent', false).gte('remind_at', new Date(now.getTime() - 6 * 3600_000).toISOString()).order('remind_at', { ascending: true }).limit(10))
    return data.map((r): ContextItem => ({ id: `reminder:${r.id}`, title: clean(r.message, 120), at: localTime(r.remind_at, timezone) }))
  },
  async preferences({ actor }) {
    const data = rows(await supabaseAdmin.from('user_preferences').select('rule_text').eq('telegram_id', actor.legacyTelegramId).order('created_at', { ascending: true }).limit(8))
    return data.map(r => clean(r.rule_text, 160)).filter(Boolean)
  },
  async profile({ actor }) {
    return { name: actor.name || null, timezone: actor.timezone || null, city: null, pincode: null }
  },
  // Watches, travel legs and long-term memory come from the existing context brain (semantic + lexical).
  async context_pack({ actor, text }) {
    const { buildContextPack } = await import('./context-brain')
    const pack = await buildContextPack({ actor: actor as any, text, options: { includeSemantic: true, maxFacts: 16 } })
    const facts = pack.facts || []
    return {
      watches: facts.filter(f => f.source === 'watcher').slice(0, 8).map(f => ({ id: `watch:${f.id}`, title: clean(f.summary, 120) })),
      travelLegs: facts.filter(f => f.source === 'travel_ticket' || f.source === 'travel_presence').slice(0, 6).map(f => ({ id: `travel:${f.id}`, title: clean(f.summary, 140), at: f.startAt || null })),
      memoryFacts: facts.filter(f => ['semantic_memory', 'memory_insight', 'memory_profile', 'open_loop', 'goal'].includes(f.source)).slice(0, 6).map(f => ({ id: `memory:${f.id}`, title: clean(f.summary, 160) })),
    }
  },
  async calendar({ actor, now, timezone }) {
    const { data, error } = await supabaseAdmin.from('users').select('google_calendar_connected,google_refresh_token').eq('telegram_id', actor.legacyTelegramId).maybeSingle()
    if (error) throw new Error(error.message)
    const { getCalendarAccountAccess, fetchMergedCalendarEventsPage } = await import('@/lib/services/google-calendar-accounts')
    const primary = data?.google_calendar_connected === true && data?.google_refresh_token ? String(data.google_refresh_token) : null
    const accounts = await getCalendarAccountAccess(actor.legacyTelegramId, primary)
    if (!accounts.length) return []
    const from = new Date(now.getTime() - 2 * 3600_000).toISOString()
    const until = new Date(now.getTime() + 40 * 3600_000).toISOString()
    const page = await fetchMergedCalendarEventsPage(accounts, from, until, 'UNDERSTANDING_CALENDAR_READ_FAILED', 10)
    return (page.events || []).slice(0, 10).map((e: any, i: number) => ({ id: `event:${i + 1}`, title: clean(e.summary || 'busy', 80), at: localTime(e.start?.dateTime || e.start?.date, timezone) }))
  },
}

async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<{ status: 'ok' | 'timeout' | 'error'; value?: T; error?: string }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn().then(value => ({ status: 'ok' as const, value })),
      new Promise<{ status: 'timeout' }>(resolve => { timer = setTimeout(() => resolve({ status: 'timeout' }), ms) }),
    ])
  } catch (err: any) {
    return { status: 'error', error: clean(err?.message || err, 120) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Builds the owner-bound context pack. Never throws; each source degrades on its own. */
export async function buildUnderstandingContext(params: {
  actor: ContextActor
  text: string
  now?: Date
  timezone?: string | null
  loaders?: SourceLoaders
  timeouts?: Partial<Record<UnderstandingSource, number>>
  skip?: UnderstandingSource[]
}): Promise<UnderstandingContext> {
  const now = params.now || new Date()
  const timezone = clean(params.timezone || params.actor.timezone || 'Asia/Kolkata', 60)
  const args: SourceArgs = { actor: params.actor, text: params.text, now, timezone }
  const ctx = emptyUnderstandingContext()
  const names = Object.keys(defaultSourceLoaders) as UnderstandingSource[]
  const results = await Promise.all(names.map(async name => {
    if (params.skip?.includes(name)) return [name, { status: 'skipped' as const }] as const
    const loader = params.loaders?.[name] || defaultSourceLoaders[name]
    const ms = params.timeouts?.[name] ?? SOURCE_TIMEOUT_MS[name]
    return [name, await withTimeout(() => loader(args), ms)] as const
  }))
  for (const [name, r] of results) {
    if (r.status !== 'ok') { ctx.sourceStatus[name] = r.status; continue }
    const v: any = r.value
    let count = 0
    switch (name) {
      case 'recent_turns': ctx.recentTurns = Array.isArray(v) ? v.slice(-8) : []; count = ctx.recentTurns.length; break
      case 'open_tasks': ctx.openTasks = Array.isArray(v) ? v.slice(0, 6) : []; count = ctx.openTasks.length; break
      case 'pending_approvals': ctx.pendingApprovals = Array.isArray(v) ? v.slice(0, 5) : []; count = ctx.pendingApprovals.length; break
      case 'saved_documents': case 'saved_tickets': {
        const items = Array.isArray(v) ? v : []
        ctx.savedAssetsIndex = [...ctx.savedAssetsIndex, ...items].slice(0, 20); count = items.length; break
      }
      case 'upcoming_reminders': ctx.upcomingReminders = Array.isArray(v) ? v.slice(0, 10) : []; count = ctx.upcomingReminders.length; break
      case 'preferences': ctx.preferences = Array.isArray(v) ? v.slice(0, 8) : []; count = ctx.preferences.length; break
      case 'profile': ctx.profile = { ...ctx.profile, ...(v || {}) }; count = v ? 1 : 0; break
      case 'calendar': ctx.calendarEvents = Array.isArray(v) ? v.slice(0, 10) : []; count = ctx.calendarEvents.length; break
      case 'context_pack': {
        ctx.watches = Array.isArray(v?.watches) ? v.watches : []
        ctx.travelLegs = Array.isArray(v?.travelLegs) ? v.travelLegs : []
        ctx.memoryFacts = Array.isArray(v?.memoryFacts) ? v.memoryFacts : []
        count = ctx.watches.length + ctx.travelLegs.length + ctx.memoryFacts.length
        break
      }
    }
    ctx.sourceStatus[name] = count ? 'included' : 'empty'
  }
  ctx.pendingQuestion = detectPendingQuestion(ctx.recentTurns, now)
  if (!ctx.profile.timezone) ctx.profile.timezone = timezone
  return ctx
}
