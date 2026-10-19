import { randomUUID } from 'node:crypto'
import { saveFollowupState, listFollowupStates, deleteFollowupRows } from './handlers/followup-state'

/**
 * Pending-question registry (PR 1 of the understand-first router, docs/architecture/05).
 *
 * When Gogo asks the user a clarifying question ("What time should I book Toit for?") it records
 * the question here: which capability asked, which details it is waiting for, and the original
 * request. The next short reply ("This Saturday 8pm") is then read as the answer to THAT question
 * by lib/bot/pending-question-resolver.ts instead of being claimed by a keyword rule (19 Oct live:
 * it became a reminder titled "This").
 *
 * Storage reuses the followup_state rows in `memories` (kind 'pending_question'); no migration.
 * Every read and write is bound to the owner's telegram_id, and a question whose timestamps cannot
 * be read is treated as expired (fail closed): an answer is never bound to a question we cannot
 * prove is fresh.
 *
 * Approval questions are NOT registered here; approvals keep their own binding.
 */

export const PENDING_QUESTION_STATE = 'pending_question'

export type PendingDetail = 'date' | 'time' | 'party' | 'restaurant'

export type PendingQuestion = {
  id: string
  telegramId: number
  kind: string
  capability: string
  /** What the question is waiting for. expects[0] is the detail that was literally asked. */
  expects: PendingDetail[]
  context: Record<string, unknown>
  createdAt: string
  expiresAt: string
  /** May a later model-based understanding pass (PR 2) bind a free-form answer? */
  llmResolvable: boolean
  /** Only typed deterministic details (date / time / party) may bind; never free text. */
  exactOnly: boolean
}

export type OpenPendingQuestionInput = {
  telegramId: number
  kind: string
  capability: string
  expects: PendingDetail[]
  context: Record<string, unknown>
  ttlMin?: number
  llmResolvable?: boolean
  exactOnly?: boolean
}

const MAX_TTL_MIN = 24 * 60

function validTelegramId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Fresh = both timestamps parse, created is not in the future, and now is before expiry. */
export function isPendingQuestionFresh(q: Pick<PendingQuestion, 'createdAt' | 'expiresAt'> | null | undefined, now = Date.now()): boolean {
  if (!q) return false
  const created = Date.parse(String(q.createdAt || ''))
  const expires = Date.parse(String(q.expiresAt || ''))
  if (!Number.isFinite(created) || !Number.isFinite(expires)) return false
  if (created > now + 60_000 || expires <= created) return false
  return now < expires
}

function asQuestion(state: any, telegramId: number): PendingQuestion | null {
  const p = state?.payload
  if (!p || typeof p !== 'object') return null
  // Owner-bound twice: the row is selected by telegram_id AND the payload must name the same owner.
  if (p.telegramId !== telegramId) return null
  if (typeof p.id !== 'string' || !p.id || typeof p.kind !== 'string' || !Array.isArray(p.expects)) return null
  return {
    id: p.id,
    telegramId,
    kind: p.kind,
    capability: String(p.capability || ''),
    expects: p.expects.filter((x: unknown) => x === 'date' || x === 'time' || x === 'party' || x === 'restaurant'),
    context: p.context && typeof p.context === 'object' ? p.context : {},
    createdAt: String(p.createdAt || ''),
    expiresAt: String(p.expiresAt || ''),
    llmResolvable: p.llmResolvable === true,
    exactOnly: p.exactOnly !== false,
  }
}

async function openRows(telegramId: number) {
  const rows = await listFollowupStates(telegramId, PENDING_QUESTION_STATE)
  return rows.map((row) => ({ rowId: row.rowId, question: asQuestion(row.state, telegramId) }))
}

/**
 * Record a question Gogo just asked. A newer question of the same kind supersedes the older one
 * (the user moved on to a new request of that kind), so a re-ask never leaves two competing
 * questions of one kind. Questions of different kinds coexist and the resolver asks which one an
 * answer is for. Best-effort: a storage failure never breaks the reply that asked the question.
 */
export async function openPendingQuestion(input: OpenPendingQuestionInput): Promise<string> {
  const id = randomUUID()
  if (!validTelegramId(input.telegramId)) return id
  try {
    const ttl = Math.min(Math.max(Number(input.ttlMin ?? 30) || 30, 1), MAX_TTL_MIN)
    const now = new Date()
    const prior = (await openRows(input.telegramId)).filter((r) => r.question?.kind === input.kind && r.rowId !== null)
    if (prior.length) await deleteFollowupRows(input.telegramId, prior.map((r) => r.rowId as string | number))
    await saveFollowupState(input.telegramId, PENDING_QUESTION_STATE, {
      id,
      telegramId: input.telegramId,
      kind: input.kind,
      capability: input.capability,
      expects: [...new Set(input.expects)],
      context: input.context || {},
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 60_000).toISOString(),
      llmResolvable: input.llmResolvable === true,
      exactOnly: input.exactOnly !== false,
    })
  } catch (err: any) {
    console.error('PENDING_QUESTION_OPEN_FAILED:', err?.message || err)
  }
  return id
}

/** Open, fresh questions for this user only, newest first. */
export async function listOpenPendingQuestions(telegramId: number): Promise<PendingQuestion[]> {
  if (!validTelegramId(telegramId)) return []
  const now = Date.now()
  const out: PendingQuestion[] = []
  const seen = new Set<string>()
  for (const row of await openRows(telegramId)) {
    const q = row.question
    if (!q || seen.has(q.id) || !isPendingQuestionFresh(q, now)) continue
    seen.add(q.id)
    out.push(q)
  }
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** Close one question (owner-bound). Closing an unknown or foreign id is a no-op. */
export async function closePendingQuestion(telegramId: number, id: string): Promise<void> {
  if (!validTelegramId(telegramId) || !id) return
  const rows = (await openRows(telegramId)).filter((r) => r.question?.id === id && r.rowId !== null)
  if (rows.length) await deleteFollowupRows(telegramId, rows.map((r) => r.rowId as string | number))
}
