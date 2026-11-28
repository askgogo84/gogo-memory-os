// Server-side, scope-bound review store for descriptive skill revisions.
// Only operator-created proposals/receipts can be published. No new handlers,
// instructions, input schemas, risk controls, limits or capabilities are loaded.
import {supabaseAdmin} from '@/lib/supabase-admin'
import {exactSessionOwnerId} from '@/lib/dashboard/owner-identity'
import {requireWorkspaceRole} from '@/lib/workspaces/access'
import {isSecretShapedMemory} from '@/lib/bot/memory-redaction'
import {governedEnabled} from './governed-runtime'
import {canReviewSkillRevision,skillRevisionDigest,type LearningScope} from './governed-learning'
import type {SkillDefinition} from './skill-registry'
import {catalogBaseDefinitions} from './governed-skill-catalog'
type Scope=LearningScope
export type RevisionRow={id:string;scope_kind:Scope['kind'];scope_id:string;skill_id:string;version:string;base_digest:string;static_digest:string;revision_digest:string;build_sha:string;title:string;purpose:string;author_id:string;evidence_refs:string[];summary:string;expires_at:string}
export type ReceiptRow={revision_id:string;review_kind:'test'|'security';reviewer_id:string;receipt_ref:string;revision_digest:string;build_sha:string;valid_until:string}
type Pointer={skill_id:string;revision_id:string|null;generation:number|string;active_digest:string;build_sha:string}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const DIGEST=/^[0-9a-f]{64}$/
const BUILD=/^[0-9a-f]{40}$/
const VERSION=/^(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})\.(0|[1-9][0-9]{0,7})$/
const REF=/^[A-Za-z0-9_:.@/-]{1,200}$/
const revisionFields='id,scope_kind,scope_id,skill_id,version,base_digest,static_digest,revision_digest,build_sha,title,purpose,author_id,evidence_refs,summary,expires_at'
const receiptFields='revision_id,review_kind,reviewer_id,receipt_ref,revision_digest,build_sha,valid_until'
const pointerFields='skill_id,revision_id,generation,active_digest,build_sha'
const build=()=>String(process.env.VERCEL_GIT_COMMIT_SHA||'')
export class SkillReviewError extends Error{constructor(readonly code:string,readonly status:number){super(code)}}
const fail=(code:string,status=503):never=>{throw new SkillReviewError(code,status)}
const textOk=(v:unknown,max:number)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v)&&!isSecretShapedMemory(v)
export function revisionDefinition(base:SkillDefinition,row:RevisionRow,scope:Scope,buildSha:string,now=Date.now()):SkillDefinition|null{
  if(!row||row.scope_kind!==scope.kind||row.scope_id!==scope.id||row.skill_id!==base.id||!UUID.test(row.id)||!VERSION.test(row.version)||row.version===base.sopVersion||
    row.static_digest!==skillRevisionDigest(base)||row.build_sha!==buildSha||!BUILD.test(buildSha)||!DIGEST.test(row.base_digest)||!DIGEST.test(row.revision_digest)||
    !textOk(row.title,100)||!textOk(row.purpose,240)||!textOk(row.summary,1000)||!REF.test(row.author_id)||
    !Array.isArray(row.evidence_refs)||row.evidence_refs.length<1||row.evidence_refs.length>20||!row.evidence_refs.every(x=>typeof x==='string'&&REF.test(x)&&!isSecretShapedMemory(x))||
    !Number.isFinite(now)||!(Date.parse(row.expires_at)>now))return null
  const next={...base,title:row.title,purpose:row.purpose,sopVersion:row.version}
  return skillRevisionDigest(next)===row.revision_digest?next:null
}
export function verifiedRevisionReceipts(row:RevisionRow,receipts:readonly ReceiptRow[],reviewer?:string,now=Date.now()):{test:ReceiptRow;security:ReceiptRow}|null{
  const valid=receipts.filter(x=>x.revision_id===row.id&&x.revision_digest===row.revision_digest&&x.build_sha===row.build_sha&&REF.test(x.reviewer_id)&&REF.test(x.receipt_ref)&&Date.parse(x.valid_until)>now)
  const tests=valid.filter(x=>x.review_kind==='test'),security=valid.filter(x=>x.review_kind==='security')
  if(tests.length!==1||security.length!==1)return null
  const t=tests[0],s=security[0]
  if(t.reviewer_id===s.reviewer_id||t.receipt_ref===s.receipt_ref||[t.reviewer_id,s.reviewer_id].includes(row.author_id)||(reviewer&&[t.reviewer_id,s.reviewer_id].includes(reviewer)))return null
  return {test:t,security:s}
}
async function access(actor:string,scope:Scope,review:boolean):Promise<'owner'|'admin'|'member'|'viewer'>{
  if(exactSessionOwnerId(actor)!==actor||!governedEnabled(scope.kind,scope.id))return fail('scope_unavailable')
  if(scope.kind==='personal'&&scope.id!==actor||scope.kind==='workspace'&&!UUID.test(scope.id))return fail('scope_forbidden',403)
  const u=await supabaseAdmin.from('users').select('telegram_id,access_status').eq('telegram_id',actor).maybeSingle()
  if(u.error)return fail('scope_unavailable')
  if(exactSessionOwnerId(u.data?.telegram_id)!==actor||u.data?.access_status!=='active')return fail('scope_forbidden',403)
  const p=await supabaseAdmin.from('gogo_governed_policies').select('enabled,valid_until').eq('scope_kind',scope.kind).eq('scope_id',scope.id).maybeSingle()
  if(p.error||p.data?.enabled!==true||!(Date.parse(p.data.valid_until)>Date.now()))return fail('scope_unavailable')
  if(scope.kind==='personal')return 'owner'
  try{
    const m=await requireWorkspaceRole(actor,scope.id,'view')
    if(review&&m.role!=='owner'&&m.role!=='admin')return fail('scope_forbidden',403)
    return m.role
  }catch{return fail('scope_forbidden',403)}
}
async function pointers(scope:Scope):Promise<Pointer[]>{
  const r=await supabaseAdmin.from('gogo_skill_active').select(pointerFields).eq('scope_kind',scope.kind).eq('scope_id',scope.id).limit(101)
  if(r.error||!Array.isArray(r.data)||r.data.length>100)return fail('review_unavailable')
  return r.data as Pointer[]
}
async function revision(scope:Scope,skill:string,id:string):Promise<RevisionRow|null>{
  const r=await supabaseAdmin.from('gogo_skill_revisions').select(revisionFields).eq('scope_kind',scope.kind).eq('scope_id',scope.id).eq('skill_id',skill).eq('id',id).maybeSingle()
  if(r.error)return fail('review_unavailable')
  return r.data as RevisionRow|null
}
async function receipts(id:string):Promise<ReceiptRow[]>{
  const r=await supabaseAdmin.from('gogo_skill_revision_receipts').select(receiptFields).eq('revision_id',id).limit(3)
  if(r.error||!Array.isArray(r.data)||r.data.length>2)return fail('review_unavailable')
  return r.data as ReceiptRow[]
}
function generation(p:Pointer|undefined):number{
  const v=p?Number(p.generation):0
  if(!Number.isSafeInteger(v)||v<0||p&&v===0)return fail('review_unavailable')
  return v
}
async function currentDefinition(scope:Scope,base:SkillDefinition,p:Pointer|undefined,buildSha:string):Promise<SkillDefinition|null>{
  if(!p||!p.revision_id)return !p||p.active_digest===skillRevisionDigest(base)?base:null
  if(p.skill_id!==base.id||!UUID.test(p.revision_id)||p.build_sha!==buildSha)return null
  const r=await revision(scope,base.id,p.revision_id)
  if(!r||r.revision_digest!==p.active_digest||!verifiedRevisionReceipts(r,await receipts(r.id)))return null
  return revisionDefinition(base,r,scope,buildSha)
}
/** Approved metadata only, never used for execution. Expired/revoked/build-stale
 * revisions fall back to the static description; the operator can roll back. */
