// Free/cheap inference policy (issue #274, owner-approved 24 Oct). Used by lib/inference/cheap.ts for public work only.
//
// This file is deliberately pure: no network, no env reads, no provider SDKs. It defines
//   1. a minimal ProviderAdapter interface (no "brain", no planning: text in, text out),
//   2. routeTask(): a policy router that only ever lets four low-risk task classes reach a
//      free/cheap tier and refuses everything personal, approval- or execution-bound,
//   3. compressPrompt(): a whitespace/duplicate compressor that never alters approval or
//      execution-record lines.
// Anything the router refuses stays on the existing primary pipeline (lib/agent/planner-provider.ts
// and friends); this module never decides how those are handled.

/** The only classes a free/cheap tier may ever see. */
export const ALLOWED_TASK_CLASSES = [
  'public_web_research',          // summarising/extracting from public web pages
  'morning_intel_public_summary', // Morning Intelligence: public news/markets/weather summaries only
  'make_draft_nonpersonal',       // Make tab drafting with no personal or owner-private context
  'safe_classification',          // labelling public / non-personal text (topic, language, spam-ness)
] as const
export type AllowedTaskClass = typeof ALLOWED_TASK_CLASSES[number]

/** Classes that must never be routed to a free/cheap gateway, whatever the caller claims. */
export const FORBIDDEN_TASK_CLASSES = [
  'gmail', 'calendar', 'vault', 'secondbrain', 'payments', 'approval', 'execution',
  'personal_memory', 'personal_chat', 'contacts', 'travel_ticket', 'booking', 'commerce', 'unknown',
] as const
export type ForbiddenTaskClass = typeof FORBIDDEN_TASK_CLASSES[number]
export type TaskClass = AllowedTaskClass | ForbiddenTaskClass

/** Classes whose input originates from the owner (drafts, classification) may carry confidential
 * business text even when non-personal, so they never go to a tier that trains on inputs. */
const NO_TRAINING_CLASSES: ReadonlySet<AllowedTaskClass> = new Set(['make_draft_nonpersonal', 'safe_classification'])

export type ProviderTier = 'free_tier' | 'cheap_paid'

/** How the provider is accessed. Only official API keys under the provider's own developer terms
 * are acceptable; the other kinds exist so registration can reject them explicitly. */
export type AccessKind =
  | 'official_api_key'
  | 'consumer_subscription_oauth' // e.g. Claude Pro/Max, Antigravity, Codex, Cursor OAuth reuse
  | 'keyless_web_scrape'          // reverse-engineered web endpoints
  | 'pooled_multi_account'        // several accounts on one provider to multiply quota

export interface ProviderDataPolicy {
  trainsOnInputs: boolean
  humanReview: boolean
  /** Max days prompts may be retained by the provider (null = unknown → treated as unsafe). */
  retentionDays: number | null
}

export interface CompletionRequest {
  taskClass: AllowedTaskClass
  prompt: string
  maxOutputTokens?: number
}

export interface CompletionResult {
  text: string
  inputTokens: number
  outputTokens: number
}

/** Minimal provider adapter. One adapter == one provider account. */
export interface ProviderAdapter {
  /** Unique adapter id, e.g. 'groq:gpt-oss-20b'. */
  id: string
  /** Provider (company) id, e.g. 'groq'. At most one adapter per provider may be registered. */
  provider: string
  tier: ProviderTier
  access: AccessKind
  dataPolicy: ProviderDataPolicy
  complete(req: CompletionRequest): Promise<CompletionResult>
}

export class ProviderRateLimitedError extends Error {
  constructor(readonly adapterId: string) { super(`rate_limited:${adapterId}`) }
}

// ---------------------------------------------------------------------------------------------
// Registry guard: rejects ToS-violating access patterns at configuration time.
// ---------------------------------------------------------------------------------------------

export type RegistryProblem = { adapterId: string; reason: string }

