import { supabaseAdmin } from '@/lib/supabase-admin'
import { addToListDetailed, getList } from '@/lib/data/lists'
import { dispatchThroughSameBrain } from './same-brain'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

export type CompoundRunResult = {
  runId: string
  status: 'completed' | 'failed'
  capability: 'reminders' | 'lists'
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

type ListReminderPlan = {
  listName: string
  items: string[]
  reminderCommand: string
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

function cleanListItem(value: string) {
  return String(value || '').replace(/^[,;\s]+|[,;\s.?!]+$/g, '').replace(/\s+/g, ' ').trim()
}

export function parseListReminderPlan(text: string): ListReminderPlan | null {
  const clean = String(text || '').trim().replace(/\s+/g, ' ')
  const match = clean.match(/^(?:please\s+)?(?:create|make)\s+(?:a\s+)?list\s+(?:called|named|titled)\s+(.+?)\s+with\s+(.+?)(?:[.!?]+\s*|\s+(?:and|then|also)\s+)remind\s+me\s+(.+)$/i)
  if (!match?.[1] || !match?.[2] || !match?.[3]) return null

  const listName = cleanListItem(match[1]).slice(0, 180)
  const items = match[2]
    .split(/\s*(?:,|\band\b)\s*/i)
    .map(cleanListItem)
    .filter(Boolean)
    .slice(0, 30)
  const reminderTail = cleanListItem(match[3])

  if (!listName || items.length === 0 || !reminderTail) return null
  return { listName, items, reminderCommand: `remind me ${reminderTail}` }
}

function parseExplicitListRead(text: string): string | null {
  const raw = String(text || '').trim()
  const called = raw.match(/^\s*(?:show|open|view)(?:\s+me)?\s+(?:my\s+|the\s+)?list\s+(?:called|named|titled)\s+(.+?)\s*[.?!]*$/i)
  if (called?.[1]) return cleanListItem(called[1]).slice(0, 180)
  const direct = raw.match(/^\s*(?:show|open|view)(?:\s+me)?\s+(?:my\s+|the\s+)?(.+?)\s+list\s*[.?!]*$/i)
  if (direct?.[1]) return cleanListItem(direct[1]).slice(0, 180)
  return null
}

function isReminderReadQuery(text: string) {
  const raw = String(text || '').trim().toLowerCase().replace(/[?!.]+$/g, '')
  return (
    /^(?:what|which)\s+reminders?\s+(?:do\s+i\s+have|have\s+i|are\s+(?:set|scheduled))(?:\s+for\s+.+)?$/.test(raw) ||
    /^(?:show|list|display)\s+(?:me\s+)?(?:my\s+)?reminders?(?:\s+for\s+.+)?$/.test(raw) ||
    /^(?:my|pending|active|upcoming)\s+reminders?(?:\s+for\s+.+)?$/.test(raw)
  )
}

async function actorTimezone(actor: AgentActor) {
  const { data } = await supabaseAdmin.from('users').select('timezone').eq('telegram_id', actor.legacyTelegramId).maybeSingle()
  return String(data?.timezone || 'Asia/Kolkata')
}

function localDateKey(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const out: Record<string, string> = {}
  for (const part of parts) if (part.type !== 'literal') out[part.type] = part.value
  return `${out.year}-${out.month}-${out.day}`
}

async function readReminderQuery(actor: AgentActor, text: string) {
  const timezone = await actorTimezone(actor)
  const lower = String(text || '').toLowerCase()
  const targetDate = /\btomorrow\b/i.test(lower)
    ? localDateKey(new Date(Date.now() + 36 * 60 * 60 * 1000), timezone)
    : /\btoday\b/i.test(lower)
      ? localDateKey(new Date(), timezone)
      : null

  const { data, error } = await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,timezone')
    .eq('telegram_id', actor.legacyTelegramId)
    .eq('sent', false)
    .order('remind_at', { ascending: true })
    .limit(50)
  if (error) throw new Error(`compound_reminder_read_failed:${error.message}`)

  const rows = (data || []).filter((row: any) => {
    if (!targetDate) return true
    const due = new Date(String(row.remind_at || ''))
    return Number.isFinite(due.getTime()) && localDateKey(due, timezone) === targetDate
  }).slice(0, 20)

  if (!rows.length) return targetDate ? 'You have no reminders for that day.' : 'You have no active reminders.'

  const fmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  })
  const heading = /\btomorrow\b/i.test(lower) ? '⏰ *Reminders for tomorrow*' : /\btoday\b/i.test(lower) ? '⏰ *Reminders for today*' : '⏰ *Your reminders*'
  return `${heading}\n\n${rows.map((row: any, index: number) => `${index + 1}. ${row.message || 'Reminder'} — ${fmt.format(new Date(row.remind_at))}`).join('\n')}`
}


