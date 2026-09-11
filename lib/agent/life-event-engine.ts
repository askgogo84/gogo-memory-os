import crypto from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type LifeEventType =
  | 'travel'
  | 'event'
  | 'appointment'
  | 'reservation'
  | 'purchase'
  | 'delivery'
  | 'bill'
  | 'subscription'
  | 'application'
  | 'document'
  | 'other'

export type LifeEventActionType =
  | 'remember'
  | 'prepare'
  | 'monitor'
  | 'notify'
  | 'calendar_draft'
  | 'browser_prepare'
  | 'email_watch'
  | 'approval'
  | 'complete'

export type LifeEventAction = {
  actionKey: string
  actionType: LifeEventActionType
  capability: 'memory' | 'files' | 'email' | 'calendar' | 'browser' | 'contacts' | 'travel' | 'payments'
  title: string
  dueAt: string | null
  requiresApproval: boolean
  irreversible: boolean
  payload: Record<string, unknown>
}

export type LifeEventInput = {
  telegramId: number | string
  eventType: LifeEventType
  subtype: string
  source: string
  title: string
  provider?: string | null
  startAt?: string | Date | null
  endAt?: string | Date | null
  timezone?: string | null
  location?: string | null
  confirmationRef?: string | null
  participants?: string[] | null
  preferences?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  sourceRefs?: Array<Record<string, unknown>> | null
}

export type LifeEventPlan = {
  dedupeKey: string
  lifecycleState: 'captured' | 'planned'
  nextActionAt: string | null
  actions: LifeEventAction[]
}

