// Same Brain 3.0 — hybrid recall (Memorilla-inspired, text-only). Two complementary paths feed one bounded pack:
//   exact   : the semantic graph (verified / reported / inferred assertions with provenance) — authoritative
//   recall  : collection-wide semantic recall over the owner's own memory embeddings — related experiences,
//             preferences, weakly connected information. Never authoritative, never a reason to act.
//
// What is borrowed from Memorilla (arXiv 2610.21375) and what is not:
//   borrowed  · reusable per-document embeddings computed once at ingest (we already have memory_embeddings)
//             · query-dependent selection over the WHOLE collection rather than a single top-k probe
//             · a fixed recall budget independent of collection size (their 16 tokens; our N items / M chars)
//   not used  · learned memory slots injected as prompt embeddings: that needs open decoder weights (Qwen3-8B via
//               vLLM prompt_embeds). Claude has no such interface, so nothing here claims latent-token compatibility.
//
// Trust rules (tests: scripts/verify-hybrid-recall-nov9.mts):
//   · Owner scope only: the index is queried with the verified actor's id; items from any other scope are dropped.
//   · Recall items are evidence class 'reported' (the owner said it) with relevance 'inferred'; a preference drawn
//     across items is a hypothesis, labelled as one, never written back as a fact.
//   · Sensitive categories (health, finances, religion, politics, sexuality, caste, immigration, legal trouble) are
//     never recalled into an unrelated question. If the question is itself about that category, only the owner's own
//     words are shown — no generalisation. This is the opposite of Memorilla's demo (diabetes → breakfast).
//   · Memories whose graph assertions were superseded or retracted (corrections) are dropped as stale.
//   · Exact facts win: a recall item that duplicates an exact assertion or pack fact is removed.
//   · `mayAuthorize: false` on every item; executeGuard and approvals never read recall.

export type RecallDoc = { id: string; text: string; createdAt?: string | null; sourceTable?: string; scopeId: string }
export type RecallHit = RecallDoc & { score: number; probe: string }
export type SensitiveCategory = 'health' | 'finance' | 'religion' | 'politics' | 'sexuality' | 'caste' | 'immigration' | 'legal'

export type RecallItem = {
  id: string
  text: string
  createdAt: string | null
  score: number
  probes: string[]
  evidenceClass: 'reported'
  relevance: 'inferred'
  sensitive: SensitiveCategory | null
  mayAuthorize: false
  why: string
}
export type RecallHypothesis = { text: string; supportIds: string[]; evidenceClass: 'inferred'; why: string }

export type RecallBudget = { maxItems: number; maxChars: number; maxProbes: number; perProbeK: number; minScore: number; mmrLambda: number }
export const DEFAULT_RECALL_BUDGET: RecallBudget = { maxItems: 6, maxChars: 900, maxProbes: 4, perProbeK: 12, minScore: 0.3, mmrLambda: 0.7 }

export type RecallIndex = {
  /** Owner-scoped similarity search. Implementations MUST filter by scopeId themselves. */
  search(scopeId: string, probes: string[], k: number): Promise<RecallHit[]>
  /** Optional: a vector per doc id for diversity (MMR). Without it, diversity uses token overlap. */
  vectorOf?(id: string): number[] | null
}

