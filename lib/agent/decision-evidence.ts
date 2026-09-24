// Pure, auditable evidence aggregation. No model scores, permissions or mutations.
export const MIN_CALIBRATION_SAMPLES = 20
export function learningDecisionId(messageId:unknown,runId?:unknown){
  const run=String(runId||'')
  // Provider execution reconciles by durable run identity, not the APPROVE turn.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(run)
    ?run:messageId?String(messageId):null
}
export type LearningEvidence = {
  handler:string; domain:string; outcome:string; verified?:boolean
  confidence?:number|null; similarity?:number; decision_id?:string|null
  first_route_correct?:boolean|null; correction?:string|null
}

export function finiteConfidence(value:unknown):number|null {
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1?value:null
}

// 95% Wilson lower bound for observed verified completion. A small number of
// wins cannot produce a high-confidence route, even if every win was verified.
export function completionLowerBound(successes:number,total:number){
  if(!total||!successes)return 0
  const z=1.96, p=successes/total, z2=z*z
  return Math.max(0,Math.min(1,(p+z2/(2*total)-z*Math.sqrt((p*(1-p)+z2/(4*total))/total))/(1+z2/total)))
}

export function observedOutcome(status:unknown):'success'|'failed'|'blocked'|'unknown' {
  if(status==='completed')return 'success'
  if(status==='failed')return 'failed'
  if(status==='blocked'||status==='waiting_approval'||status==='paused')return 'blocked'
  return 'unknown'
}

export function uniqueEvidence(rows:LearningEvidence[]){
  // Input is newest first. Prefer the latest outcome of a decision, so a later
  // correction/unknown reconciliation supersedes its earlier success.
  const seen=new Set<string>()
  return rows.filter(row=>{
    if(!row.decision_id)return true // legacy events cannot be reliably joined
    const key=`${row.domain}:${row.handler}:${row.decision_id}`
    if(seen.has(key))return false
    seen.add(key);return true
  })
}

export function summarizeEvidence(input:LearningEvidence[]){
  const rows=uniqueEvidence(input).filter(r=>r.outcome!=='replacement')
  const total=rows.length
  const verified=rows.filter(r=>r.outcome==='verified_success'&&r.verified===true).length
  const corrected=rows.filter(r=>r.outcome==='corrected').length
  const failed=rows.filter(r=>r.outcome==='failed').length
  const clarified=rows.filter(r=>r.outcome==='clarified').length
  const unknown=rows.filter(r=>['unknown','outcome_unknown'].includes(r.outcome)).length
  const judged=rows.filter(r=>typeof r.first_route_correct==='boolean')
  const identified=rows.filter(r=>r.decision_id)
  const identifiedVerified=identified.filter(r=>r.outcome==='verified_success'&&r.verified===true).length
  const rate=(n:number)=>total?n/total:null
  return {decisions:total,verifiedCompletions:verified,corrections:corrected,failures:failed,clarifications:clarified,unknown,
    verifiedCompletionRate:rate(verified),correctionRate:rate(corrected),failedRate:rate(failed),clarificationRate:rate(clarified),unknownRate:rate(unknown),
    firstRouteJudgments:judged.length,firstRouteAccuracy:judged.length?judged.filter(r=>r.first_route_correct).length/judged.length:null,
    calibrationSamples:identified.length,
    confidence:identified.length>=MIN_CALIBRATION_SAMPLES?completionLowerBound(identifiedVerified,total):0,
    calibrationMethod:'verified_completion_wilson_95_lower_bound',minimumSamples:MIN_CALIBRATION_SAMPLES}
}

export function rankEvidence(input:LearningEvidence[]){
  const rows=uniqueEvidence(input)
  const grouped=new Map<string,LearningEvidence[]>()
  for(const row of rows){
    if(!/^[a-z][a-z0-9_-]{0,99}$/.test(row.handler))continue
    grouped.set(row.handler,[...(grouped.get(row.handler)||[]),row])
  }
  const ranked=[...grouped].map(([handler,events])=>({handler,...summarizeEvidence(events),
    // Unverified successes and correction replacements may suggest a shadow
    // candidate, but cannot raise its calibrated live-routing confidence.
    shadowScore:events.reduce((s,r)=>s+(r.similarity??1)*(r.outcome==='verified_success'&&r.verified?2:r.outcome==='success'||r.outcome==='replacement'?0.25:r.outcome==='corrected'?-4:r.outcome==='failed'?-2:0),0)
  })).sort((a,b)=>b.confidence-a.confidence||b.shadowScore-a.shadowScore)
  const avoidHandlers=ranked.filter(r=>r.corrections>0||r.failures>0).map(r=>r.handler)
  const best=ranked.find(r=>r.shadowScore>0&&!avoidHandlers.includes(r.handler))
  const conflicting=ranked.some(r=>r.handler!==best?.handler&&r.verifiedCompletions>0&&!avoidHandlers.includes(r.handler))
  return {preferredHandler:best?.handler||null,avoidHandlers,confidence:conflicting?0:best?.confidence||0,
    evidence:best||null,conflictingEvidence:conflicting}
}

export function calibrationBuckets(rows:LearningEvidence[]){
  const ranges=[[0,.5],[.5,.7],[.7,.82],[.82,.9],[.9,1]]
  return ranges.map(([min,max],index)=>({min,max,...summarizeEvidence(rows.filter(r=>{
    const c=finiteConfidence(r.confidence)
    return c!==null&&c>=min&&(index===ranges.length-1?c<=max:c<max)
  }))}))
}
