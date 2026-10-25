// Synthetic dry-run for issue #274. No network, no keys: every provider here is a local fake.
// Run: npx tsx scripts/verify-inference-policy.mts
import assert from 'node:assert/strict'
import {
  ALLOWED_TASK_CLASSES,
  FORBIDDEN_TASK_CLASSES,
  ProviderRateLimitedError,
  compressPrompt,
  completeWithFallback,
  detectPersonalData,
  extractProtectedLines,
  routeTask,
  validateRegistry,
  type AccessKind,
  type CompletionRequest,
  type ProviderAdapter,
  type ProviderDataPolicy,
} from '../lib/inference/adapter.ts'

// ---- deterministic PRNG ---------------------------------------------------------------------
let seed = 274_2026
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]

// ---- fake providers ---------------------------------------------------------------------------
type Fake = ProviderAdapter & { received: CompletionRequest[]; failNext: boolean }
function fake(id: string, provider: string, tier: 'free_tier' | 'cheap_paid', dataPolicy: ProviderDataPolicy, access: AccessKind = 'official_api_key'): Fake {
  const f: Fake = {
    id, provider, tier, access, dataPolicy, received: [], failNext: false,
    async complete(req) {
      f.received.push(req)
      if (f.failNext) { f.failNext = false; throw new ProviderRateLimitedError(id) }
      return { text: `ok:${id}`, inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: 120 }
    },
  }
  return f
}
// Owner-approved fallback order proposed in docs/research/inference-gateways.md.
const groq = fake('groq:gpt-oss-20b', 'groq', 'free_tier', { trainsOnInputs: false, humanReview: false, retentionDays: 0 })
const cerebras = fake('cerebras:gpt-oss-120b', 'cerebras', 'free_tier', { trainsOnInputs: false, humanReview: false, retentionDays: 30 })
const workersAi = fake('cloudflare:workers-ai-llama', 'cloudflare', 'free_tier', { trainsOnInputs: false, humanReview: false, retentionDays: 30 })
const mistralFree = fake('mistral:free-experiment', 'mistral', 'free_tier', { trainsOnInputs: true, humanReview: false, retentionDays: 30 })
const geminiPaid = fake('google:gemini-flash-lite-paid', 'google', 'cheap_paid', { trainsOnInputs: false, humanReview: false, retentionDays: 55 })
const providers: Fake[] = [groq, cerebras, workersAi, mistralFree, geminiPaid]

// ---- synthetic content -------------------------------------------------------------------------
const PUBLIC = [
  'Summarise today\'s RBI policy announcement from the public press release.',
  'Extract the top three headlines about Bengaluru metro from these public articles.',
  'Classify this public news snippet into one of: markets, weather, tech, sports.',
  'Draft a generic product announcement for a new monsoon recipe collection.',
  'Write a two-line public weather summary for Bengaluru using the IMD bulletin text.',
  'Tag the language of this public tweet: "Namma Metro purple line extended".',
]
const PII = [
  ['email', 'Reply to divya.r@example.com about the invoice.'],
  ['phone', 'Call Nithin on +91 98450 12345 tomorrow.'],
  ['phone10', 'His number is 9845012345.'],
  ['pan', 'PAN on file ABCDE1234F.'],
  ['aadhaar', 'Aadhaar 1234 5678 9012 attached.'],
  ['card', 'Card 4111 1111 1111 1111 expires soon.'],
  ['upi', 'Pay to divya@okhdfcbank by tonight.'],
  ['otp', 'Your OTP is 448812, do not share.'],
  ['pnr', 'PNR 4521789634 for the Mysuru train.'],
  ['ctx', '[GMAIL thread=18c2] Subject: lease renewal'],
] as const
const PROTECTED_SNIPPETS = [
  '[APPROVAL id=apv_7781 action=send_email to=hidden]  Approved by owner at 09:14 IST  ',
  '[EXECUTION_RECORD run=run_552 status=verified_success] calendar.insert evt_19 ',
  '-----BEGIN APPROVAL-----\n  id: apv_9001\n\n  amount: ₹1,240   \n-----END APPROVAL-----',
]
// Guard records even when a document assembler prepends prose to their line.
for (const text of [
  'Context: [APPROVAL id=synthetic] Do not send.',
  'Excerpt [EXECUTION_RECORD run=synthetic] uncertain',
]) {
  assert.equal(routeTask({ taskClass:'public_web_research', containsPersonalData:false, text, providers }).allowed, false,
    'inline protected records must not reach a cheap provider')
}

const SENTINEL = 'ZZ_PRIVATE_SENTINEL_'

type Mode = 'clean' | 'declared' | 'hidden_pii' | 'protected'
const stats = {
  total: 0, allowed: 0,
  refused: { class: 0, declared: 0, hidden_pii: 0, protected: 0, no_provider: 0 } as Record<string, number>,
  fallbacks: 0, allFailed: 0, byProvider: {} as Record<string, number>,
}