const SENSITIVE: [SensitiveCategory, RegExp][] = [
  ['health', /\b(diabet\w*|blood (?:sugar|pressure)|cholesterol|cancer|tumou?r|chemo|hiv|std|sti|pregnan\w*|miscarriage|ivf|fertility|depress\w*|anxiety|panic attack|therap(?:y|ist)|psychiatr\w*|adhd|autis\w*|bipolar|schizo\w*|medication|prescription|diagnos\w*|surgery|disab\w*|asthma|thyroid|pcos|allerg\w*|insulin|rehab|addict\w*|sober|relapse|eating disorder|anorex\w*|bulimi\w*|self[- ]harm|suicid\w*|family history of)\b/i],
  ['finance', /\b(salary|ctc|income|net worth|bank balance|account balance|savings of|debt|loan default|emi (?:missed|default)|credit score|cibil|bankrupt\w*|overdraft|(?:i'?m|i am|am|so|totally|flat) broke|can'?t afford)\b/i],
  ['religion', /\b(religio\w*|hindu|muslim|christian|sikh|jain|buddhis\w*|atheis\w*|church|mosque|temple visit|namaz|fasting for (?:ramadan|navratri))\b/i],
  ['politics', /\b(vote[ds]? for|bjp|congress party|aap\b|political (?:party|view)|left[- ]wing|right[- ]wing)\b/i],
  ['sexuality', /\b(gay|lesbian|bisexual|queer|transgender|sexual orientation|coming out|dating app|hookup)\b/i],
  ['caste', /\b(caste|dalit|brahmin|obc|sc\/st|jati)\b/i],
  ['immigration', /\b(visa (?:status|rejected|denied)|green card|citizenship (?:test|application)|asylum|undocumented|naturali[sz]ation|immigra\w*)\b/i],
  ['legal', /\b(arrest\w*|police (?:case|complaint)|fir\b|lawsuit|court case|criminal record|convicted|bail)\b/i],
]

export function sensitiveCategory(text: string): SensitiveCategory | null {
  for (const [c, re] of SENSITIVE) if (re.test(text)) return c
  return null
}

const tokens = (s: string) => new Set(String(s).toLowerCase().replace(/[^a-z0-9@.\s-]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)))
const STOP = new Set('the and for with that this what when where which who how are was were you your yours have has had from about into some any can could would should will just like make made does did not but our out get got want need tell give show me my mine its it\'s there their them they then than also very really please gogo'.split(' '))
const jaccard = (a: Set<string>, b: Set<string>) => { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i) }
const cosine = (a: number[], b: number[]) => { let d = 0, x = 0, y = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i] } return x && y ? d / Math.sqrt(x * y) : 0 }

/** Facet expansion: the question, its named entities, and the domain facets it implies. Deterministic, ≤ maxProbes. */
export function recallProbes(question: string, entityLabels: string[] = [], maxProbes = DEFAULT_RECALL_BUDGET.maxProbes): string[] {
  const q = String(question || '').trim().slice(0, 300)
  const out = [q]
  for (const e of entityLabels.filter(Boolean).slice(0, 2)) out.push(String(e).slice(0, 80))
  const facets: [RegExp, string][] = [
    [/\b(eat|food|lunch|dinner|breakfast|restaurant|order|cuisine|snack|cook|recipe|cafe|coffee|drink)\b/i, 'food preferences dislikes diet favourite places'],
    [/\b(trip|travel|flight|hotel|stay|vacation|holiday|weekend away|visit)\b/i, 'travel preferences seat airline hotel past trips'],
    [/\b(gift|birthday|anniversary|present)\b/i, 'gift ideas likes hobbies of the person past gifts'],
    [/\b(movie|film|show|watch|series|book|read|music|concert)\b/i, 'taste in movies shows books music'],
    [/\b(meeting|call|prep|deck|client|partner|project|deadline)\b/i, 'work commitments promised follow ups project context'],
    [/\b(gym|workout|run|exercise|yoga|sport|play)\b/i, 'routine schedule activities preferences'],
  ]
  for (const [re, f] of facets) if (re.test(q)) { out.push(f); break }
  return [...new Set(out.map(s => s.trim()).filter(s => s.length >= 3))].slice(0, maxProbes)
}

/** Is the question itself about this sensitive category? Only then may the owner's own words on it be shown. */
export function questionAllows(question: string, cat: SensitiveCategory): boolean { return sensitiveCategory(question) === cat }

export type HybridInput = {
  scopeId: string
  question: string
  entityLabels?: string[]
  /** Exact path: texts already in the pack (assertion values, fact summaries) and their source refs. */
  exactTexts?: string[]
  exactSourceRefs?: Set<string>
  /** Graph corrections: source refs (e.g. `memories:42`) whose assertions are all superseded or retracted. */
  staleSourceRefs?: Set<string>
  /** Production: look the hit refs up in the graph after search (see staleRefsFromGraph). */
  resolveStale?: (refs: string[]) => Promise<Set<string>>
  budget?: Partial<RecallBudget>
}
export type HybridResult = { items: RecallItem[]; hypotheses: RecallHypothesis[]; dropped: { stale: number; sensitive: number; duplicate: number; foreign: number; lowScore: number }; probes: string[]; ms: number }