function iso(value?: string | Date | null) {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

function minusHours(value: string | null, hours: number) {
  if (!value) return null
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return null
  return new Date(d.getTime() - hours * 3600_000).toISOString()
}

function plusHours(value: string | null, hours: number) {
  if (!value) return null
  const d = new Date(value)
  if (!Number.isFinite(d.getTime())) return null
  return new Date(d.getTime() + hours * 3600_000).toISOString()
}

function normalized(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function lifeEventDedupeKey(input: LifeEventInput) {
  const start = iso(input.startAt)
  const stable = [
    normalized(input.eventType),
    normalized(input.subtype),
    normalized(input.provider),
    normalized(input.confirmationRef),
    normalized(input.location),
    start || '',
    normalized(input.title),
  ].join('|')
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 40)
}

function action(params: LifeEventAction): LifeEventAction {
  return params
}

function earliestFuture(actions: LifeEventAction[], now: number) {
  const times = actions
    .map((a) => a.dueAt ? new Date(a.dueAt).getTime() : NaN)
    .filter((n) => Number.isFinite(n) && n > now)
    .sort((a, b) => a - b)
  return times.length ? new Date(times[0]).toISOString() : null
}

/**
 * Pure lifecycle planner. It deliberately prepares/monitors but never performs
 * consequential actions by itself. Browser submit, booking, purchase, calendar
 * mutation, email send and payment remain behind the existing approval/Sentinel layer.
 */
export function buildLifeEventPlan(input: LifeEventInput, now = Date.now()): LifeEventPlan {
  const startAt = iso(input.startAt)
  const metadata = input.metadata || {}
  const actions: LifeEventAction[] = []

  actions.push(action({
    actionKey: 'remember',
    actionType: 'remember',
    capability: 'memory',
    title: 'Keep this life event and its source context together',
    dueAt: null,
    requiresApproval: false,
    irreversible: false,
    payload: { source: input.source, subtype: input.subtype },
  }))

  if (input.eventType === 'travel') {
    const departurePrep = minusHours(startAt, 3)
    actions.push(action({
      actionKey: 'departure-readiness',
      actionType: 'notify',
      capability: 'travel',
      title: 'Prepare for departure',
      dueAt: departurePrep,
      requiresApproval: false,
      irreversible: false,
      payload: { startAt, location: input.location || null },
    }))

    if (input.subtype === 'flight') {
      const checkinOpensAt = iso((metadata as any).checkinOpensAt as string | null)
      actions.push(action({
        actionKey: 'prepare-web-checkin',
        actionType: 'browser_prepare',
        capability: 'browser',
        title: 'Prepare airline web check-in',
        dueAt: checkinOpensAt,
        requiresApproval: false,
        irreversible: false,
        payload: {
          airlineCode: (metadata as any).airlineCode || null,
          flightNo: (metadata as any).flightNo || null,
          checkInUrl: (metadata as any).checkInUrl || null,
          confirmationRef: input.confirmationRef || null,
          boundary: 'prepare_only_until_user_approval',
        },
      }))
      actions.push(action({
        actionKey: 'watch-boarding-pass-email',
        actionType: 'email_watch',
        capability: 'email',
        title: 'Watch connected email for boarding pass or check-in confirmation',
        dueAt: checkinOpensAt,
        requiresApproval: false,
        irreversible: false,
        payload: {
          provider: input.provider || null,
          confirmationRef: input.confirmationRef || null,
          readOnly: true,
        },
      }))
      actions.push(action({
        actionKey: 'checkin-submit-approval',
        actionType: 'approval',
        capability: 'travel',
        title: 'Ask before airline check-in is submitted',
        dueAt: checkinOpensAt,
        requiresApproval: true,
        irreversible: true,
        payload: {
          approvalType: 'booking',
          exactAction: 'submit_web_checkin',
          neverAutoSubmit: true,
        },
      }))
      actions.push(action({
        actionKey: 'travel-disruption-watch',
        actionType: 'monitor',
        capability: 'travel',
        title: 'Watch for meaningful flight changes',
        dueAt: minusHours(startAt, 24),
        requiresApproval: false,
        irreversible: false,
        payload: { notifyOnlyOnMaterialChange: true },
      }))
    }
  } else if (input.eventType === 'event') {
    actions.push(action({
      actionKey: 'event-calendar-draft',
      actionType: 'calendar_draft',
      capability: 'calendar',
      title: 'Prepare calendar entry for this event',
      dueAt: null,
      requiresApproval: true,
      irreversible: false,
      payload: { mutation: 'create_event', approvalRequired: true },
    }))
    actions.push(action({
      actionKey: 'event-readiness',
      actionType: 'prepare',
      capability: 'travel',
      title: 'Prepare venue, travel and ticket readiness',
      dueAt: minusHours(startAt, 3),
      requiresApproval: false,
      irreversible: false,
      payload: { location: input.location || null, ticketReady: true },
    }))
    actions.push(action({
      actionKey: 'event-change-watch',
      actionType: 'monitor',
      capability: 'browser',
      title: 'Watch for meaningful event timing or venue changes',
      dueAt: minusHours(startAt, 24),
      requiresApproval: false,
      irreversible: false,
      payload: { notifyOnlyOnMaterialChange: true },
    }))
  } else if (input.eventType === 'appointment' || input.eventType === 'reservation') {
    actions.push(action({
      actionKey: 'appointment-calendar-draft',
      actionType: 'calendar_draft',
      capability: 'calendar',
      title: 'Prepare calendar entry',
      dueAt: null,
      requiresApproval: true,
      irreversible: false,
      payload: { mutation: 'create_event', approvalRequired: true },
    }))
    actions.push(action({
      actionKey: 'appointment-readiness',
      actionType: 'prepare',
      capability: 'memory',
      title: 'Prepare documents, timing and location context',
      dueAt: minusHours(startAt, 2),
      requiresApproval: false,
      irreversible: false,
      payload: { location: input.location || null },
    }))
  } else if (input.eventType === 'purchase' || input.eventType === 'delivery') {
    actions.push(action({
      actionKey: 'delivery-monitor',
      actionType: 'monitor',
      capability: 'browser',
      title: 'Track meaningful order or delivery changes',
      dueAt: plusHours(iso(new Date(now)), 1),
      requiresApproval: false,
      irreversible: false,
      payload: { notifyOnlyOnMaterialChange: true },
    }))
  } else if (input.eventType === 'bill' || input.eventType === 'subscription') {
    actions.push(action({
      actionKey: 'bill-review',
      actionType: 'prepare',
      capability: 'payments',
      title: 'Prepare bill or renewal review',
      dueAt: minusHours(startAt, 24),
      requiresApproval: false,
      irreversible: false,
      payload: { paymentRequiresApproval: true },
    }))
  } else if (input.eventType === 'application') {
    actions.push(action({
      actionKey: 'application-status-watch',
      actionType: 'monitor',
      capability: 'browser',
      title: 'Watch for meaningful application status changes',
      dueAt: plusHours(iso(new Date(now)), 24),
      requiresApproval: false,
      irreversible: false,
      payload: { notifyOnlyOnMaterialChange: true },
    }))
  }

  const nextActionAt = earliestFuture(actions, now)
  return {
    dedupeKey: lifeEventDedupeKey(input),
    lifecycleState: actions.length > 1 ? 'planned' : 'captured',
    nextActionAt,
    actions,
  }
}

export async function registerLifeEvent(input: LifeEventInput) {
  const plan = buildLifeEventPlan(input)
  const telegramId = String(input.telegramId)
  const startAt = iso(input.startAt)
  const endAt = iso(input.endAt)

  const { data: event, error } = await supabaseAdmin
    .from('life_events')
    .upsert({
      telegram_id: telegramId,
      event_type: input.eventType,
      subtype: input.subtype,
      source: input.source,
      title: input.title.slice(0, 240),
      provider: input.provider || null,
      start_at: startAt,
      end_at: endAt,
      timezone: input.timezone || null,
      location: input.location || null,
      confirmation_ref: input.confirmationRef || null,
      lifecycle_state: plan.lifecycleState,
      participants: input.participants || [],
      preferences_json: input.preferences || {},
      metadata_json: input.metadata || {},
      source_refs: input.sourceRefs || [],
      dedupe_key: plan.dedupeKey,
      next_action_at: plan.nextActionAt,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'telegram_id,dedupe_key' })
    .select('id')
    .single()

  if (error || !event?.id) throw new Error(`life_event_upsert_failed:${error?.message || 'unknown'}`)

  for (const step of plan.actions) {
    const { error: actionError } = await supabaseAdmin.from('life_event_actions').upsert({
      life_event_id: String(event.id),
      telegram_id: telegramId,
      action_key: step.actionKey,
      action_type: step.actionType,
      capability: step.capability,
      title: step.title,
      due_at: step.dueAt,
      requires_approval: step.requiresApproval,
      irreversible: step.irreversible,
      payload_json: step.payload,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'life_event_id,action_key' })
    if (actionError) throw new Error(`life_event_action_upsert_failed:${actionError.message}`)
  }

  return { id: String(event.id), ...plan }
}