export function validateRegistry(adapters: readonly ProviderAdapter[]): RegistryProblem[] {
  const problems: RegistryProblem[] = []
  const seenProvider = new Map<string, string>()
  for (const a of adapters) {
    if (a.access !== 'official_api_key') problems.push({ adapterId: a.id, reason: `forbidden_access_kind:${a.access}` })
    const prior = seenProvider.get(a.provider)
    // A second adapter for the same provider is how account/key rotation creeps in. Refuse it:
    // a 429 means "wait or fall to the NEXT provider", never "try another key on the same one".
    if (prior) problems.push({ adapterId: a.id, reason: `multi_account_rotation_forbidden:${a.provider} (already ${prior})` })
    else seenProvider.set(a.provider, a.id)
    if (a.dataPolicy.retentionDays === null) problems.push({ adapterId: a.id, reason: 'unknown_retention' })
  }
  return problems
}

// ---------------------------------------------------------------------------------------------
// Personal-data and protected-record detection (defence in depth: the caller's flag is not trusted).
// ---------------------------------------------------------------------------------------------

const PERSONAL_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['phone_in', /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/],
  ['phone_intl', /\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/],
  ['pan', /\b[A-Z]{5}\d{4}[A-Z]\b/],
  ['aadhaar_like', /\b\d{4}\s?\d{4}\s?\d{4}\b/],
  ['card_like', /\b(?:\d[ -]?){13,19}\b/],
  ['upi', /\b[\w.-]{2,}@(?:ok\w+|upi|ybl|paytm|ibl|axl|apl|icici|hdfcbank|sbi)\b/i],
  ['otp', /\b(?:otp|one[- ]time (?:password|code)|verification code)\b/i],
  ['pnr', /\bPNR\b/i],
  ['owner_context', /\[(?:GMAIL|CALENDAR|VAULT|SECONDBRAIN|MEMORY|CONTACT|PAYMENT)[^\]]*\]/i],
]

export function detectPersonalData(text: string): string[] {
  const hits: string[] = []
  for (const [name, re] of PERSONAL_PATTERNS) if (re.test(text)) hits.push(name)
  return hits
}

/** A protected line is an approval or execution record. It is tagged at the start of the line:
 *   [APPROVAL id=apv_123 ...] ...
 *   [EXECUTION_RECORD run=run_9 ...] ...
 * Multi-line records are fenced with BEGIN/END markers and every line inside is protected. */
const PROTECTED_LINE = /^\s*\[(?:APPROVAL|EXECUTION_RECORD)\b[^\]]*\]/
// Marker whitespace is tolerated so a hand-spaced fence is still recognised (and therefore never
// normalised into a different, newly-recognised fence by compression).
const PROTECTED_BEGIN = /^\s*-----BEGIN\s+(?:APPROVAL|EXECUTION_RECORD)-----\s*$/
const PROTECTED_END = /^\s*-----END\s+(?:APPROVAL|EXECUTION_RECORD)-----\s*$/

export function containsProtectedRecord(text: string): boolean {
  return text.split('\n').some((l) => PROTECTED_LINE.test(l) || PROTECTED_BEGIN.test(l))
}

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

export interface RouteInput {
  taskClass: string
  /** Caller's declaration. true always refuses; false is re-checked by the scanner. */
  containsPersonalData: boolean
  /** The prompt text, scanned for personal data and protected records. */
  text: string
  /** Candidate adapters in the owner-approved fallback order. */
  providers: readonly ProviderAdapter[]
  /** Adapter ids currently cooling down after a 429 (skipped, not retried with another key). */
  coolingDown?: ReadonlySet<string>
}

export type RouteDecision =
  | { allowed: true; taskClass: AllowedTaskClass; chain: ProviderAdapter[] }
  | { allowed: false; reason: string; detail?: string[] }

export function isAllowedTaskClass(c: string): c is AllowedTaskClass {
  return (ALLOWED_TASK_CLASSES as readonly string[]).includes(c)
}

