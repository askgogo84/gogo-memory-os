// Shared evaluation core for hybrid recall vs the current single-probe path. Used by the CI pin
// (scripts/verify-hybrid-recall-nov9.mts) and the report runner (scripts/eval-hybrid-recall.mts).
//
// Honesty notes, also in the doc:
//   · The offline embedder is a deterministic token + hand-written concept hash. It measures the retrieval PIPELINE
//     (probes, budget, MMR, guards, stale suppression, dedupe, scope checks), not embedding quality. Real numbers need
//     the live embedder (text-embedding-3-small, `--live`), which this sandbox cannot reach.
//   · Both systems get the identical exact path; differences come only from the recall path.
//   · The baseline uses the hybrid's score floor (not production's 0.42, which is on a different score scale), so the
//     comparison isolates the design changes rather than threshold tuning.
import { readFileSync } from 'node:fs'
import { hybridRecall, type RecallHit, type RecallIndex } from '../../lib/agent/context-graph/recall'

export type Mem = { id: string; text: string; createdAt?: string }
export type Exact = { id: string; text: string; class: string; sourceRef: string }
export type Tenant = { name: string; memories: Mem[]; exact: Exact[]; stale: string[] }
export type Case = { id: string; category: string; tenant: string; question: string; entities?: string[]; required: string[]; forbidden: string[]; leakyIndex?: boolean; consequential?: boolean }
export type Fixture = { tenants: Record<string, Tenant>; cases: Case[] }

export function loadFixture(path = 'scripts/fixtures/hybrid-recall/askgogo-synthetic.json'): Fixture { return JSON.parse(readFileSync(path, 'utf8')) }

const CONCEPTS: Record<string, string[]> = {
  food: 'dinner lunch breakfast meal meals eat eating restaurant place vegetarian veg egg spicy andhra poha coffee paneer roll swiggy order usual groceries food full'.split(' '),
  travel: 'flight flights trip goa seat seats aisle window pnr indigo villa villas homestay coorg road weekend km'.split(' '),
  gift: 'gift birthday present wishlist headphones'.split(' '),
  running: 'running run race trail gear headphones'.split(' '),
  work: 'deck meeting harbor partners partner pricing sheet review owe promised handling tomorrow'.split(' '),
  home: 'live living moved flat metro rajajinagar indiranagar groceries'.split(' '),
  health: 'thyroid tablet medication medicine diabetes'.split(' '),
  time: 'friday weekend evenings december long pending'.split(' '),
}
const DIM = 192
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return Math.abs(h) % DIM }
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2)
export function toyEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0)
  for (const w of words(text)) { v[hash(w)] += 1; for (const [c, ws] of Object.entries(CONCEPTS)) if (ws.includes(w)) v[hash(`#${c}`)] += 1.5 }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map(x => x / n)
}
export const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0)

/** In-memory owner-scoped index. `leaky` simulates a scope bug upstream (returns rows from every tenant). */
export function memoryIndex(f: Fixture, leaky = false): RecallIndex & { calls: number } {
  const vecs = new Map<string, number[]>()
  for (const [, t] of Object.entries(f.tenants)) for (const m of t.memories) vecs.set(m.id, toyEmbed(m.text))
  const idx = {
    calls: 0,
    async search(scopeId: string, probes: string[], k: number): Promise<RecallHit[]> {
      idx.calls += probes.length
      const out: RecallHit[] = []
      for (const probe of probes) {
        const q = toyEmbed(probe)
        const rows = Object.entries(f.tenants).filter(([sid]) => leaky || sid === scopeId).flatMap(([sid, t]) => t.memories.map(m => ({ ...m, scopeId: sid })))
        rows.map(m => ({ id: m.id, text: m.text, createdAt: m.createdAt || null, sourceTable: 'memories', scopeId: m.scopeId, score: cos(q, vecs.get(m.id)!), probe }))
          .sort((a, b) => b.score - a.score).slice(0, k).forEach(r => out.push(r))
      }
      return out
    },
    vectorOf: (id: string) => vecs.get(id) || null,
  }
  return idx
}

/** The exact path, identical for both systems: graph rows relevant to the question or its entities, top 5. */
export function exactFor(t: Tenant, c: Case): Exact[] {
  const q = toyEmbed(`${c.question} ${(c.entities || []).join(' ')}`)
  return t.exact.map(e => ({ e, s: cos(q, toyEmbed(e.text)) + ((c.entities || []).some(n => e.text.toLowerCase().includes(n.toLowerCase())) ? 0.3 : 0) }))
    .filter(x => x.s >= 0.2).sort((a, b) => b.s - a.s).slice(0, 5).map(x => x.e)
}

