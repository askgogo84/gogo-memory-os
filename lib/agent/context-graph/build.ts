// buildDecisionContext: deterministic assembly of a bounded decision context from inputs that are already
// owner-scoped (the understanding context, the ranked context pack, semantic facts, policy levels). No model call.
// Pure core (`assembleDecisionContext`) so it is testable; `buildDecisionContext` loads the live inputs.
import { createHash } from 'node:crypto'
import type { AgentActor } from '@/lib/agent/actor'
import type { UnderstandingContext, ContextItem } from '@/lib/agent/understanding'
import type { ContextFact } from '@/lib/agent/context-brain'
import type { CurrentFact } from '@/lib/semantic/repo'
import { evidenceClassOf, type VerificationStatus } from '@/lib/semantic/types'
import { DEFAULT_BUDGET, type Budget, type Conflict, type Deadline, type DecisionContextPack, type Objective, type PackAssertion, type PackEntity, type PackFact } from './types'

const clean = (v: unknown, n = 160) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const line = (i: ContextItem) => [clean(i.title, 120), i.detail ? clean(i.detail, 60) : '', i.at ? clean(i.at, 40) : ''].filter(Boolean).join(' · ')

/** What the person wants, read deterministically. Pure. */
export function classifyObjective(text: string): Objective {
  const t = clean(text, 600); const l = t.toLowerCase()
  const domain: Objective['domain'] =
    /\b(flight|land(?:ed|ing)?|pnr|train|hotel|cab|trip|airport|boarding|check[- ]?in)\b/.test(l) ? 'travel'
    : /\b(meeting|calendar|invite|standup|call with|agenda)\b/.test(l) ? 'calendar'
    : /\b(email|mail|inbox|reply|gmail)\b/.test(l) ? 'email'
    : /\b(paid|pay|payment|bill|invoice|autopay|emi|due amount|upi)\b/.test(l) ? 'payments'
    : /\b(remind|reminder)\b/.test(l) ? 'reminders'
    : /\b(order|buy|price|cart|deliver)\b/.test(l) ? 'shopping'
    : /\b(table|restaurant|dinner|lunch|reservation)\b/.test(l) ? 'dining'
    : /\b(tipplr|outlet|merchant|flipkart|ondc|cancellation|pos)\b/.test(l) ? 'enterprise'
    : /\b(remember|forget|memory|what do you know)\b/.test(l) ? 'memory' : 'other'
  const liveStatus = /\b(has|is|did|was|are)\b.*\b(landed|delayed|on time|arrived|departed|open now|delivered|shipped|paid yet|credited|confirmed|status)\b/.test(l) || /\bstatus of\b|\bwhere is my\b|\btrack\b/.test(l)
  const prepare = /\b(prepare|prep|get ready|brief me|what should i (?:know|bring|read))\b/.test(l)
  const report = /^i (?:already )?(?:paid|sent|booked|did|finished|cancelled|called)\b|\bi'?ve (?:already )?(?:paid|sent|booked|done)\b/.test(l)
  const action = /^(?:book|send|pay|order|cancel|email|call|reserve|buy|transfer|schedule|move|delete)\b/.test(l) || /\b(?:please|can you|could you)\s+(?:book|send|pay|order|cancel|email|call|reserve|buy)\b/.test(l)
  const kind: Objective['kind'] = liveStatus ? 'live_status' : prepare ? 'prepare' : report ? 'report' : action ? 'action' : /\?$/.test(t) || /^(?:what|when|where|who|how|which|is|are|do|does|did|has|have)\b/.test(l) ? 'question' : 'other'
  const requires: string[] = []
  if (domain === 'travel' && (kind === 'live_status' || /\bflight\b/.test(l))) requires.push('travel')
  if (domain === 'calendar' || kind === 'prepare') requires.push('calendar')
  if (domain === 'email' || kind === 'prepare') requires.push('email')
  if (domain === 'payments') requires.push('payments')
  if (domain === 'enterprise') requires.push('merchant')
  return { text: t, normalized: l, kind, domain, liveDataRequired: kind === 'live_status', requiresCapabilities: [...new Set(requires)], consequential: kind === 'action' && /\b(book|send|pay|order|cancel|buy|transfer|delete|reserve)\b/.test(l) }
}

