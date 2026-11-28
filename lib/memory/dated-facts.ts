import { supabaseAdmin } from '@/lib/supabase-admin'
import { exactDashboardOwnerId } from '@/lib/dashboard/exact-owner-id'
import { isSecretShapedMemory } from '@/lib/bot/memory-redaction'
import { UUID_RE } from '@/lib/workspaces/rules'

export type DatedFact = {
  id: string
  topic: string
  head: string
  following: boolean
  revision: { id: string; answer: string; source: string; effectiveOn: string; recordedAt: string } | null
}

export class FactError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function shortText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value))
    throw new FactError(400, 'Enter a valid single-line value.')
  return value.trim()
}

export function factDay(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value) || value.startsWith('0000'))
    throw new FactError(400, 'Use a date in YYYY-MM-DD format.')
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new FactError(400, 'Choose a valid calendar date.')
  return value
}

function scope(actor: unknown, workspace: unknown) {
  if (!exactDashboardOwnerId(actor)) throw new FactError(403, 'Your identity could not be verified.')
  if (workspace !== null && (typeof workspace !== 'string' || !UUID_RE.test(workspace)))
    throw new FactError(400, 'Choose a valid workspace.')
  return { p_actor: actor as string, p_workspace: workspace }
}

function check(error: { message: string } | null) {
  if (!error) return
  if (error.message === 'fact_forbidden') throw new FactError(403, 'Your role does not allow this operation.')
  if (error.message === 'fact_conflict') throw new FactError(409, 'This fact changed. Look it up again before saving.')
  throw new FactError(503, 'Dated facts are unavailable right now.')
}

export async function readDatedFacts(actor: string, workspace: string | null, topic: string | null, day: string): Promise<DatedFact[]> {
  const { data, error } = await supabaseAdmin.rpc('read_dated_facts', {
    ...scope(actor, workspace), p_topic: topic === null ? null : shortText(topic, 100).toLowerCase(),
    p_day: factDay(day),
  })
  check(error)
  if (!Array.isArray(data)) throw new FactError(503, 'Could not verify the saved facts.')
  return data as DatedFact[]
}

export async function changeDatedFact(actor: string, workspace: string | null, input: Record<string, unknown>) {
  const topic = shortText(input.topic, 100).toLowerCase()
  const action = input.action
  if (!['save','forget','follow','unfollow'].includes(String(action)) || typeof action !== 'string')
    throw new FactError(400, 'Choose a valid action.')
  if (input.head !== null && (typeof input.head !== 'string' || !UUID_RE.test(input.head)))
    throw new FactError(400, 'Look up this fact first.')
  const saving = action === 'save'
  const answer = saving ? shortText(input.answer, 1000) : null
  const source = saving ? shortText(input.source, 180) : null
  if (saving && (typeof input.requestId !== 'string' || !UUID_RE.test(input.requestId)))
    throw new FactError(400, 'Missing revision identifier.')
  // ISO dates are common in policy references. Preserve every surrounding credential label.
  const withoutDates = (text: string) => text.replace(/\b[12]\d{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/g, 'date')
  if (saving && [topic, answer!, source!].some(text => isSecretShapedMemory(withoutDates(text))))
    throw new FactError(400, 'Remove sensitive identifiers before saving.')
  const { error } = await supabaseAdmin.rpc('write_dated_fact', {
    ...scope(actor, workspace), p_topic: topic, p_action: action, p_expected: input.head,
    p_request: saving ? input.requestId : null, p_day: saving ? factDay(input.day) : null,
    p_answer: answer, p_source: source,
  })
  check(error)
}

export const datedFactQuery = /^fact\s*:\s*(.{1,150})$/i

export async function answerDatedQuestion(actor: string, workspace: string | null, question: string, now = new Date()) {
  const query = question.trim().match(datedFactQuery)
  if (!query) return null
  const match = query[1].trim().match(/^(.+?)(?:\s+on\s+(\d{4}-\d{2}-\d{2}))?\??$/i)
  if (!match) return null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
  const day = factDay(match[2] || today)
  const [fact] = await readDatedFacts(actor, workspace, match[1], day)
  const revision = fact?.revision
  return {
    answer: revision ? revision.answer : 'No dated fact was recorded for this topic and date.',
    source: { label: revision ? `Recorded source: ${revision.source} · Effective ${revision.effectiveOn} · Revision ${revision.id}` : `Dated facts for ${day}`,
      checkedAt: now.toISOString(), firstRecordAt: revision?.recordedAt ?? null, lastRecordAt: revision?.recordedAt ?? null },
  }
}


export async function datedReminderText(actor: string, ref: string, day: string, origin: string): Promise<string | null> {
  if (!exactDashboardOwnerId(actor) || !UUID_RE.test(ref)) return null
  const { data, error } = await supabaseAdmin.rpc('dated_fact_reminder', { p_actor: actor, p_ref: ref, p_day: factDay(day) })
  if (error?.message === 'fact_forbidden') return null
  check(error)
  if (data === null) return null
  if (typeof data.workspace === 'string' && UUID_RE.test(data.workspace))
    return 'Review the current fact in your workspace brief: ' + origin.replace(/\/$/, '') + '/dashboard/business?ws=' + data.workspace
  if (typeof data.answer !== 'string' || typeof data.source !== 'string' || typeof data.effectiveOn !== 'string')
    throw new FactError(503, 'Could not verify the reminder source.')
  return data.answer + '\nRecorded source: ' + data.source + ' · Effective ' + data.effectiveOn
}