export type SystemResult = { selected: string[]; recallIds: string[]; chars: number; ms: number; embeddingCalls: number; pass: boolean; missingRequired: string[]; leakedForbidden: string[] }

const MIN_SCORE = 0.3
export async function runCurrent(f: Fixture, c: Case): Promise<SystemResult> {
  const t = f.tenants[c.tenant]; const idx = memoryIndex(f, !!c.leakyIndex); const t0 = performance.now()
  const exact = exactFor(t, c)
  // Today's path (context-brain): one probe = the question, top 6, score floor; no scope re-check, no sensitive guard,
  // no correction awareness, no dedupe against the graph.
  const hits = (await idx.search(c.tenant, [c.question], 6)).filter(h => h.score >= MIN_SCORE)
  const ms = performance.now() - t0
  return score(c, exact, hits.map(h => ({ id: h.id, text: h.text })), ms, idx.calls)
}
export async function runHybrid(f: Fixture, c: Case): Promise<SystemResult & { dropped: Record<string, number>; hypotheses: number; mayAuthorize: boolean }> {
  const t = f.tenants[c.tenant]; const idx = memoryIndex(f, !!c.leakyIndex); const t0 = performance.now()
  const exact = exactFor(t, c)
  const r = await hybridRecall(idx, { scopeId: c.tenant, question: c.question, entityLabels: c.entities || [], exactTexts: exact.map(e => e.text), exactSourceRefs: new Set(exact.map(e => e.sourceRef)), staleSourceRefs: new Set(t.stale.map(id => `memories:${id}`)), budget: { minScore: MIN_SCORE } })
  const ms = performance.now() - t0
  return { ...score(c, exact, r.items.map(i => ({ id: i.id, text: i.text })), ms, idx.calls), dropped: r.dropped, hypotheses: r.hypotheses.length, mayAuthorize: r.items.some(i => (i as any).mayAuthorize !== false) }
}
function score(c: Case, exact: Exact[], recall: { id: string; text: string }[], ms: number, calls: number): SystemResult {
  const selected = [...exact.map(e => e.id), ...recall.map(r => r.id)]
  const missingRequired = c.required.filter(id => !selected.includes(id))
  const leakedForbidden = c.forbidden.filter(id => selected.includes(id))
  const chars = exact.reduce((s, e) => s + e.text.length, 0) + recall.reduce((s, r) => s + r.text.length, 0)
  return { selected, recallIds: recall.map(r => r.id), chars, ms, embeddingCalls: calls, pass: !missingRequired.length && !leakedForbidden.length, missingRequired, leakedForbidden }
}

export async function evaluate(f = loadFixture()) {
  const rows = [] as { c: Case; cur: SystemResult; hyb: Awaited<ReturnType<typeof runHybrid>> }[]
  for (const c of f.cases) rows.push({ c, cur: await runCurrent(f, c), hyb: await runHybrid(f, c) })
  const cats = [...new Set(f.cases.map(c => c.category))]
  const byCat = cats.map(cat => { const r = rows.filter(x => x.c.category === cat); return { cat, n: r.length, cur: r.filter(x => x.cur.pass).length, hyb: r.filter(x => x.hyb.pass).length } })
  const sum = (k: (x: typeof rows[0]) => number) => rows.reduce((s, x) => s + k(x), 0)
  return {
    rows, byCat,
    totals: {
      cases: rows.length, currentPass: rows.filter(x => x.cur.pass).length, hybridPass: rows.filter(x => x.hyb.pass).length,
      currentLeaks: sum(x => x.cur.leakedForbidden.length), hybridLeaks: sum(x => x.hyb.leakedForbidden.length),
      currentMissing: sum(x => x.cur.missingRequired.length), hybridMissing: sum(x => x.hyb.missingRequired.length),
      currentTokens: Math.round(sum(x => x.cur.chars) / 4 / rows.length), hybridTokens: Math.round(sum(x => x.hyb.chars) / 4 / rows.length),
      currentMs: +(sum(x => x.cur.ms) / rows.length).toFixed(3), hybridMs: +(sum(x => x.hyb.ms) / rows.length).toFixed(3),
      currentEmbeddingCalls: +(sum(x => x.cur.embeddingCalls) / rows.length).toFixed(2), hybridEmbeddingCalls: +(sum(x => x.hyb.embeddingCalls) / rows.length).toFixed(2),
    },
  }
}