export type AssembleInput = {
  actor: { legacyTelegramId: number; timezone?: string | null }
  objective: string
  understanding: UnderstandingContext | null
  facts: ContextFact[]
  semantic: CurrentFact[]
  permission: (capability: string) => string
  priorDecisions?: string[]
  documentsAvailable?: boolean
  reads: number
  startedAt: number
  now?: number
  budget?: Budget
  /** Hybrid recall result (already owner-scoped, filtered and budgeted by recall.ts). */
  recall?: import('./recall').HybridResult | null
  recallMode?: 'off' | 'shadow' | 'on'
}

/** Pure assembly. */
export function assembleDecisionContext(input: AssembleInput): DecisionContextPack {
  const now = input.now ?? Date.now(); const budget = input.budget || DEFAULT_BUDGET
  const objective = classifyObjective(input.objective)
  const warnings: string[] = []
  const tz = clean(input.actor.timezone || 'Asia/Kolkata', 60)
  const decisionId = createHash('sha256').update(`${input.actor.legacyTelegramId}|${objective.normalized}|${Math.floor(now / 60_000)}`).digest('hex').slice(0, 20)

  // Entities and assertions from the semantic graph, bounded.
  const entities = new Map<string, PackEntity>(); const assertions: PackAssertion[] = []; const refs = new Set<string>()
  const addEntity = (e: { id: string; entity_type: string; canonical_key: string; attributes?: Record<string, unknown> }) => {
    if (!entities.has(e.id) && entities.size < budget.maxNodes) entities.set(e.id, { id: e.id, type: e.entity_type, key: e.canonical_key, label: clean((e.attributes as any)?.title || (e.attributes as any)?.name || e.canonical_key, 80) })
    return entities.has(e.id)
  }
  const relevance = (text: string) => { const words = objective.normalized.split(/[^a-z0-9]+/).filter(w => w.length > 3); return words.some(w => text.toLowerCase().includes(w)) }
  for (const f of input.semantic) {
    if (assertions.length >= budget.maxEdges) { warnings.push('edge_budget_reached'); break }
    const value = f.object ? clean((f.object.attributes as any)?.title || (f.object.attributes as any)?.name || f.object.canonical_key, 80) : clean(typeof f.assertion.literal_value_json === 'string' ? f.assertion.literal_value_json : JSON.stringify(f.assertion.literal_value_json), 120)
    const keep = f.temporal === 'current' || f.temporal === 'future' || relevance(`${f.assertion.predicate} ${value}`)
    if (!keep) continue
    if (!addEntity(f.subject)) continue
    if (f.object) addEntity(f.object)
    const status = f.source.verification_status as VerificationStatus
    const obsMs = f.source.observed_at ? now - Date.parse(f.source.observed_at) : null
    const why = f.temporal === 'historical' ? 'historical, matches the question' : status === 'verified_provider' ? 'provider-verified current fact' : status === 'inferred' || status === 'unverified' ? 'unverified, shown as such' : 'what you told Gogo'
    assertions.push({ subject: f.subject.canonical_key, predicate: f.assertion.predicate, value, objectId: f.object?.id || null, evidenceClass: evidenceClassOf(status), status, temporal: f.temporal, sourceRef: `${f.source.source_type}:${f.source.source_object_ref}`, freshnessMs: Number.isFinite(obsMs as number) ? obsMs : null, why })
    refs.add(`${f.source.source_type}:${f.source.source_object_ref}`)
  }

  // Ranked facts from the existing context pack: drop expired assumptions for live questions.
  const facts: PackFact[] = []
  for (const f of input.facts.slice(0, 24)) {
    const end = f.endAt ? Date.parse(f.endAt) : NaN
    const expired = Number.isFinite(end) && end < now - 6 * 3_600_000
    if (objective.liveDataRequired && (f.source === 'semantic_memory' || f.source === 'memory_insight' || expired)) continue
    const start = f.startAt ? Date.parse(f.startAt) : NaN
    facts.push({ id: f.id, source: f.source, summary: clean(f.summary, 200), score: f.score, confidence: f.confidence, inferred: !!f.inferred, freshnessMs: Number.isFinite(start) ? now - start : null, why: expired ? 'past' : f.inferred ? 'inferred link' : 'ranked by the context pack' })
    refs.add(`${f.source}:${f.id}`)
  }

  const u = input.understanding
  const taskState = { openTasks: (u?.openTasks || []).slice(0, 6).map(line), pendingApprovals: (u?.pendingApprovals || []).slice(0, 5).map(line), watches: (u?.watches || []).slice(0, 6).map(line), reminders: (u?.upcomingReminders || []).slice(0, 8).map(line), travel: (u?.travelLegs || []).slice(0, 6).map(line), calendar: (u?.calendarEvents || []).slice(0, 8).map(line) }

  // Deadlines: anything with a time within 72 h.
  const deadlines: Deadline[] = []
  const push = (label: string, at: string | null | undefined, source: string) => { const t = at ? Date.parse(at) : NaN; if (Number.isFinite(t) && t > now - 3_600_000 && t < now + 72 * 3_600_000) deadlines.push({ label: clean(label, 100), at: new Date(t).toISOString(), source, inHours: Math.round((t - now) / 360_000) / 10 }) }
  for (const r of u?.upcomingReminders || []) push(r.title, r.at, 'reminders')
  for (const c of u?.calendarEvents || []) push(c.title, c.at, 'calendar')
  for (const a of assertions) if (a.predicate === 'due_at' || a.predicate === 'starts_at') push(`${a.subject} ${a.predicate}`, a.value, a.sourceRef)
  deadlines.sort((x, y) => Date.parse(x.at) - Date.parse(y.at))

  // Conflicts: same subject+predicate, different values; provider beats owner beats inference.
  const conflicts: Conflict[] = []
  const groups = new Map<string, PackAssertion[]>()
  for (const a of assertions) { const k = `${a.subject}|${a.predicate}`; groups.set(k, [...(groups.get(k) || []), a]) }
  for (const [k, list] of groups) {
    const values = [...new Set(list.map(a => a.value))]
    if (values.length < 2 || list.some(a => a.objectId)) continue
    const rank = (s: string) => s === 'verified_provider' ? 3 : s === 'user_stated' || s === 'user_preference' ? 2 : 1
    const best = [...list].sort((x, y) => rank(y.status) - rank(x.status) || (x.freshnessMs ?? 1e15) - (y.freshnessMs ?? 1e15))[0]
    const resolution = best.status === 'verified_provider' ? 'provider_wins' : rank(best.status) === 2 && list.every(a => a === best || rank(a.status) < 2) ? 'owner_statement_wins' : 'unresolved'
    conflicts.push({ about: k, values: list.map(a => ({ value: a.value, status: a.status, sourceRef: a.sourceRef })), resolution, chosen: resolution === 'unresolved' ? null : best.value })
  }

  // Missing information and boundaries.
  const missing: string[] = []
  const caps: Record<string, string> = {}
  const blocked: string[] = []
  for (const c of ['calendar', 'email', 'travel', 'payments', 'merchant', 'browser']) { caps[c] = input.permission(c) }
  for (const c of objective.requiresCapabilities) if (caps[c] === 'off') blocked.push(c)
  if (objective.liveDataRequired && objective.domain === 'travel') {
    const flights = [...(u?.travelLegs || []).map(line), ...assertions.filter(a => a.subject.includes('@') || /^[A-Z0-9]{2}\d{1,4}/.test(a.subject)).map(a => a.subject)]
    if (!flights.length) missing.push('which flight (none tracked or saved)')
    missing.push('live flight status (provider read required; saved notes are not current)')
  }
  if (objective.kind === 'prepare') {
    if (!(u?.calendarEvents || []).length) missing.push(caps.calendar === 'off' ? 'calendar (turned off in permissions)' : 'calendar event for the meeting')
    if (input.documentsAvailable === false) missing.push('documents (not connected; say so rather than guess)')
  }
  if (objective.kind === 'report' && objective.domain === 'payments') missing.push('provider confirmation of the payment (what you said is recorded as reported, not verified)')
  if (u) for (const [src, st] of Object.entries(u.sourceStatus || {})) if (st === 'timeout' || st === 'error') missing.push(`${src} (${st})`)

  const ages = [...assertions.map(a => a.freshnessMs), ...facts.map(f => f.freshnessMs)].filter((x): x is number => Number.isFinite(x as number) && (x as number) >= 0)
  const freshness = { newestMs: ages.length ? Math.min(...ages) : null, oldestMs: ages.length ? Math.max(...ages) : null, stale: objective.liveDataRequired }
  // Hybrid recall: exact wins. Drop any recall item whose text duplicates an assertion value or a pack fact, or whose
  // source is already in the exact evidence. What stays is labelled reported/inferred and cannot authorize anything.
  const mode = input.recallMode || 'off'
  const exactBlob = [...assertions.map(a => `${a.predicate} ${a.value}`), ...facts.map(f => f.summary)].join(' \n ').toLowerCase()
  const recallItems = mode === 'off' || !input.recall ? [] : input.recall.items.filter(i => {
    if (refs.has(`memories:${i.id}`) || facts.some(f => f.id === `semantic:${i.id}`)) return false
    const probe = i.text.toLowerCase().slice(0, 80)
    return !(probe.length >= 20 && exactBlob.includes(probe))
  })
  const recall = { items: recallItems, hypotheses: mode === 'off' || !input.recall ? [] : input.recall.hypotheses.filter(h => h.supportIds.every(id => recallItems.some(i => i.id === id))), dropped: input.recall?.dropped || { stale: 0, sensitive: 0, duplicate: 0, foreign: 0, lowScore: 0 }, probes: input.recall?.probes || [], mode }
  if (input.recall) recall.dropped = { ...recall.dropped, duplicate: recall.dropped.duplicate + (input.recall.items.length - recallItems.length) }
  const chars = JSON.stringify({ assertions, facts, recall: mode === 'on' ? recall.items : [], taskState, deadlines, conflicts, missing }).length
  if (chars > budget.maxChars) warnings.push('char_budget_exceeded')
  const ms = Date.now() - input.startedAt
  if (ms > budget.maxMs) warnings.push('time_budget_exceeded')
  if (input.reads > budget.maxReads) warnings.push('read_budget_exceeded')
  return {
    version: 'decision-context-v1', decisionId, actor: { scopeType: 'user', scopeId: String(input.actor.legacyTelegramId), timezone: tz }, objective,
    entities: [...entities.values()], assertions, facts, recall, taskState, deadlines: deadlines.slice(0, 10), priorDecisions: (input.priorDecisions || []).slice(0, 5), conflicts, missing: [...new Set(missing)],
    boundaries: { capabilities: caps, approvalRequired: objective.consequential, blockedCapabilities: blocked },
    generatedAt: new Date(now).toISOString(), expiresAt: new Date(now + (objective.liveDataRequired ? 2 : 15) * 60_000).toISOString(), freshness,
    size: { nodes: entities.size, edges: assertions.length, reads: input.reads, chars, estTokens: Math.ceil(chars / 4), ms }, budget, warnings, evidenceRefs: [...refs].slice(0, 60),
  }
}

