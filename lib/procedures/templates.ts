// Same Brain 3.0 Phase 3 templates. Three consumer procedures and one enterprise incident. Each is a plain graph that
// `validateProcedure` must accept; CONDITION branches come from the predicate tables below, never from model output.
import type { ConditionTable } from './engine'
import type { ProcedureDefinition } from './schema'

const T = (over: Partial<ProcedureDefinition> & Pick<ProcedureDefinition, 'id' | 'title' | 'domain' | 'nodes' | 'edges'>): ProcedureDefinition => ({ version: 1, inputs: [], consequential: false, ...over })

/** Travel day: live leg status, then the ground transfer only after a tap; verified against the provider read-back. */
export const TRAVEL_DAY = T({
  id: 'travel.day', title: 'Travel day', domain: 'travel', inputs: ['legId'], consequential: true,
  nodes: [
    { id: 'start', type: 'START', title: 'Start' },
    { id: 'read_leg', type: 'READ', title: 'Read the saved leg', capability: 'travel', requires: ['legId'], produces: ['leg'], retry: { max: 2, backoffMinutes: [1, 5] } },
    { id: 'read_live', type: 'PARALLEL_READ', title: 'Live flight status and traffic', capability: 'travel', requires: ['leg'], produces: ['flightStatus', 'eta'], retry: { max: 3, backoffMinutes: [2, 5, 10] }, timeoutMs: 8000 },
    { id: 'reason', type: 'REASON', title: 'Decide what the day needs', requires: ['leg', 'flightStatus'], produces: ['plan', 'needsCab'] },
    { id: 'cab_needed', type: 'CONDITION', title: 'Cab needed?' },
    { id: 'approve_cab', type: 'APPROVAL', title: 'Book the cab?', approval: { actionType: 'travel.book_cab', title: 'Book the airport cab' } },
    { id: 'book_cab', type: 'EXECUTE', title: 'Book the cab', capability: 'travel', requires: ['approval:approve_cab'], produces: ['cabBooking'] },
    { id: 'verify_cab', type: 'VERIFY', title: 'Confirm the booking', capability: 'travel', verify: { source: 'travel' }, retry: { max: 2, backoffMinutes: [1, 3] } },
    { id: 'wait_landing', type: 'WAIT_EVENT', title: 'Wait for landing', event: 'flight.landed' },
    { id: 'escalate', type: 'ESCALATE', title: 'Hand to the owner' },
    { id: 'done', type: 'COMPLETE', title: 'Done' },
    { id: 'failed', type: 'FAIL', title: 'Failed' },
  ],
  edges: [
    { from: 'start', to: 'read_leg' }, { from: 'read_leg', to: 'read_live', when: 'ok' }, { from: 'read_leg', to: 'failed', when: 'fail' },
    { from: 'read_live', to: 'reason', when: 'ok' }, { from: 'read_live', to: 'reason', when: 'fail' }, { from: 'read_live', to: 'reason', when: 'timeout' },
    { from: 'reason', to: 'cab_needed' },
    { from: 'cab_needed', to: 'approve_cab', when: 'yes' }, { from: 'cab_needed', to: 'wait_landing', when: 'no' },
    { from: 'approve_cab', to: 'book_cab', when: 'approved' }, { from: 'approve_cab', to: 'wait_landing', when: 'rejected' }, { from: 'approve_cab', to: 'wait_landing', when: 'expired' },
    { from: 'book_cab', to: 'verify_cab', when: 'ok' }, { from: 'book_cab', to: 'escalate', when: 'unknown' },
    { from: 'verify_cab', to: 'wait_landing', when: 'verified' }, { from: 'verify_cab', to: 'escalate', when: 'unverified' },
    { from: 'wait_landing', to: 'done', when: 'ok' }, { from: 'wait_landing', to: 'done', when: 'timeout' },
    { from: 'escalate', to: 'done' },
  ],
})

/** Email follow-up: read the thread, draft, approve, send, verify the sent message by read-back. */
export const EMAIL_FOLLOW_UP = T({
  id: 'email.follow_up', title: 'Email follow-up', domain: 'email', inputs: ['threadId'], consequential: true,
  nodes: [
    { id: 'start', type: 'START', title: 'Start' },
    { id: 'read_thread', type: 'READ', title: 'Read the thread', capability: 'email', requires: ['threadId'], produces: ['thread'], retry: { max: 2, backoffMinutes: [1, 5] } },
    { id: 'replied', type: 'CONDITION', title: 'Already replied?' },
    { id: 'draft', type: 'REASON', title: 'Draft the follow-up', requires: ['thread'], produces: ['draft'] },
    { id: 'approve', type: 'APPROVAL', title: 'Send this follow-up?', approval: { actionType: 'email.send', title: 'Send the follow-up' } },
    { id: 'send', type: 'EXECUTE', title: 'Send', capability: 'email', requires: ['approval:approve', 'draft'], produces: ['messageId'] },
    { id: 'verify', type: 'VERIFY', title: 'Confirm it was sent', capability: 'email', verify: { source: 'gmail' }, retry: { max: 2, backoffMinutes: [1, 3] } },
    { id: 'escalate', type: 'ESCALATE', title: 'Could not confirm the send' },
    { id: 'done', type: 'COMPLETE', title: 'Done' },
    { id: 'failed', type: 'FAIL', title: 'Failed' },
  ],
  edges: [
    { from: 'start', to: 'read_thread' }, { from: 'read_thread', to: 'replied', when: 'ok' }, { from: 'read_thread', to: 'failed', when: 'fail' },
    { from: 'replied', to: 'done', when: 'yes' }, { from: 'replied', to: 'draft', when: 'no' },
    { from: 'draft', to: 'approve' },
    { from: 'approve', to: 'send', when: 'approved' }, { from: 'approve', to: 'done', when: 'rejected' }, { from: 'approve', to: 'done', when: 'expired' },
    { from: 'send', to: 'verify', when: 'ok' }, { from: 'send', to: 'escalate', when: 'unknown' },
    { from: 'verify', to: 'done', when: 'verified' }, { from: 'verify', to: 'escalate', when: 'unverified' },
    { from: 'escalate', to: 'done' },
  ],
})