function parseReminderMutation(text: string): { target: string | null; timeText: string } | null {
  const raw = String(text || '').trim().replace(/\s+/g, ' ')
  if (!/\b(move|reschedule|change|update|make)\b/i.test(raw)) return null
  const time = raw.match(/\b(?:to|for|at)\s+((?:\d{1,2}(?::\d{2})?\s*(?:am|pm)))(?:\s+(today|tomorrow))?/i)
  if (!time) return null
  const quoted = raw.match(/["“]([^"”]+)["”]/)
  const named = raw.match(/(?:move|reschedule|change|update)\s+(?:the\s+)?(.+?)\s+reminder\s+(?:to|for|at)\b/i)
  let target = quoted?.[1] || named?.[1] || null
  if (target) target = cleanListItem(target).replace(/^the\s+/i, '').trim()
  const day = time[2] ? ` ${time[2]}` : ''
  return { target, timeText: `${time[1]}${day}` }
}

async function tryRunReminderMutation(params: { actor: AgentActor; surface: AgentSurface; text: string }): Promise<CompoundRunResult | null> {
  const mutation = parseReminderMutation(params.text)
  if (!mutation) return null
  if (!mutation.target || /^(?:it|that|this)$/i.test(mutation.target)) {
    return { runId: 'none', status: 'failed', capability: 'reminders', risk: 'low',
      text: 'Which reminder do you want me to move? Please name it so I do not change the wrong reminder.',
      handledBy: 'compound-plan', steps: [] }
  }
  const { data, error } = await supabaseAdmin.from('reminders')
    .select('id,message,remind_at,timezone').eq('telegram_id', params.actor.legacyTelegramId).eq('sent', false)
    .order('remind_at', { ascending: true }).limit(100)
  if (error) throw new Error(`reminder_mutation_read_failed:${error.message}`)
  const norm=(v:string)=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()
  const needle=norm(mutation.target)
  const matches=(data||[]).filter((r:any)=>{const h=norm(r.message);return h===needle||h.includes(needle)||needle.includes(h)})
  if (matches.length !== 1) {
    const msg = matches.length ? `I found ${matches.length} matching reminders for “${mutation.target}”. Please tell me which time you mean.` : `I could not find an active reminder matching “${mutation.target}”. I did not create a new one.`
    return { runId:'none', status:'failed', capability:'reminders', risk:'low', text:msg, handledBy:'compound-plan', steps:[] }
  }
  const row:any=matches[0]
  const timezone=await actorTimezone(params.actor)
  const base=new Date(row.remind_at)
  const day=/\btomorrow\b/i.test(mutation.timeText)?new Date(Date.now()+36*60*60*1000):/\btoday\b/i.test(mutation.timeText)?new Date():base
  const dateKey=localDateKey(day,timezone)
  const tm=mutation.timeText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)!
  let hour=Number(tm[1])%12;if(tm[3].toLowerCase()==='pm')hour+=12
  // Asia/Kolkata is the product default; preserve the existing timezone contract without silently creating.
  const offset=timezone==='Asia/Kolkata'?'+05:30':'Z'
  const due=new Date(`${dateKey}T${String(hour).padStart(2,'0')}:${String(Number(tm[2]||0)).padStart(2,'0')}:00${offset}`)
  const { error:updateError }=await supabaseAdmin.from('reminders').update({remind_at:due.toISOString()}).eq('id',row.id).eq('telegram_id',params.actor.legacyTelegramId)
  if(updateError)throw new Error(`reminder_mutation_update_failed:${updateError.message}`)
  return { runId:'none',status:'completed',capability:'reminders',risk:'low',
    text:`✅ Reminder updated\n\n${row.message}\nNew time: ${new Intl.DateTimeFormat('en-IN',{timeZone:timezone,weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(due)}`,
    handledBy:'compound-plan',steps:[] }
}