/** Collection-wide, query-dependent, budgeted recall. Pure given the index. Never throws. */
export async function hybridRecall(index: RecallIndex, input: HybridInput): Promise<HybridResult> {
  const t0 = Date.now(); const b = { ...DEFAULT_RECALL_BUDGET, ...(input.budget || {}) }
  const dropped = { stale: 0, sensitive: 0, duplicate: 0, foreign: 0, lowScore: 0 }
  const probes = recallProbes(input.question, input.entityLabels || [], b.maxProbes)
  let hits: RecallHit[] = []
  try { hits = await index.search(input.scopeId, probes, b.perProbeK) } catch { hits = [] }
  // aggregate per doc across probes: best score, all probes that hit it (multi-facet support raises the score a little)
  const byId = new Map<string, RecallHit & { probes: string[] }>()
  for (const h of hits) {
    if (String(h.scopeId) !== String(input.scopeId)) { dropped.foreign++; continue }
    const cur = byId.get(h.id)
    if (!cur) byId.set(h.id, { ...h, probes: [h.probe] })
    else { cur.score = Math.max(cur.score, h.score); if (!cur.probes.includes(h.probe)) cur.probes.push(h.probe) }
  }
  const stale = new Set(input.staleSourceRefs || [])
  if (input.resolveStale && byId.size) { try { for (const r of await input.resolveStale([...byId.values()].map(h => `${h.sourceTable || 'memories'}:${h.id}`))) stale.add(r) } catch { /* labelled anyway */ } }
  const exactTok = (input.exactTexts || []).map(tokens)
  const pool: (RecallHit & { probes: string[]; adj: number; tok: Set<string>; cat: SensitiveCategory | null })[] = []
  for (const h of byId.values()) {
    const ref = `${h.sourceTable || 'memories'}:${h.id}`
    if (stale.has(ref)) { dropped.stale++; continue }
    if (input.exactSourceRefs?.has(ref)) { dropped.duplicate++; continue }
    const tok = tokens(h.text)
    if (exactTok.some(e => jaccard(e, tok) >= 0.6)) { dropped.duplicate++; continue }
    const cat = sensitiveCategory(h.text)
    if (cat && !questionAllows(input.question, cat)) { dropped.sensitive++; continue }
    const adj = h.score + 0.03 * (h.probes.length - 1)
    if (adj < b.minScore) { dropped.lowScore++; continue }
    pool.push({ ...h, adj, tok, cat })
  }
  // MMR: relevance vs. redundancy with what is already chosen, so the fixed budget spans the collection.
  const chosen: typeof pool = []
  let chars = 0
  while (pool.length && chosen.length < b.maxItems) {
    let best = -1, bestVal = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i]
      const red = chosen.length ? Math.max(...chosen.map(s => { const va = index.vectorOf?.(c.id), vb = index.vectorOf?.(s.id); return va && vb ? cosine(va, vb) : jaccard(c.tok, s.tok) })) : 0
      const val = b.mmrLambda * c.adj - (1 - b.mmrLambda) * red
      if (val > bestVal) { bestVal = val; best = i }
    }
    const [c] = pool.splice(best, 1)
    const text = c.text.replace(/\s+/g, ' ').trim().slice(0, 220)
    if (chars + text.length > b.maxChars) break
    chars += text.length; chosen.push({ ...c, text })
  }
  const items: RecallItem[] = chosen.map(c => ({
    id: c.id, text: c.text, createdAt: c.createdAt || null, score: Math.round(c.adj * 1000) / 1000, probes: c.probes,
    evidenceClass: 'reported', relevance: 'inferred', sensitive: c.cat, mayAuthorize: false,
    why: c.cat ? `your own words, shown because you asked about ${c.cat}` : c.probes.length > 1 ? `related to ${c.probes.length} facets of the question` : 'related to the question',
  }))
  // Hypotheses: only non-sensitive, only when ≥2 independent items support the same facet. Labelled, never stored.
  const hypotheses: RecallHypothesis[] = []
  const nonSensitive = items.filter(i => !i.sensitive)
  const facet = probes.find((p, i) => i > 0 && nonSensitive.filter(x => x.probes.includes(p)).length >= 2)
  if (facet) { const sup = nonSensitive.filter(x => x.probes.includes(facet)).slice(0, 3); hypotheses.push({ text: `Possible pattern (${facet.split(' ').slice(0, 2).join(' ')}): ${sup.map(s => s.text.slice(0, 60)).join(' / ')}`, supportIds: sup.map(s => s.id), evidenceClass: 'inferred', why: 'drawn across separate memories; a guess to confirm, not a fact' }) }
  return { items, hypotheses, dropped, probes, ms: Date.now() - t0 }
}