/** Lines for the brain's "Decision context" section. Bounded; names what is missing and what is only reported. Pure. */
export function renderDecisionContext(p: DecisionContextPack, maxLines = 10): string[] {
  const out: string[] = []
  out.push(`Objective: ${p.objective.kind} / ${p.objective.domain}${p.objective.liveDataRequired ? ' · needs a live provider read; notes are not current' : ''}${p.objective.consequential ? ' · consequential: approval card before doing it' : ''}`)
  for (const c of p.conflicts.slice(0, 2)) out.push(`Conflict on ${c.about}: ${c.values.map(v => `${v.value} (${v.status})`).join(' vs ')} → ${c.resolution}${c.chosen ? `: ${c.chosen}` : ''}`)
  for (const m of p.missing.slice(0, 3)) out.push(`Missing: ${m}`)
  for (const d of p.deadlines.slice(0, 2)) out.push(`Deadline: ${d.label} in ${d.inHours} h`)
  for (const a of p.assertions.filter(a => a.evidenceClass === 'reported' && p.objective.kind === 'report').slice(0, 2)) out.push(`Reported by you, not provider-verified: ${a.subject} ${a.predicate} ${a.value}`)
  if (p.boundaries.blockedCapabilities.length) out.push(`Turned off in permissions: ${p.boundaries.blockedCapabilities.join(', ')}`)
  if (p.recall?.mode === 'on' && (p.recall.items.length || p.recall.hypotheses.length)) {
    out.push('Recalled memories below are related, not verified. Do not act on them alone; confirm anything consequential.')
    for (const i of p.recall.items.slice(0, 3)) out.push(`Recalled (you said${i.createdAt ? `, ${String(i.createdAt).slice(0, 10)}` : ''}): ${i.text}`)
    for (const h of p.recall.hypotheses.slice(0, 1)) out.push(`Hypothesis, confirm before relying on it: ${h.text}`)
  }
  return out.slice(0, maxLines + (p.recall?.mode === 'on' ? 5 : 0)).map(s => s.slice(0, 240))
}