/** Meeting prep: read-only. Calendar + participants + documents (disclosed when unavailable) → brief. No EXECUTE. */
export const MEETING_PREP = T({
  id: 'meetings.prepare', title: 'Meeting prep', domain: 'meetings', inputs: ['eventId'],
  nodes: [
    { id: 'start', type: 'START', title: 'Start' },
    { id: 'read_event', type: 'READ', title: 'Read the event', capability: 'calendar', requires: ['eventId'], produces: ['event'], retry: { max: 2, backoffMinutes: [1, 5] } },
    { id: 'read_context', type: 'PARALLEL_READ', title: 'Participants, threads, open tasks', capability: 'memory', requires: ['event'], produces: ['participants', 'threads', 'openTasks', 'documentsAvailable'], retry: { max: 1, backoffMinutes: [2] } },
    { id: 'brief', type: 'REASON', title: 'Write the brief', requires: ['event', 'participants'], produces: ['brief', 'missing'] },
    { id: 'done', type: 'COMPLETE', title: 'Done' },
    { id: 'failed', type: 'FAIL', title: 'Failed' },
  ],
  edges: [
    { from: 'start', to: 'read_event' }, { from: 'read_event', to: 'read_context', when: 'ok' }, { from: 'read_event', to: 'failed', when: 'fail' },
    { from: 'read_context', to: 'brief', when: 'ok' }, { from: 'read_context', to: 'brief', when: 'fail' },
    { from: 'brief', to: 'done' },
  ],
})

/**
 * Enterprise: a Flipkart/ONDC cancellation incident at a Tipplr store. Read-only remediation: the procedure gathers the
 * evidence and creates a task for the store team; it never calls a merchant endpoint and never changes an order.
 */
export const CANCELLATION_INCIDENT = T({
  id: 'enterprise.cancellation_incident', title: 'Cancellation incident', domain: 'enterprise', inputs: ['workspaceId', 'orderRef'],
  nodes: [
    { id: 'start', type: 'START', title: 'Start' },
    { id: 'read_order', type: 'READ', title: 'Read the order record', capability: 'memory', requires: ['orderRef'], produces: ['order'], retry: { max: 2, backoffMinutes: [1, 5] } },
    { id: 'read_history', type: 'PARALLEL_READ', title: 'Recent cancellations at this store', capability: 'memory', requires: ['order'], produces: ['recentCancellations', 'stockSignal'], retry: { max: 1, backoffMinutes: [2] } },
    { id: 'classify', type: 'REASON', title: 'Classify the cause', requires: ['order', 'recentCancellations'], produces: ['cause', 'severity'] },
    { id: 'severe', type: 'CONDITION', title: 'Repeat pattern?' },
    { id: 'create_task', type: 'READ', title: 'Create the store task (internal record)', capability: 'tasks', requires: ['cause'], produces: ['taskId'] },
    { id: 'escalate', type: 'ESCALATE', title: 'Page the store owner' },
    { id: 'done', type: 'COMPLETE', title: 'Done' },
    { id: 'failed', type: 'FAIL', title: 'Failed' },
  ],
  edges: [
    { from: 'start', to: 'read_order' }, { from: 'read_order', to: 'read_history', when: 'ok' }, { from: 'read_order', to: 'failed', when: 'fail' },
    { from: 'read_history', to: 'classify', when: 'ok' }, { from: 'read_history', to: 'classify', when: 'fail' },
    { from: 'classify', to: 'severe' },
    { from: 'severe', to: 'escalate', when: 'yes' }, { from: 'severe', to: 'create_task', when: 'no' },
    { from: 'escalate', to: 'create_task' },
    { from: 'create_task', to: 'done', when: 'ok' }, { from: 'create_task', to: 'failed', when: 'fail' },
  ],
})

export const CONDITIONS: Record<string, ConditionTable> = {
  'travel.day': { cab_needed: ctx => (ctx.needsCab === true ? 'yes' : 'no') },
  'email.follow_up': { replied: ctx => { const t = ctx.thread as { lastFromMe?: boolean } | undefined; return t?.lastFromMe ? 'yes' : 'no' } },
  'meetings.prepare': {},
  'enterprise.cancellation_incident': { severe: ctx => { const n = Number((ctx.recentCancellations as unknown[] | undefined)?.length || 0); return n >= 3 || ctx.severity === 'high' ? 'yes' : 'no' } },
}

export const TEMPLATES: ProcedureDefinition[] = [TRAVEL_DAY, EMAIL_FOLLOW_UP, MEETING_PREP, CANCELLATION_INCIDENT]