export function routeTask(input: RouteInput): RouteDecision {
  if (!isAllowedTaskClass(input.taskClass)) return { allowed: false, reason: `class_not_permitted:${input.taskClass}` }
  if (input.containsPersonalData) return { allowed: false, reason: 'declared_personal_data' }
  if (containsProtectedRecord(input.text)) return { allowed: false, reason: 'contains_approval_or_execution_record' }
  const hits = detectPersonalData(input.text)
  if (hits.length) return { allowed: false, reason: 'detected_personal_data', detail: hits }
  const problems = validateRegistry(input.providers)
  if (problems.length) return { allowed: false, reason: 'invalid_provider_registry', detail: problems.map((p) => `${p.adapterId}:${p.reason}`) }

  const taskClass = input.taskClass
  const chain = input.providers.filter((p) => {
    if (input.coolingDown?.has(p.id)) return false
    if (NO_TRAINING_CLASSES.has(taskClass) && (p.dataPolicy.trainsOnInputs || p.dataPolicy.humanReview)) return false
    return true
  })
  if (!chain.length) return { allowed: false, reason: 'no_eligible_provider' }
  return { allowed: true, taskClass, chain }
}

/** Walks the chain in order. A rate-limited provider is skipped to the next one; there is no
 * retry on the same provider with a different key. Other errors also fall through. */
export async function completeWithFallback(
  decision: Extract<RouteDecision, { allowed: true }>,
  prompt: string,
): Promise<{ result: CompletionResult; adapterId: string; attempted: string[] }> {
  const attempted: string[] = []
  const errors: string[] = []
  for (const adapter of decision.chain) {
    attempted.push(adapter.id)
    try {
      const result = await adapter.complete({ taskClass: decision.taskClass, prompt })
      return { result, adapterId: adapter.id, attempted }
    } catch (err) {
      errors.push(`${adapter.id}:${String((err as Error)?.message || err).slice(0, 200)}`)
      continue
    }
  }
  const err = new Error('all_providers_failed') as Error & { attempted?: string[]; errors?: string[] }
  err.attempted = attempted
  err.errors = errors
  throw err
}

// ---------------------------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------------------------

export interface CompressOptions {
  /** Unprotected lines longer than this are truncated with an ellipsis. */
  maxLineChars?: number
  /** Drop exact duplicate unprotected lines (after whitespace normalisation). */
  dedupe?: boolean
}

/** Returns every protected line, in order, exactly as written. */
export function extractProtectedLines(text: string): string[] {
  const out: string[] = []
  let inBlock = false
  for (const line of text.split('\n')) {
    if (inBlock) { out.push(line); if (PROTECTED_END.test(line)) inBlock = false; continue }
    if (PROTECTED_BEGIN.test(line)) { out.push(line); inBlock = true; continue }
    if (PROTECTED_LINE.test(line)) out.push(line)
  }
  return out
}

/**
 * Cheap, deterministic compression. Protected lines (approval / execution records, single or
 * fenced) are copied through byte-for-byte: no trimming, no whitespace change, no dedupe, no
 * truncation, no reordering. Only unprotected lines are normalised.
 */
export function compressPrompt(text: string, opts: CompressOptions = {}): string {
  const maxLineChars = opts.maxLineChars ?? 600
  const dedupe = opts.dedupe ?? true
  const seen = new Set<string>()
  const out: string[] = []
  let inBlock = false
  let lastBlank = false
  for (const line of text.split('\n')) {
    if (inBlock) { out.push(line); lastBlank = false; if (PROTECTED_END.test(line)) inBlock = false; continue }
    if (PROTECTED_BEGIN.test(line)) { out.push(line); inBlock = true; lastBlank = false; continue }
    if (PROTECTED_LINE.test(line)) { out.push(line); lastBlank = false; continue }

    let norm = line.replace(/[ \t]+/g, ' ').trim()
    if (!norm) { if (!lastBlank && out.length) out.push(''); lastBlank = true; continue }
    if (norm.length > maxLineChars) norm = norm.slice(0, maxLineChars - 1) + '…'
    if (dedupe) { if (seen.has(norm)) continue; seen.add(norm) }
    out.push(norm)
    lastBlank = false
  }
  // Only drop a trailing blank that compression itself emitted (never a blank inside a fenced record).
  if (lastBlank && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