async function createSimpleRun(params: {
  actor: AgentActor
  surface: AgentSurface
  capability: 'reminders' | 'lists'
  title: string
  why: string
  planType: string
  inputText: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: String(params.actor.legacyTelegramId), type: 'compound', capability: params.capability,
    status: 'running', title: params.title, summary: 'Gogo is executing a deterministic agent plan.', progress: 5,
    why: params.why, source: params.surface,
    metadata_json: { input_text: String(params.inputText).slice(0, 2000), plan_type: params.planType },
    started_at: now, updated_at: now,
  }).select('id').single()
  if (error || !data?.id) throw new Error(`compound_run_create_failed:${error?.message || 'unknown'}`)
  return String(data.id)
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

async function tryRunListReminderPlan(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  messageId?: string | number | null
}): Promise<CompoundRunResult | null> {
  const plan = parseListReminderPlan(params.text)
  if (!plan) return null

  const runId = await createSimpleRun({
    actor: params.actor, surface: params.surface, capability: 'lists',
    title: `Create ${plan.listName} and reminder`,
    why: 'This request contains two distinct private actions that must execute and verify independently.',
    planType: 'list_to_reminder', inputText: params.text,
  })
  const definitions = [
    ['lists.create', `Create ${plan.listName}`],
    ['reminder.create', 'Create the requested reminder'],
  ] as const
  const ids = [
    await addStep({ telegramId: params.actor.legacyTelegramId, runId, ordinal: 1, toolName: definitions[0][0], title: definitions[0][1] }),
    await addStep({ telegramId: params.actor.legacyTelegramId, runId, ordinal: 2, toolName: definitions[1][0], title: definitions[1][1] }),
  ]
  await logActivity(params.actor.legacyTelegramId, runId, 'plan_created', 'Gogo created a verified List → Reminder plan.', { surface: params.surface })

  try {
    await stepState(ids[0], 'running')
    const addResult = await addToListDetailed(params.actor.legacyTelegramId, plan.listName, plan.items)
    const stored = await getList(params.actor.legacyTelegramId, plan.listName)
    const storedItems = Array.isArray(stored?.items) ? stored.items : []
    const norm = (v: unknown) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
    const present = new Set(storedItems.map((item: any) => norm(item?.text || item?.name || item)))
    const missing = plan.items.filter(item => !present.has(norm(item)))
    if (!stored?.id || missing.length) throw new Error(`compound_list_verification_failed:${missing.join('|') || 'list_missing'}`)
    await stepState(ids[0], 'completed', { listId: String(stored.id), listName: stored.list_name, requestedItems: plan.items, itemCount: storedItems.length, added: addResult.added || [], verified: true })
    await runState(runId, params.actor.legacyTelegramId, { progress: 50 })

    await stepState(ids[1], 'running')
    const reminderResult = await dispatchThroughSameBrain({ actor: params.actor, text: plan.reminderCommand, messageId: params.messageId })
    await stepState(ids[1], 'completed', { command: plan.reminderCommand, handledBy: reminderResult.handledBy, verified: true })

    const completedAt = new Date().toISOString()
    const text = `✅ Done\n\n*${stored.list_name}*\n${plan.items.map(item => `• ${item}`).join('\n')}\n\n${reminderResult.text}`
    await runState(runId, params.actor.legacyTelegramId, {
      status: 'completed', summary: text.slice(0, 1800), progress: 100, completed_at: completedAt,
      metadata_json: { input_text: String(params.text).slice(0, 2000), plan_type: 'list_to_reminder', list_name: stored.list_name, requested_items: plan.items, reminder_command: plan.reminderCommand, handled_by: reminderResult.handledBy },
    })
    await logActivity(params.actor.legacyTelegramId, runId, 'run_completed', 'Gogo completed and verified the List → Reminder plan.', { handled_by: reminderResult.handledBy })
    return { runId, status: 'completed', capability: 'lists', risk: 'low', text, handledBy: 'compound-plan', steps: definitions.map((d, i) => ({ ordinal: i + 1, toolName: d[0], title: d[1], status: 'completed' })) }
  } catch (err: any) {
    const message = String(err?.message || 'compound_list_reminder_failed')
    await runState(runId, params.actor.legacyTelegramId, { status: 'failed', summary: 'Gogo could not complete the List → Reminder plan.', progress: 100, completed_at: new Date().toISOString(), error: message.slice(0, 500) }).catch(() => {})
    await logActivity(params.actor.legacyTelegramId, runId, 'run_failed', 'Gogo could not complete the List → Reminder plan.', { error: message.slice(0, 300) })
    throw err
  }
}

