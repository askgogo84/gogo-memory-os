// Live research runner: PersonaMem-v2 (pmv2) and PersonalizationV4 (pv4) — current single-probe recall vs hybrid
// recall, with a Claude answerer and Memorilla's own scoring rule (nearest of the candidate answers by embedding).
// NOT part of npm test. Needs network, an OpenAI key (embeddings) and an Anthropic key (answers); costs money.
//
// Data handling (see docs/architecture/same-brain-3/memorilla-evaluation.md §Datasets):
//   · Rows are read from a JSONL file OUTSIDE this repository, exported by the owner with Memorilla's own loader:
//       python -c "from memorilla.data import ensure_data, load_split; import json,sys
//       ds=load_split('pv4','test',ensure_data('pv4',['test'])); [print(json.dumps({k:r[k] for k in
//       ('collection_id','question','answer','choices','documents','hard') if k in r})) for r in ds]" > /data/pv4-test.jsonl
//   · PV4 is CC BY 4.0 (cite Memorilla + Synthetic-Persona-Chat). PersonaMem-v2: confirm the licence on the
//     memorilla/Memorilla-Data dataset card before use; do not redistribute.
//   · Synthetic personas only. Never point this at live AskGogo data.
//
// Usage:
//   EVAL_ALLOW_NETWORK=1 npx tsx scripts/eval-memorilla-benchmarks.mts --file /data/pv4-test.jsonl --benchmark pv4 \
//     --limit 200 [--hard] --license-checked
import { readFileSync } from 'node:fs'
import { hybridRecall, type RecallHit, type RecallIndex } from '../lib/agent/context-graph/recall'

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined }
const flag = (k: string) => process.argv.includes(`--${k}`)
if (process.env.EVAL_ALLOW_NETWORK !== '1' || !flag('license-checked')) { console.error('Refusing: set EVAL_ALLOW_NETWORK=1 and pass --license-checked after reading the dataset licence.'); process.exit(2) }
const file = arg('file'); const bench = arg('benchmark') || 'pv4'; const limit = Number(arg('limit') || 100)
if (!file || file.startsWith(process.cwd())) { console.error('Pass --file pointing outside the repository.'); process.exit(2) }

const OpenAI = (await import('openai')).default; const Anthropic = (await import('@anthropic-ai/sdk')).default
const openai = new OpenAI(); const anthropic = new Anthropic()
const EMB = 'text-embedding-3-small'; const ANSWERER = process.env.EVAL_ANSWER_MODEL || 'claude-haiku-5-5'
const cos = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i] } return d / Math.sqrt(x * y) }
async function embed(texts: string[]) { const out: number[][] = []; for (let i = 0; i < texts.length; i += 256) { const r = await openai.embeddings.create({ model: EMB, input: texts.slice(i, i + 256).map(t => t.slice(0, 2000)) }); out.push(...r.data.map(d => d.embedding)) } return out }

type Row = { collection_id: number; question: string; answer: string; choices: string[]; documents: string[]; hard?: boolean }
let rows: Row[] = readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
if (flag('hard')) rows = rows.filter(r => r.hard)
rows = rows.slice(0, limit)

const docVecs = new Map<number, number[][]>()
async function indexFor(r: Row): Promise<RecallIndex> {
  if (!docVecs.has(r.collection_id)) docVecs.set(r.collection_id, await embed(r.documents))
  const vecs = docVecs.get(r.collection_id)!
  return {
    async search(scopeId, probes, k) {
      const pv = await embed(probes); const out: RecallHit[] = []
      pv.forEach((q, pi) => vecs.map((v, i) => ({ i, s: cos(q, v) })).sort((a, b) => b.s - a.s).slice(0, k).forEach(({ i, s }) => out.push({ id: String(i), text: r.documents[i], scopeId, score: s, probe: probes[pi], sourceTable: 'memories' })))
      return out
    },
    vectorOf: id => vecs[Number(id)] || null,
  }
}
async function answer(question: string, memories: string[]) {
  const t0 = Date.now()
  const msg = await anthropic.messages.create({ model: ANSWERER, max_tokens: 256, system: 'You are a personal assistant. Use the remembered context about the user when it is relevant. Answer in 2-3 sentences.', messages: [{ role: 'user', content: `Remembered context (related, not verified):\n${memories.map(m => `- ${m}`).join('\n') || '- (none)'}\n\nQuestion: ${question}` }] })
  const text = msg.content.map((c: any) => c.text || '').join(' ')
  return { text, ms: Date.now() - t0, inTok: msg.usage.input_tokens, outTok: msg.usage.output_tokens }
}
async function correct(r: Row, gen: string) { const cands = r.choices.filter(Boolean); const [g, ...c] = await embed([gen, ...cands]); const best = c.map((v, i) => ({ i, s: cos(g, v) })).sort((a, b) => b.s - a.s)[0]; return cands[best.i] === r.answer }

const stats = { current: { ok: 0, inTok: 0, ms: 0 }, hybrid: { ok: 0, inTok: 0, ms: 0 }, sensitiveDropped: 0, n: 0 }
for (const r of rows) {
  const idx = await indexFor(r)
  const cur = (await idx.search('bench', [r.question], 5)).map(h => h.text.slice(0, 400))
  const hy = await hybridRecall(idx, { scopeId: 'bench', question: r.question, budget: { maxItems: 6, maxChars: 1800 } })
  stats.sensitiveDropped += hy.dropped.sensitive
  const [a, b] = await Promise.all([answer(r.question, cur), answer(r.question, hy.items.map(i => i.text))])
  if (await correct(r, a.text)) stats.current.ok++; if (await correct(r, b.text)) stats.hybrid.ok++
  stats.current.inTok += a.inTok; stats.hybrid.inTok += b.inTok; stats.current.ms += a.ms; stats.hybrid.ms += b.ms; stats.n++
  if (stats.n % 20 === 0) console.error(`${stats.n}/${rows.length}`)
}
const pct = (x: number) => (100 * x / stats.n).toFixed(2)
console.log(JSON.stringify({ benchmark: bench, rows: stats.n, answerer: ANSWERER, embedder: EMB, currentTop5: { accuracy: pct(stats.current.ok), avgInputTokens: Math.round(stats.current.inTok / stats.n), avgAnswerMs: Math.round(stats.current.ms / stats.n) }, hybrid: { accuracy: pct(stats.hybrid.ok), avgInputTokens: Math.round(stats.hybrid.inTok / stats.n), avgAnswerMs: Math.round(stats.hybrid.ms / stats.n) }, sensitiveItemsWithheld: stats.sensitiveDropped, note: 'Memorilla-reported (Qwen3-8B, trained memory): PMv2 44.60, PV4 66.65; not directly comparable (different answerer).' }, null, 2))