/** Lines for the pack render. Always says what these are. */
export function renderRecall(r: Pick<HybridResult, 'items' | 'hypotheses'>, maxLines = 4): string[] {
  const out: string[] = []
  for (const i of r.items.slice(0, maxLines)) out.push(`Recalled (you said${i.createdAt ? `, ${String(i.createdAt).slice(0, 10)}` : ''}; related, not verified): ${i.text}`)
  for (const h of r.hypotheses.slice(0, 1)) out.push(`Hypothesis, confirm before relying on it: ${h.text}`)
  return out.map(s => s.slice(0, 240))
}

/** Production index over the existing memory_embeddings + match_memories RPC (owner-scoped by p_telegram_id). */
export async function productionRecallIndex(): Promise<RecallIndex> {
  const { supabaseAdmin } = await import('@/lib/supabase-admin')
  const { embedText } = await import('@/lib/services/embeddings')
  const { isIndexable, recallableMemoryText } = await import('@/lib/services/memory-index')
  return {
    async search(scopeId, probes, k) {
      if (!/^-?\d{1,20}$/.test(String(scopeId))) return []
      const vectors = await Promise.all(probes.map(p => embedText(p.slice(0, 1800)).catch(() => null)))
      const results = await Promise.all(vectors.map((v, i) => v ? Promise.resolve(supabaseAdmin.rpc('match_memories', { p_telegram_id: String(scopeId), p_query: v, p_k: k })).then(r => ({ r, probe: probes[i] })) : Promise.resolve(null)))
      const out: RecallHit[] = []
      for (const res of results) {
        if (!res || res.r.error) continue
        for (const row of (res.r.data || []) as any[]) {
          const text = recallableMemoryText(String(row.content || ''), row.source_table ? String(row.source_table) : 'memories')
          if (!text || !isIndexable(text)) continue
          out.push({ id: String(row.source_id ?? row.id), text, createdAt: row.created_at || null, sourceTable: row.source_table ? String(row.source_table) : 'memories', scopeId: String(row.telegram_id ?? scopeId), score: Number(row.score || 0), probe: res.probe })
        }
      }
      return out
    },
  }
}

/** Source refs whose graph assertions are all superseded/retracted (corrections). Owner-scoped. */
export async function staleRefsFromGraph(scopeId: string, refs: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (!refs.length || !/^-?\d{1,20}$/.test(String(scopeId))) return out
  try {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    const ids = refs.map(r => r.split(':').slice(1).join(':')).filter(Boolean).slice(0, 60)
    const { data: srcs } = await supabaseAdmin.from('semantic_sources').select('id,source_type,source_object_ref').eq('scope_type', 'user').eq('scope_id', String(scopeId)).eq('source_type', 'memories').in('source_object_ref', ids)
    if (!srcs?.length) return out
    const { data: rows } = await supabaseAdmin.from('semantic_assertions').select('source_id,assertion_status').eq('scope_type', 'user').eq('scope_id', String(scopeId)).in('source_id', srcs.map((s: any) => s.id))
    const live = new Set((rows || []).filter((r: any) => r.assertion_status === 'current').map((r: any) => r.source_id))
    for (const s of srcs as any[]) if ((rows || []).some((r: any) => r.source_id === s.id) && !live.has(s.id)) out.add(`memories:${s.source_object_ref}`)
  } catch { /* fail open to "not stale": the item is still labelled 'recalled, not verified' */ }
  return out
}