export async function reviewedCatalogDefinitions(actor:string,scope:Scope):Promise<SkillDefinition[]>{
  await access(actor,scope,false)
  const defs=catalogBaseDefinitions(scope.kind),sha=build()
  const ps=await pointers(scope)
  const out:SkillDefinition[]=[]
  for(const base of defs)out.push(await currentDefinition(scope,base,ps.find(x=>x.skill_id===base.id),sha)||base)
  await access(actor,scope,false)
  return out
}
export async function listSkillReview(actor:string,scope:Scope){
  await access(actor,scope,true)
  const defs=catalogBaseDefinitions(scope.kind),sha=build(),ps=await pointers(scope)
  const r=await supabaseAdmin.from('gogo_skill_revisions').select(revisionFields).eq('scope_kind',scope.kind).eq('scope_id',scope.id).order('created_at',{ascending:false}).limit(100)
  if(r.error||!Array.isArray(r.data))return fail('review_unavailable')
  const items=[]
  for(const base of defs){
    const p=ps.find(x=>x.skill_id===base.id)
    const proposals=[]
    for(const row of (r.data as RevisionRow[]).filter(x=>x.skill_id===base.id)){
      const next=revisionDefinition(base,row,scope,sha)
      if(!next)continue
      const reviewed=!!verifiedRevisionReceipts(row,await receipts(row.id),actor)
      proposals.push({id:row.id,version:row.version,title:row.title,purpose:row.purpose,summary:row.summary,digest:row.revision_digest,baseDigest:row.base_digest,reviewed,selfAuthored:row.author_id===actor})
    }
    const active=await currentDefinition(scope,base,p,sha)
    items.push({skillId:base.id,generation:generation(p),activeDigest:p?.active_digest||skillRevisionDigest(base),activeVersion:active?.sopVersion||null,activeRevisionId:p?.revision_id||null,canRestore:!!p&&(!!p.revision_id||p.active_digest!==skillRevisionDigest(base)||p.build_sha!==sha),proposals})
  }
  // Automatic candidates are separate from the approved revision store and never executable.
  let learningCandidates:unknown[]=[]
  if(scope.kind==='personal'){
    const consent=await supabaseAdmin.from('user_consent_settings').select('memory_enabled').eq('telegram_id',actor).maybeSingle()
    if(!consent.error&&consent.data?.memory_enabled===true){
      const result=await supabaseAdmin.from('gogo_skill_learning_candidates').select('skill_id,positive_count,negative_count,reason_code,created_at,expires_at').eq('scope_kind','personal').eq('scope_id',scope.id).eq('build_sha',sha).gt('expires_at',new Date().toISOString()).limit(12)
      if(!result.error&&Array.isArray(result.data))learningCandidates=result.data
    }
  }
  const budget=await supabaseAdmin.rpc('gogo_read_scope_budget',{p_scope_kind:scope.kind,p_scope_id:scope.id,p_actor_id:actor})
  await access(actor,scope,true)
  return {items,buildVerified:BUILD.test(sha),budget:budget.error?null:budget.data,learningCandidates}
}
export type ReviewChange={action:'publish'|'rollback';skillId:string;revisionId?:string;expectedGeneration:number;expectedDigest:string}
export async function changeSkillReview(actor:string,scope:Scope,x:ReviewChange){
  const role=await access(actor,scope,true)
  if(role!=='owner'&&role!=='admin')return fail('scope_forbidden',403)
  const base=catalogBaseDefinitions(scope.kind).find(b=>b.id===x.skillId),sha=build()
  if(!base||!BUILD.test(sha)||!Number.isSafeInteger(x.expectedGeneration)||x.expectedGeneration<0||!DIGEST.test(x.expectedDigest))return fail('invalid_revision',400)
  const p=(await pointers(scope)).find(z=>z.skill_id===base.id)
  if(generation(p)!==x.expectedGeneration||(p?.active_digest||skillRevisionDigest(base))!==x.expectedDigest)return fail('stale_revision',409)
  if(x.action==='publish'){
    if(!x.revisionId||!UUID.test(x.revisionId))return fail('invalid_revision',400)
    const row=await revision(scope,base.id,x.revisionId),current=await currentDefinition(scope,base,p,sha)
    if(!row||!current||row.base_digest!==skillRevisionDigest(current))return fail('unreviewed_revision',409)
    const next=revisionDefinition(base,row,scope,sha),rs=verifiedRevisionReceipts(row,await receipts(row.id),actor)
    if(!next||!rs)return fail('unreviewed_revision',409)
    const review=canReviewSkillRevision({scope,skillId:base.id,baseVersion:current.sopVersion,nextVersion:next.sopVersion,authorId:row.author_id,evidenceRefs:row.evidence_refs,summary:row.summary},current,next,
      {scope,reviewerId:actor,role,approved:true,testedRevision:base.id+'@'+next.sopVersion,testReceipt:rs.test.receipt_ref,securityReceipt:rs.security.receipt_ref,currentVersion:current.sopVersion,currentDigest:skillRevisionDigest(current),testedDigest:rs.test.revision_digest,securityDigest:rs.security.revision_digest})
    if(!review.allowed)return fail('unreviewed_revision',409)
  }else if(x.action!=='rollback'||x.revisionId||!p||(!p.revision_id&&p.active_digest===skillRevisionDigest(base)&&p.build_sha===sha))return fail('invalid_revision',400)
  await access(actor,scope,true)
  const r=await supabaseAdmin.rpc('gogo_change_skill_revision',{p_scope_kind:scope.kind,p_scope_id:scope.id,p_actor_id:actor,p_skill_id:base.id,p_action:x.action,p_revision_id:x.revisionId||null,p_expected_generation:x.expectedGeneration,p_expected_digest:x.expectedDigest,p_static_digest:skillRevisionDigest(base),p_build_sha:sha})
  if(r.error)return fail('review_unavailable')
  if(r.data!=='changed')return fail(r.data==='forbidden'?'scope_forbidden':r.data==='stale'?'stale_revision':'unreviewed_revision',r.data==='forbidden'?403:409)
  return {status:'changed' as const,generation:x.expectedGeneration+1}
}
