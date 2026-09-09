import { supabaseAdmin } from '@/lib/supabase-admin'
import { dispatchThroughSameBrain } from './same-brain'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

export type CompoundRunResult = {
  runId: string
  status: 'completed' | 'failed'
  capability: 'reminders'
  risk: 'low'
  text: string
  handledBy: 'compound-plan'
  steps: Array<{ ordinal: number; toolName: string; title: string; status: string }>
}

type ExpiryPlan = {
  target: string
  amount: number
  unit: 'day' | 'week' | 'month' | 'year'
}

type CandidateDoc = {
  id: string | number
  doc_type: string | null
  title: string | null
  summary: string | null
  extracted: any
  expires_on: string | null
  created_at: string | null
}

const WORD_NUMBER: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

function numberFrom(value: string): number | null {
  const n = Number(value)
  if (Number.isInteger(n) && n > 0 && n <= 120) return n
  return WORD_NUMBER[value.toLowerCase()] || null
}

export function parseExpiryReminderPlan(text: string): ExpiryPlan | null {
  const clean = String(text || '').trim().replace(/\s+/g, ' ')
  if (!/\bremind\s+me\b/i.test(clean)) return null
  if (!/\b(expir(?:e|es|y|ation)|expires?)\b/i.test(clean)) return null

  const offset = clean.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(day|week|month|year)s?\s+before\b/i)
  if (!offset) return null
  const amount = numberFrom(offset[1])
  if (!amount) return null

  const targetMatch = clean.match(/\bfind\s+(?:my\s+)?(.+?)\s+(?:and|then)\s+remind\s+me\b/i)
  if (!targetMatch?.[1]) return null
  const target = targetMatch[1]
    .replace(/\b(document|details|info|information)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  if (!target) return null

  return { target, amount, unit: offset[2].toLowerCase() as ExpiryPlan['unit'] }
}

function expiryOf(doc: CandidateDoc): string | null {
  const ex = doc.extracted && typeof doc.extracted === 'object' ? doc.extracted : {}
  const raw = doc.expires_on || ex?.fields?.expiry_date || ex?.expiry_date || ex?.expiryHuman || null
  if (!raw) return null
  const d = new Date(String(raw))
  if (!Number.isFinite(d.getTime())) return null
  return d.toISOString()
}

function searchable(doc: CandidateDoc): string {
  const ex = doc.extracted && typeof doc.extracted === 'object' ? doc.extracted : {}
  return `${doc.doc_type || ''} ${doc.title || ''} ${doc.summary || ''} ${ex.assetType || ''} ${ex?.fields?.document_kind || ''}`.toLowerCase()
}

function rankDoc(doc: CandidateDoc, target: string): number {
  const hay = searchable(doc)
  const tokens = target.toLowerCase().split(/[^a-z0-9]+/).filter(x => x.length > 2)
  let score = 0
  for (const token of tokens) if (hay.includes(token)) score += 3
  if (target.toLowerCase().includes('passport') && hay.includes('passport')) score += 20
  if (expiryOf(doc)) score += 4
  return score
}

async function findDocument(telegramId: number, target: string): Promise<{ doc: CandidateDoc; expiryIso: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('documents')
    .select('id, doc_type, title, summary, extracted, expires_on, created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`compound_memory_search_failed:${error.message}`)

  const ranked = ((data || []) as CandidateDoc[])
    .map(doc => ({ doc, expiryIso: expiryOf(doc), score: rankDoc(doc, target) }))
    .filter(x => x.expiryIso && x.score > 0)
    .sort((a, b) => b.score - a.score)
  return ranked[0] ? { doc: ranked[0].doc, expiryIso: ranked[0].expiryIso! } : null
}

function subtractOffset(expiryIso: string, amount: number, unit: ExpiryPlan['unit']): Date {
  const d = new Date(expiryIso)
  if (!Number.isFinite(d.getTime())) throw new Error('compound_invalid_expiry')
  const out = new Date(d.getTime())
  if (unit === 'day') out.setUTCDate(out.getUTCDate() - amount)
  else if (unit === 'week') out.setUTCDate(out.getUTCDate() - amount * 7)
  else if (unit === 'month') out.setUTCMonth(out.getUTCMonth() - amount)
  else out.setUTCFullYear(out.getUTCFullYear() - amount)
  return out
}

function dateForReminder(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

async function addStep(params: { telegramId: number; runId: string; ordinal: number; toolName: string; title: string }) {
  const { data, error } = await supabaseAdmin.from('agent_steps').insert({
    telegram_id: String(params.telegramId), run_id: params.runId, ordinal: params.ordinal,
    tool_name: params.toolName, title: params.title, status: 'queued',
  }).select('id').single()
  if (error || !data?.id) throw new Error(`agent_step_create_failed:${error?.message || 'unknown'}`)
  return String(data.id)
}

async function stepState(id: string, status: 'running' | 'completed' | 'failed', output: Record<string, unknown> = {}, error?: string) {
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { status }
  if (status === 'running') patch.started_at = now
  else patch.completed_at = now
  if (Object.keys(output).length) patch.output_json = output
  if (error) patch.error = String(error).slice(0, 500)
  const { error: e } = await supabaseAdmin.from('agent_steps').update(patch).eq('id', id)
  if (e) throw new Error(`agent_step_update_failed:${e.message}`)
}

async function runState(runId: string, telegramId: number, patch: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('agent_runs').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId).eq('telegram_id', String(telegramId))
  if (error) throw new Error(`agent_run_update_failed:${error.message}`)
}

async function logActivity(telegramId: number, runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(telegramId), run_id: runId, event_type: eventType,
    message: String(message).slice(0, 900), metadata_json: metadata,
  })
  if (error) console.error('COMPOUND_AGENT_ACTIVITY_FAILED:', error.message)
}