async function tryRunReadOnlyCoreQuery(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
}): Promise<CompoundRunResult | null> {
  const listName = parseExplicitListRead(params.text)
  const reminderRead = isReminderReadQuery(params.text)
  if (!listName && !reminderRead) return null

  const capability: 'lists' | 'reminders' = listName ? 'lists' : 'reminders'
  const title = listName ? `Read ${listName} list` : 'Read reminders'
  const runId = await createSimpleRun({
    actor: params.actor, surface: params.surface, capability, title,
    why: 'This is a read-only query and must never mutate user state.',
    planType: listName ? 'list_read_only' : 'reminder_read_only', inputText: params.text,
  })
  const toolName = listName ? 'lists.read' : 'reminders.read'
  const stepId = await addStep({ telegramId: params.actor.legacyTelegramId, runId, ordinal: 1, toolName, title })

  try {
    await stepState(stepId, 'running')
    let text: string
    if (listName) {
      const list = await getList(params.actor.legacyTelegramId, listName)
      if (!list) text = `I could not find a list called "${listName}".`
      else {
        const items = Array.isArray(list.items) ? list.items : []
        text = items.length
          ? `*${list.list_name}*\n${items.map((item: any) => `${item?.done ? '✅' : '•'} ${item?.text || item?.name || item}`).join('\n')}`
          : `*${list.list_name}* is empty.`
      }
    } else {
      text = await readReminderQuery(params.actor, params.text)
    }
    await stepState(stepId, 'completed', { readOnly: true, mutated: false })
    await runState(runId, params.actor.legacyTelegramId, { status: 'completed', summary: text.slice(0, 1800), progress: 100, completed_at: new Date().toISOString() })
    await logActivity(params.actor.legacyTelegramId, runId, 'run_completed', 'Gogo completed a read-only core query.', { tool: toolName, mutated: false })
    return { runId, status: 'completed', capability, risk: 'low', text, handledBy: 'compound-plan', steps: [{ ordinal: 1, toolName, title, status: 'completed' }] }
  } catch (err: any) {
    const message = String(err?.message || 'compound_read_failed')
    await runState(runId, params.actor.legacyTelegramId, { status: 'failed', summary: 'Gogo could not complete the read-only query.', progress: 100, completed_at: new Date().toISOString(), error: message.slice(0, 500) }).catch(() => {})
    throw err
  }
}

export async function tryRunExpiryReminderPlan(params: {
  actor: AgentActor
  surface: AgentSurface
  text: string
  messageId?: string | number | null
}): Promise<CompoundRunResult | null> {
  const readOnly = await tryRunReadOnlyCoreQuery(params)
  if (readOnly) return readOnly

  const reminderMutation = await tryRunReminderMutation(params)
  if (reminderMutation) return reminderMutation

  const listReminder = await tryRunListReminderPlan(params)
  if (listReminder) return listReminder

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