// ---- 1. router + fallback over 240 synthetic requests -----------------------------------------
const allClasses = [...ALLOWED_TASK_CLASSES, ...FORBIDDEN_TASK_CLASSES]
const N = 300
for (let i = 0; i < N; i++) {
  stats.total++
  // half the traffic targets permitted classes so the allow + fallback paths get real coverage
  const taskClass = rand() < 0.5 ? pick(ALLOWED_TASK_CLASSES) : pick(allClasses)
  const mode: Mode = pick(['clean', 'clean', 'declared', 'hidden_pii', 'protected'] as const)
  let text = `${pick(PUBLIC)}\n${pick(PUBLIC)}`
  if (mode === 'hidden_pii' || mode === 'declared') text += `\n${pick(PII)[1]} ${SENTINEL}${i}`
  if (mode === 'protected') text += `\n${pick(PROTECTED_SNIPPETS)} ${SENTINEL}${i}`

  // Randomly rate-limit providers for this request to exercise fallback.
  for (const p of providers) p.failNext = rand() < 0.3
  const coolingDown = rand() < 0.1 ? new Set([groq.id]) : undefined

  const decision = routeTask({ taskClass, containsPersonalData: mode === 'declared', text, providers, coolingDown })
  const isAllowedClass = (ALLOWED_TASK_CLASSES as readonly string[]).includes(taskClass)

  if (!isAllowedClass || mode !== 'clean') {
    assert.equal(decision.allowed, false, `request ${i} (${taskClass}/${mode}) must be refused`)
    if (!decision.allowed) {
      const r = decision.reason
      if (r.startsWith('class_not_permitted')) stats.refused.class++
      else if (r === 'declared_personal_data') stats.refused.declared++
      else if (r === 'detected_personal_data') stats.refused.hidden_pii++
      else if (r === 'contains_approval_or_execution_record') stats.refused.protected++
      else assert.fail(`unexpected refusal reason ${r}`)
    }
    for (const p of providers) p.failNext = false
    continue
  }

  assert.equal(decision.allowed, true, `clean ${taskClass} request ${i} should be allowed: ${JSON.stringify(decision)}`)
  if (!decision.allowed) continue
  stats.allowed++

  // Expected chain: owner order, minus cooling-down, minus training providers for no-training classes.
  const noTraining = taskClass === 'make_draft_nonpersonal' || taskClass === 'safe_classification'
  const expectedChain = providers.filter((p) => !coolingDown?.has(p.id) && !(noTraining && p.dataPolicy.trainsOnInputs)).map((p) => p.id)
  assert.deepEqual(decision.chain.map((p) => p.id), expectedChain, 'chain must preserve owner fallback order')

  const failing = new Set(providers.filter((p) => p.failNext).map((p) => p.id))
  const firstHealthy = expectedChain.find((id) => !failing.has(id))
  const expectedAttempts = firstHealthy ? expectedChain.slice(0, expectedChain.indexOf(firstHealthy) + 1) : expectedChain
  const prompt = compressPrompt(text)
  try {
    const out = await completeWithFallback(decision, prompt)
    assert.deepEqual(out.attempted, expectedAttempts, 'fallback must walk providers strictly in order')
    assert.equal(out.adapterId, firstHealthy)
    // Each provider attempted at most once: no same-provider key rotation.
    assert.equal(new Set(out.attempted.map((id) => id.split(':')[0])).size, out.attempted.length)
    if (out.attempted.length > 1) stats.fallbacks++
    stats.byProvider[out.adapterId] = (stats.byProvider[out.adapterId] || 0) + 1
  } catch (e: any) {
    assert.equal(firstHealthy, undefined, 'all_providers_failed only when every provider failed')
    assert.deepEqual(e.attempted, expectedChain)
    stats.allFailed++
  }
  for (const p of providers) p.failNext = false
}