export async function tryRunExpiryReminderPlan(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  messageId?: string | number | null
}): Promise<CompoundRunResult | null> {
  const plan = parseExpiryReminderPlan(params.text)
  if (!plan) return null

  const now = new Date().toISOString()
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: String(params.actor.legacyTelegramId), type: 'compound', capability: 'reminders',
    status: 'running', title: `Find ${plan.target} and create expiry reminder`,
    summary: 'Gogo is working through a multi-step plan.', progress: 5,
    why: 'This request needs Memory and Reminders to work together.', source: params.surface,
    metadata_json: { input_text: String(params.text).slice(0, 2000), plan_type: 'memory_expiry_to_reminder', target: plan.target, offset: { amount: plan.amount, unit: plan.unit } },
    started_at: now, updated_at: now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`compound_run_create_failed:${runError?.message || 'unknown'}`)
  const runId = String(run.id)

  const definitions = [
    ['memory.search', `Find ${plan.target}`],
    ['memory.read_expiry', 'Read the saved expiry date'],
    ['date.calculate', `Calculate ${plan.amount} ${plan.unit}${plan.amount === 1 ? '' : 's'} before expiry`],
    ['reminder.create', 'Create the reminder'],
  ] as const
  const ids: string[] = []
  for (let i = 0; i < definitions.length; i++) ids.push(await addStep({ telegramId: params.actor.legacyTelegramId, runId, ordinal: i + 1, toolName: definitions[i][0], title: definitions[i][1] }))
  await logActivity(params.actor.legacyTelegramId, runId, 'plan_created', 'Gogo created a 4-step plan.', { tools: definitions.map(x => x[0]), surface: params.surface })

  try {
    await stepState(ids[0], 'running')
    const found = await findDocument(params.actor.legacyTelegramId, plan.target)
    if (!found) {
      await stepState(ids[0], 'failed', {}, 'matching_document_with_expiry_not_found')
      await runState(runId, params.actor.legacyTelegramId, { status: 'failed', summary: `I couldn't find a saved ${plan.target} with an expiry date.`, progress: 100, completed_at: new Date().toISOString(), error: 'matching_document_with_expiry_not_found' })
      await logActivity(params.actor.legacyTelegramId, runId, 'run_failed', `No saved ${plan.target} with an expiry date was found.`)
      return { runId, status: 'failed', capability: 'reminders', risk: 'low', text: `I couldn't find a saved ${plan.target} with an expiry date.`, handledBy: 'compound-plan', steps: definitions.map((d, i) => ({ ordinal: i + 1, toolName: d[0], title: d[1], status: i === 0 ? 'failed' : 'queued' })) }
    }
    await stepState(ids[0], 'completed', { documentId: String(found.doc.id), matched: true })
    await runState(runId, params.actor.legacyTelegramId, { progress: 25 })

    await stepState(ids[1], 'running')
    await stepState(ids[1], 'completed', { expiryAvailable: true })
    await runState(runId, params.actor.legacyTelegramId, { progress: 50 })

    await stepState(ids[2], 'running')
    const reminderDate = subtractOffset(found.expiryIso, plan.amount, plan.unit)
    const dateText = dateForReminder(reminderDate)
    await stepState(ids[2], 'completed', { reminderDate: dateText })
    await runState(runId, params.actor.legacyTelegramId, { progress: 75 })

    await stepState(ids[3], 'running')
    const reminderCommand = `remind me on ${dateText} at 9:00 AM to check my ${plan.target} before it expires`
    const result = await dispatchThroughSameBrain({ actor: params.actor, text: reminderCommand, messageId: params.messageId })
    await stepState(ids[3], 'completed', { created: true })

    const completedAt = new Date().toISOString()
    const text = `Done. I found your saved ${plan.target}, worked out ${plan.amount} ${plan.unit}${plan.amount === 1 ? '' : 's'} before its expiry, and set the reminder.\n\n${result.text}`
    await runState(runId, params.actor.legacyTelegramId, { status: 'completed', summary: text.slice(0, 1800), progress: 100, completed_at: completedAt, metadata_json: { input_text: String(params.text).slice(0, 2000), plan_type: 'memory_expiry_to_reminder', target: plan.target, offset: { amount: plan.amount, unit: plan.unit }, handled_by: result.handledBy } })
    await logActivity(params.actor.legacyTelegramId, runId, 'run_completed', `Gogo completed the Memory → Reminder plan.`, { handled_by: result.handledBy })
    return { runId, status: 'completed', capability: 'reminders', risk: 'low', text, handledBy: 'compound-plan', steps: definitions.map((d, i) => ({ ordinal: i + 1, toolName: d[0], title: d[1], status: 'completed' })) }
  } catch (err: any) {
    const message = String(err?.message || 'compound_agent_failed')
    await runState(runId, params.actor.legacyTelegramId, { status: 'failed', summary: 'Gogo could not complete the multi-step plan.', progress: 100, completed_at: new Date().toISOString(), error: message.slice(0, 500) }).catch(() => {})
    await logActivity(params.actor.legacyTelegramId, runId, 'run_failed', 'Gogo could not complete the multi-step plan.', { error: message.slice(0, 300) })
    throw err
  }
}