/** Live: loads inputs with the existing readers (bounded), then assembles. Never throws; returns null when nothing could be read. */
export async function buildDecisionContext(p: { actor: Pick<AgentActor, 'legacyTelegramId' | 'timezone' | 'name' | 'userId' | 'whatsappId'>; objective: string; understanding?: UnderstandingContext | null; facts?: ContextFact[]; now?: Date }): Promise<DecisionContextPack | null> {
  const startedAt = Date.now(); let reads = 0
  const timeout = <T,>(pr: Promise<T>, ms: number): Promise<T | null> => Promise.race([pr, new Promise<T | null>(r => setTimeout(() => r(null), ms))]).catch(() => null)
  try {
    const [semantic, permission, prior] = await Promise.all([
      timeout((async () => { const { semanticRepoFor } = await import('@/lib/semantic/repo'); const { SELF } = await import('@/lib/semantic/ingest'); const repo = await semanticRepoFor(p.actor); if (!repo) return [] as CurrentFact[]; reads++; return repo.neighbourhood(SELF, (p.now || new Date()).getTime()) })(), 1200),
      timeout((async () => { const { supabaseAdmin } = await import('@/lib/supabase-admin'); reads++; const { data } = await supabaseAdmin.from('agent_permissions').select('capability,level').eq('telegram_id', String(p.actor.legacyTelegramId)); const m = new Map<string, string>((data || []).map((r: any) => [r.capability, r.level])); return (c: string) => m.get(c) || 'read' })(), 800),
      timeout((async () => { const { supabaseAdmin } = await import('@/lib/supabase-admin'); reads++; const { data } = await supabaseAdmin.from('agent_activity').select('message').eq('telegram_id', String(p.actor.legacyTelegramId)).eq('event_type', 'decision_learning').order('created_at', { ascending: false }).limit(5); return (data || []).map((r: any) => String(r.message || '').slice(0, 120)) })(), 800),
    ])
    const recallMode = hybridRecallMode(String(p.actor.legacyTelegramId))
    let recall: import('./recall').HybridResult | null = null
    if (recallMode !== 'off') {
      recall = await timeout((async () => {
        const r = await import('./recall'); reads++
        const index = await r.productionRecallIndex()
        const labels = (semantic || []).map(f => String((f.object?.attributes as any)?.label || f.object?.canonical_key || '')).filter(x => x && !x.startsWith('google:') && !x.startsWith('booking:')).slice(0, 2)
        const scopeId = String(p.actor.legacyTelegramId)
        return r.hybridRecall(index, { scopeId, question: p.objective, entityLabels: labels, exactTexts: (p.facts || []).map(f => f.summary).slice(0, 30), exactSourceRefs: new Set((p.facts || []).filter(f => f.source === 'semantic_memory').map(f => `memories:${String(f.id).replace(/^semantic:/, '')}`)), resolveStale: refs => r.staleRefsFromGraph(scopeId, refs) })
      })(), 900)
    }
    return assembleDecisionContext({ actor: p.actor, objective: p.objective, understanding: p.understanding || null, facts: p.facts || [], semantic: semantic || [], permission: permission || (() => 'read'), priorDecisions: prior || [], reads, startedAt, now: (p.now || new Date()).getTime(), recall, recallMode })
  } catch (e: any) { console.error('CONTEXT_GRAPH_BUILD_FAILED:', String(e?.message || e).slice(0, 160)); return null }
}

