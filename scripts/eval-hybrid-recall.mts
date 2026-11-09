// Report runner: current context path vs hybrid recall on the AskGogo synthetic fixtures. Prints a markdown report.
//   npx tsx scripts/eval-hybrid-recall.mts            offline (deterministic embedder; pipeline behaviour)
// The live mode (real embeddings + answer generation, and PersonaMem-v2 / PV4 adapters) is described in
// docs/architecture/same-brain-3/memorilla-evaluation.md and is not run in CI.
import { evaluate } from './lib/hybrid-recall-eval.mts'
const r = await evaluate()
const t = r.totals
console.log(`| Category | Cases | Current pass | Hybrid pass |\n|---|---|---|---|`)
for (const c of r.byCat) console.log(`| ${c.cat} | ${c.n} | ${c.cur} | ${c.hyb} |`)
console.log(`| **All** | ${t.cases} | **${t.currentPass}** | **${t.hybridPass}** |\n`)
console.log(`| Metric | Current | Hybrid |\n|---|---|---|`)
console.log(`| Required evidence missing (total) | ${t.currentMissing} | ${t.hybridMissing} |`)
console.log(`| Forbidden items leaked (stale, sensitive, other tenant) | ${t.currentLeaks} | ${t.hybridLeaks} |`)
console.log(`| Context tokens per question (avg, exact + recall) | ${t.currentTokens} | ${t.hybridTokens} |`)
console.log(`| Retrieval pipeline time per question (avg, offline) | ${t.currentMs} ms | ${t.hybridMs} ms |`)
console.log(`| Embedding calls per question | ${t.currentEmbeddingCalls} | ${t.hybridEmbeddingCalls} |\n`)
console.log(`| Case | Current | Hybrid | Hybrid dropped (stale/sensitive/dup/foreign) |\n|---|---|---|---|`)
for (const x of r.rows) console.log(`| ${x.c.id} | ${x.cur.pass ? 'pass' : `fail${x.cur.missingRequired.length ? ` · missing ${x.cur.missingRequired.join(',')}` : ''}${x.cur.leakedForbidden.length ? ` · leaked ${x.cur.leakedForbidden.join(',')}` : ''}`} | ${x.hyb.pass ? 'pass' : `fail${x.hyb.missingRequired.length ? ` · missing ${x.hyb.missingRequired.join(',')}` : ''}${x.hyb.leakedForbidden.length ? ` · leaked ${x.hyb.leakedForbidden.join(',')}` : ''}`} | ${x.hyb.dropped.stale}/${x.hyb.dropped.sensitive}/${x.hyb.dropped.duplicate}/${x.hyb.dropped.foreign} |`)
