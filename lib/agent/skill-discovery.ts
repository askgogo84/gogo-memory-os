// Read-only, staged discovery of trusted static registry definitions.
// Inspired by Hachi's ObjectGraph retrieval pattern; no imported code or runtime privileges.
import type { SkillDefinition } from './skill-registry'

export type SkillRef = Readonly<{ id: string; version: string }>
export type SkillIndexHit = SkillRef & Readonly<{ title: string; score: number }>
export type SkillPreview = SkillRef & Readonly<{ purpose: string; risk: SkillDefinition['risk']; exactActionApproval: boolean }>

function tokens(text: string): string[] {
  return [...new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || [])]
}
const STOP = new Set(['a','an','and','the','to','of','for','with','in','is','on','i','my','me','you','please','can','could','would'])
const key = (s: SkillDefinition): string => s.id + '@' + s.sopVersion
// Ambiguous version identities cannot be resolved. Registry definitions are trusted inputs,
// but a caller must supply a separately authorized set of visible, qualified version IDs.
function visible(defs: readonly SkillDefinition[], allow: ReadonlySet<string>): SkillDefinition[] {
  const counts = new Map<string, number>()
  for (const d of defs) counts.set(key(d), (counts.get(key(d)) || 0) + 1)
  return defs.filter(d => allow.has(key(d)) && counts.get(key(d)) === 1)
}

export function searchSkillIndex(defs: readonly SkillDefinition[], query: string, allowed: ReadonlySet<string>, limit = 5): SkillIndexHit[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10 || query.length > 2000) return []
  const terms = tokens(query).filter(t => !STOP.has(t)).slice(0, 40)
  if (!terms.length) return []
  const hits: SkillIndexHit[] = []
  for (const d of visible(defs, allowed)) {
    const strong = new Set(tokens(d.id + ' ' + d.title))
    const weak = new Set(tokens(d.purpose))
    const score = (query.trim().toLowerCase() === d.id ? 1000 : 0) + terms.reduce((n, t) => n + (strong.has(t) ? 3 : weak.has(t) ? 1 : 0), 0)
    if (score > 0) hits.push({ id: d.id, version: d.sopVersion, title: d.title.slice(0, 100), score })
  }
  return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id) || a.version.localeCompare(b.version)).slice(0, limit)
}

// Recheck the caller's *current* visibility at each pass; never trust a cached hit.
export function resolveSkillDefinition(defs: readonly SkillDefinition[], ref: SkillRef, allowed: ReadonlySet<string>): SkillDefinition | null {
  return visible(defs, allowed).find(d => d.id === ref.id && d.sopVersion === ref.version) ?? null
}

export function previewSkills(defs: readonly SkillDefinition[], refs: readonly SkillRef[], allowed: ReadonlySet<string>): SkillPreview[] {
  const seen = new Set<string>()
  const out: SkillPreview[] = []
  for (const ref of refs.slice(0, 10)) {
    const d = resolveSkillDefinition(defs, ref, allowed)
    if (!d || seen.has(key(d))) continue
    seen.add(key(d))
    out.push({ id: d.id, version: d.sopVersion, purpose: d.purpose.slice(0, 240), risk: d.risk, exactActionApproval: d.exactActionApproval })
  }
  return out
}
// Discovery is not permission to execute: existing canRunSkill and provider gates remain mandatory.