/** GOGO_CONTEXT_GRAPH: 'shadow' logs the pack and changes nothing; 'on' also adds the Decision context section. Per-owner list optional. */
export function contextGraphMode(owner: string, env: Record<string, string | undefined> = process.env): 'off' | 'shadow' | 'on' {
  const mode = String(env.GOGO_CONTEXT_GRAPH || '').trim().toLowerCase()
  if (mode !== 'shadow' && mode !== 'on') return 'off'
  const owners = String(env.GOGO_CONTEXT_GRAPH_OWNERS || '').split(',').map(s => s.trim()).filter(Boolean)
  return owners.length && !owners.includes(String(owner)) ? 'off' : mode
}

/** Hybrid recall flag: GOGO_HYBRID_RECALL=shadow|on, optionally limited by GOGO_HYBRID_RECALL_OWNERS. Off by default. */
export function hybridRecallMode(owner: string, env: Record<string, string | undefined> = process.env): 'off' | 'shadow' | 'on' {
  const m = String(env.GOGO_HYBRID_RECALL || '').toLowerCase()
  if (m !== 'shadow' && m !== 'on') return 'off'
  const owners = String(env.GOGO_HYBRID_RECALL_OWNERS || '').split(',').map(x => x.trim()).filter(Boolean)
  return owners.length && !owners.includes(String(owner)) ? 'off' : m
}