// Zero-leak audit over everything any fake provider ever received.
let leaks = 0, trainingViolations = 0, received = 0
for (const p of providers) {
  for (const req of p.received) {
    received++
    if (req.prompt.includes(SENTINEL) || detectPersonalData(req.prompt).length || /\[(APPROVAL|EXECUTION_RECORD)/.test(req.prompt)) leaks++
    if (p.dataPolicy.trainsOnInputs && (req.taskClass === 'make_draft_nonpersonal' || req.taskClass === 'safe_classification')) trainingViolations++
  }
}
assert.equal(leaks, 0, 'zero personal-data / protected-record leaks to free or cheap tiers')
assert.equal(trainingViolations, 0, 'owner-originated classes never reach a provider that trains on inputs')
assert.ok(stats.allowed > 20 && stats.fallbacks > 5, 'synthetic mix must exercise allow and fallback paths')
for (const k of ['class', 'declared', 'hidden_pii', 'protected']) assert.ok(stats.refused[k] > 0, `refusal path ${k} exercised`)

// Every individual PII pattern must be caught on its own, even with a clean-looking public prefix.
for (const [name, snippet] of PII) {
  const d = routeTask({ taskClass: 'public_web_research', containsPersonalData: false, text: `${PUBLIC[0]}\n${snippet}`, providers })
  assert.equal(d.allowed, false, `PII pattern ${name} must be refused`)
}

// ---- 2. registry guard: ToS-violating access patterns are refused at configuration time -------
const oauth = fake('anthropic:claude-max-oauth', 'anthropic', 'free_tier', { trainsOnInputs: false, humanReview: false, retentionDays: 30 }, 'consumer_subscription_oauth')
const scrape = fake('ddg:web', 'duckduckgo', 'free_tier', { trainsOnInputs: false, humanReview: false, retentionDays: 30 }, 'keyless_web_scrape')
const groq2 = fake('groq:second-account', 'groq', 'free_tier', { trainsOnInputs: false, humanReview: false, retentionDays: 0 })
const unknownRet = fake('x:unknown', 'xprov', 'free_tier', { trainsOnInputs: false, humanReview: false, retentionDays: null })
const problems = validateRegistry([groq, groq2, oauth, scrape, unknownRet])
assert.ok(problems.some((p) => p.reason.startsWith('multi_account_rotation_forbidden')))
assert.ok(problems.some((p) => p.reason === 'forbidden_access_kind:consumer_subscription_oauth'))
assert.ok(problems.some((p) => p.reason === 'forbidden_access_kind:keyless_web_scrape'))
assert.ok(problems.some((p) => p.reason === 'unknown_retention'))
const badRoute = routeTask({ taskClass: 'public_web_research', containsPersonalData: false, text: PUBLIC[0], providers: [groq, oauth] })
assert.equal(badRoute.allowed, false)
assert.equal(validateRegistry(providers).length, 0, 'proposed registry is clean')

// ---- 3. compression: protected records byte-identical over 220 synthetic documents -------------
let compressDocs = 0, protectedLinesChecked = 0, bytesIn = 0, bytesOut = 0
const FILLER = ['  The   market   opened   higher.  ', 'The market opened higher.', '', '', '\t\tWeather: light rain\t', 'x'.repeat(900), 'Duplicate line', 'Duplicate line']
for (let i = 0; i < 220; i++) {
  const lines: string[] = []
  const n = 6 + Math.floor(rand() * 20)
  for (let j = 0; j < n; j++) {
    const r = rand()
    if (r < 0.2) {
      const snippet = pick(PROTECTED_SNIPPETS)
      // vary whitespace inside protected records to prove nothing is normalised
      lines.push(rand() < 0.5 ? snippet : snippet.replace(/ /g, '  ') + '\t')
    } else lines.push(pick(FILLER))
  }
  if (rand() < 0.2) lines.push('[APPROVAL id=apv_tail]   trailing   ', '', '')
  if (rand() < 0.1) lines.push('-----BEGIN EXECUTION_RECORD-----', '  step: 1  ', '') // unterminated fence: still protected
  const doc = lines.join('\n')
  const before = extractProtectedLines(doc)
  const out = compressPrompt(doc, { maxLineChars: 200 })
  const after = extractProtectedLines(out)
  assert.deepEqual(after, before, `doc ${i}: protected lines must be byte-identical and in order`)
  for (const l of before) assert.ok(out.split('\n').includes(l), `doc ${i}: protected line missing verbatim`)
  protectedLinesChecked += before.length
  bytesIn += Buffer.byteLength(doc); bytesOut += Buffer.byteLength(out)
  compressDocs++
}
assert.ok(bytesOut < bytesIn, 'compression should reduce size on unprotected text')

// ---- report -------------------------------------------------------------------------------------
const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`
const rows: Array<[string, string]> = [
  ['synthetic routing requests', String(stats.total)],
  ['allowed to free/cheap chain', `${stats.allowed} (${pct(stats.allowed, stats.total)})`],
  ['refused: class not permitted', String(stats.refused.class)],
  ['refused: declared personal', String(stats.refused.declared)],
  ['refused: detected personal (caller said clean)', String(stats.refused.hidden_pii)],
  ['refused: approval/execution record', String(stats.refused.protected)],
  ['requests that used fallback', String(stats.fallbacks)],
  ['requests where all providers failed', String(stats.allFailed)],
  ['prompts received by fakes', String(received)],
  ['personal/protected leaks', String(leaks)],
  ['training-tier violations', String(trainingViolations)],
  ['compression docs / protected lines checked', `${compressDocs} / ${protectedLinesChecked}`],
  ['compression size', `${bytesIn} -> ${bytesOut} bytes (${pct(bytesIn - bytesOut, bytesIn)} saved)`],
  ...Object.entries(stats.byProvider).map(([k, v]) => [`served by ${k}`, String(v)] as [string, string]),
]
const w = Math.max(...rows.map((r) => r[0].length))
console.log('\nInference policy dry-run (synthetic, no network)\n' + '-'.repeat(w + 24))
for (const [k, v] of rows) console.log(`${k.padEnd(w)} | ${v}`)
console.log('\nverify-inference-policy: PASS')
