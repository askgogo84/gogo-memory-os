// Addendum 3: the Muse Ember candidate stays an evaluation-only adapter, the routing policy never lets a cheaper
// model answer, and the shadow set is large, synthetic and scored honestly.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { makeMuseEmberEvaluationAdapter, museEmberRequestBody, estimateMuseEmberUsd, MUSE_EMBER_MODEL, MUSE_EMBER_ENDPOINT } from '../lib/inference/muse-ember-eval.ts'
import { routeModelTask, TASK_POLICIES, MODEL_TASKS } from '../lib/inference/task-routing.ts'
import { buildCases, scoreCase, summarise } from './lib/model-shadow-eval.mts'
import { validateRegistry } from '../lib/inference/adapter.ts'
let n = 0; const ok = (c: unknown, m: string) => { assert.ok(c, m); n++ }
const policy = { trainsOnInputs: false, humanReview: false, retentionDays: 30 }
const calls: any[] = []
const fakeFetch = (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ choices: [{ message: { content: ' promo ' } }], usage: { prompt_tokens: 100, completion_tokens: 2 } }), { status: 200 }) }) as unknown as typeof fetch

// 1. Adapter gates.
ok(makeMuseEmberEvaluationAdapter({ apiKey: 'k', approvedPolicy: policy, fetchImpl: fakeFetch }) === null, 'not enabled → no adapter')
ok(makeMuseEmberEvaluationAdapter({ apiKey: 'k', enabled: true, fetchImpl: fakeFetch }) === null, 'no approved data policy → no adapter')
ok(makeMuseEmberEvaluationAdapter({ apiKey: 'k', enabled: true, approvedPolicy: { ...policy, retentionDays: null }, fetchImpl: fakeFetch }) === null, 'unknown retention → no adapter')
ok(makeMuseEmberEvaluationAdapter({ enabled: true, approvedPolicy: policy, fetchImpl: fakeFetch }) === null, 'no key → no adapter')
const prevVercel = process.env.VERCEL_ENV; process.env.VERCEL_ENV = 'production'
ok(makeMuseEmberEvaluationAdapter({ apiKey: 'k', enabled: true, approvedPolicy: policy, fetchImpl: fakeFetch }) === null, 'production → no adapter')
if (prevVercel === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = prevVercel
const a = makeMuseEmberEvaluationAdapter({ apiKey: 'k', enabled: true, approvedPolicy: policy, fetchImpl: fakeFetch })!
ok(a && validateRegistry([a]).length === 0, 'a fully specified adapter is a valid registry entry (positive control)')
await assert.rejects(() => a.complete({ taskClass: 'make_draft_nonpersonal', prompt: 'x' }), /class_denied/); n++
await assert.rejects(() => a.complete({ taskClass: 'safe_classification', prompt: 'call me on +91 98765 43210 or divya@example.com' }), /sensitive_payload/); n++
await assert.rejects(() => a.complete({ taskClass: 'safe_classification', prompt: '   ' }), /empty_prompt/); n++
ok(calls.length === 0, 'no request left the process for any refused call')
const r = await a.complete({ taskClass: 'safe_classification', prompt: 'Classify: 50% off this weekend only' })
ok(r.text === 'promo' && r.inputTokens === 100 && calls.length === 1, 'allowed call returns trimmed text and usage')
ok(calls[0].url === MUSE_EMBER_ENDPOINT && JSON.parse(calls[0].init.body).model === MUSE_EMBER_MODEL && JSON.parse(calls[0].init.body).reasoning_effort === 'low', 'official endpoint, exact model id, low reasoning')
ok(calls[0].init.headers.authorization === 'Bearer k' && !String(calls[0].init.body).includes('Bearer'), 'key only in the header')
ok(museEmberRequestBody('p', 999999).max_tokens === 4096, 'output is bounded')
ok(estimateMuseEmberUsd(1_000_000, 0) === 0.3 && estimateMuseEmberUsd(100_000, 100_000) === 0.06, 'published prices, incl. the over-200K tier')

// 2. Nothing live imports the adapter or the policy.
const importers = execSync("git grep -lE \"muse-ember-eval|inference/task-routing\" -- lib app components || true").toString().trim().split('\n').filter(Boolean)
ok(importers.every(f => f === 'lib/inference/muse-ember-eval.ts' || f === 'lib/inference/task-routing.ts'), `no live import: ${importers.join(',')}`)
ok(!/muse|meta\b/i.test(readFileSync('lib/inference/cheap.ts', 'utf8')), 'not registered in cheapProviders()')

// 3. Routing policy: default off; the candidate is never the answering model.
const cand = { id: 'meta:muse-ember-1.0', personalDataApproved: false }
for (const t of MODEL_TASKS) { const off = routeModelTask({ task: t, containsPersonalData: true }, cand, {}); ok(off.shadowCandidate === null && !/muse/.test(off.answerModel), `${t}: router off → primary only`) }
const sh = { GOGO_MODEL_ROUTER: 'shadow' }
ok(routeModelTask({ task: 'intent_classification', containsPersonalData: true }, cand, sh).reason === 'candidate_terms_not_approved', "owner data never reaches a candidate without approved terms")
ok(routeModelTask({ task: 'intent_classification', containsPersonalData: true, syntheticFixture: true }, cand, sh).shadowCandidate === cand.id, 'synthetic fixtures may be shadowed (positive control)')
ok(routeModelTask({ task: 'intent_classification', containsPersonalData: true }, { ...cand, personalDataApproved: true }, sh).shadowCandidate === cand.id, 'approved terms allow shadow')
for (const t of ['complex_reasoning', 'sensitive_workflow', 'made_up_task']) { const x = routeModelTask({ task: t, containsPersonalData: false, syntheticFixture: true }, cand, sh); ok(x.shadowCandidate === null && /sonnet/.test(x.answerModel), `${t}: strong model, no candidate`) }
ok(routeModelTask({ task: 'light_tool_decision', containsPersonalData: false, consequential: true }, cand, sh).reason === 'consequential', 'consequential → strong model')
ok(routeModelTask({ task: 'reminder_parse', containsPersonalData: false, previousFailure: true }, cand, sh).escalated === true, 'failure → escalate')
ok(Object.values(TASK_POLICIES).every(p => p.primary === 'sonnet' || p.primary === 'haiku'), 'every primary is an existing model')

// 4. Shadow set: ≥100, unique ids, adversarial and failure cases, synthetic only.
const cases = buildCases()
ok(cases.length >= 100, `at least 100 cases (have ${cases.length})`)
ok(new Set(cases.map(c => c.id)).size === cases.length, 'unique ids')
ok(cases.filter(c => c.kind === 'adversarial').length >= 15 && cases.filter(c => c.kind === 'failure').length >= 5, 'adversarial ≥15 and failure ≥5')
ok(new Set(cases.map(c => c.task)).size === 6, 'six task families')
ok(cases.every(c => !/@(?!example\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(c.prompt) && !/\+?\d[\d\s-]{9,}\d/.test(c.prompt)), 'only example.com addresses and no phone numbers')
// 5. The scorer rejects wrong answers (negative controls) and accepts right ones.
const promo = cases.find(c => c.id === 'email_classification-a01')!
ok(scoreCase(promo, 'promo').ok && !scoreCase(promo, 'urgent').ok && !scoreCase(promo, 'I think promo, maybe').ok, 'label scoring is exact and injection-following fails')
const rem = cases.find(c => c.id === 'reminder_parse-r01')!
ok(scoreCase(rem, '```json\n{"task":"call Divya","date":"2026-11-11","time":"09:15"}\n```').ok && !scoreCase(rem, '{"task":"call Divya","date":"2026-11-10","time":"09:15"}').ok, 'reminder JSON is checked field by field')
const s = summarise(cases, cases.map((c, i) => ({ caseId: c.id, ok: i % 2 === 0, why: '', ms: 100 + i, usd: 0.001 })))
ok(Math.abs(s.overall.accuracy - 0.5) < 0.01 && s.overall.usdPerCorrect! > 0.0019, 'summary reports accuracy and cost per CORRECT answer')
console.log(`MUSE_EMBER_EVAL_OK ${n} checks, ${cases.length} cases`)
