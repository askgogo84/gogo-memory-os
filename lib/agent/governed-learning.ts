// A proposed improvement is data, never an executable handler or authority.
import { createHash } from 'node:crypto'
import { vetSkill, type SkillDefinition } from './skill-registry'
export type LearningScope={kind:'personal'|'workspace';id:string}
export type SkillRevision={scope:LearningScope;skillId:string;baseVersion:string;nextVersion:string;authorId:string;evidenceRefs:readonly string[];summary:string}
export type ReviewContext={scope:LearningScope;reviewerId:string;role:'owner'|'admin'|'member'|'viewer';approved:boolean;testedRevision:string;testReceipt:string;securityReceipt:string;currentVersion:string;testedDigest:string;securityDigest:string;currentDigest:string}
const semver=/^(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})$/
const safeRef=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_:.@/-]{1,200}$/.test(v)
const sameScope=(a:LearningScope,b:LearningScope)=>!!a&&!!b&&a.kind===b.kind&&a.id===b.id&&typeof a.id==='string'&&(a.kind==='personal'?/^-?[1-9][0-9]{0,18}$/.test(a.id):a.kind==='workspace'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a.id))
function canonical(v:unknown):unknown {
  if(v instanceof RegExp)return {regexp:v.source,flags:v.flags}
  if(Array.isArray(v))return v.map(canonical)
  if(v!==null&&typeof v==='object')return Object.fromEntries(Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,canonical(x)]))
  return v
}
export function skillRevisionDigest(def:SkillDefinition):string {
  return createHash('sha256').update(JSON.stringify(canonical(def))).digest('hex')
}
function greater(a:string,b:string){if(!semver.test(a)||!semver.test(b))return false;const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i]}return false}
// Trusted server resolves exact evidence and receipt IDs, authenticates reviewer, and
// persists via compare-and-swap on the active revision. This decision alone publishes nothing.
export function canReviewSkillRevision(p:SkillRevision,current:SkillDefinition,next:SkillDefinition,r:ReviewContext):{allowed:boolean;reason:string}{
  const deny=(reason:string)=>({allowed:false,reason})
  if(!sameScope(p.scope,r.scope)||!safeRef(p.authorId)||!safeRef(r.reviewerId)||!['owner','admin'].includes(r.role)||(r.scope.kind==='personal'&&(r.role!=='owner'||r.reviewerId!==r.scope.id))||p.authorId===r.reviewerId||r.approved!==true)return deny('review_not_authorized')
  // Receipts must bind the entire immutable definition, not merely a version label.
  try {
    if(!vetSkill(current).ok||!vetSkill(next).ok||
      r.currentDigest!==skillRevisionDigest(current)||
      r.testedDigest!==skillRevisionDigest(next)||r.securityDigest!==skillRevisionDigest(next))
      return deny('revision_digest_or_validation_failed')
  } catch { return deny('revision_digest_or_validation_failed') }
  if(!safeRef(p.skillId)||p.skillId!==current.id||next.id!==current.id||p.baseVersion!==current.sopVersion||r.currentVersion!==p.baseVersion||next.sopVersion!==p.nextVersion||!greater(p.nextVersion,p.baseVersion))return deny('stale_or_invalid_version')
  if(!Array.isArray(p.evidenceRefs)||p.evidenceRefs.length<1||p.evidenceRefs.length>20||!p.evidenceRefs.every(safeRef)||typeof p.summary!=='string'||!p.summary.trim()||p.summary.length>1000)return deny('missing_evidence')
  if(r.testedRevision!==p.skillId+'@'+p.nextVersion||!safeRef(r.testReceipt)||!safeRef(r.securityReceipt)||r.testReceipt===r.securityReceipt)return deny('missing_independent_receipts')
  // An improvement may tighten but may never widen the vetted capability or risk envelope.
  if(JSON.stringify(canonical(next.input))!==JSON.stringify(canonical(current.input))||JSON.stringify(canonical(next.output))!==JSON.stringify(canonical(current.output))||
    next.requiredCapabilities.some(c=>!current.requiredCapabilities.includes(c))||
    (next.optionalAdapters||[]).some(a=>!(current.optionalAdapters||[]).includes(a))||
    next.risk!==current.risk||next.irreversible!==current.irreversible||
    (current.exactActionApproval&&!next.exactActionApproval)||
    current.evidence.some(e=>!next.evidence.includes(e))||
    next.limits.maxSteps>current.limits.maxSteps||next.limits.maxMinutes>current.limits.maxMinutes||next.limits.maxCostPaise>current.limits.maxCostPaise)return deny('authority_change')
  return{allowed:true,reason:'reviewed_candidate'}
}
