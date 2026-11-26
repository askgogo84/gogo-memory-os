// Addendum 3: run the synthetic shadow evaluation, candidate (Muse Ember) against the current primary (Haiku).
// Makes real paid API calls, so it needs all three: EVAL_ALLOW_NETWORK=1, --terms-checked (you read Meta's current data
// terms), and keys in MODEL_API_KEY (Meta) and ANTHROPIC_API_KEY. Sends only the committed synthetic cases.
//   Claude Code, repo root:  EVAL_ALLOW_NETWORK=1 MODEL_API_KEY=… ANTHROPIC_API_KEY=… npx tsx scripts/eval-model-shadow.mts --terms-checked
import { writeFileSync } from 'node:fs'
import { buildCases, scoreCase, summarise, type ModelResult } from './lib/model-shadow-eval.mts'
import { callMuseEmber, estimateMuseEmberUsd, MUSE_EMBER_MODEL } from '../lib/inference/muse-ember-eval.ts'

const cases = buildCases()
if (process.env.EVAL_ALLOW_NETWORK !== '1' || !process.argv.includes('--terms-checked') || !process.env.MODEL_API_KEY || !process.env.ANTHROPIC_API_KEY || process.env.VERCEL_ENV === 'production') {
  console.log(`MODEL_SHADOW_EVAL_NOT_RUN: ${cases.length} synthetic cases ready; needs EVAL_ALLOW_NETWORK=1, --terms-checked, MODEL_API_KEY and ANTHROPIC_API_KEY (never on production).`)
  process.exit(0)
}
const BASELINE = process.env.EVAL_BASELINE_MODEL || 'claude-haiku-4-5'
const BASE_PRICE = { input: Number(process.env.EVAL_BASELINE_IN_USD || 1), output: Number(process.env.EVAL_BASELINE_OUT_USD || 5) }
async function baseline(prompt: string) {
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: BASELINE, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }), signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`baseline_http_${res.status}`)
  const p: any = await res.json()
  const text = (p?.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim()
  return { text, ms: Date.now() - t0, usd: (Number(p?.usage?.input_tokens || 0) * BASE_PRICE.input + Number(p?.usage?.output_tokens || 0) * BASE_PRICE.output) / 1e6 }
}
const cand: ModelResult[] = []; const base: ModelResult[] = []; const failures: any[] = []
for (const k of cases) {
  for (const [name, bucket, run] of [['candidate', cand, async () => { const r = await callMuseEmber(fetch, process.env.MODEL_API_KEY!, k.prompt, 300, process.env.EVAL_REASONING || 'low'); return { text: r.text, ms: r.ms, usd: estimateMuseEmberUsd(r.inputTokens, r.outputTokens) } }], ['baseline', base, () => baseline(k.prompt)]] as const) {
    try { const r = await run(); const s = scoreCase(k, r.text); bucket.push({ caseId: k.id, ok: s.ok, why: s.why, ms: r.ms, usd: r.usd }); if (!s.ok) failures.push({ model: name, id: k.id, why: s.why, output: r.text.slice(0, 120) }) }
    catch (e: any) { bucket.push({ caseId: k.id, ok: false, why: `error:${String(e?.message || e).slice(0, 60)}`, ms: 0, usd: 0 }); failures.push({ model: name, id: k.id, why: String(e?.message || e).slice(0, 80) }) }
  }
}
const report = { at: new Date().toISOString(), cases: cases.length, candidate: { model: MUSE_EMBER_MODEL, ...summarise(cases, cand) }, baseline: { model: BASELINE, price: BASE_PRICE, ...summarise(cases, base) }, failures }
const out = process.env.EVAL_OUT || 'model-shadow-eval-report.json'
writeFileSync(out, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ cases: cases.length, candidate: report.candidate.overall, baseline: report.baseline.overall, candidateAdversarial: report.candidate.adversarial, baselineAdversarial: report.baseline.adversarial, report: out }, null, 2))
