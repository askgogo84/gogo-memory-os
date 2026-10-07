/** Diagnostics deliberately contain only allowlisted reason codes and counts. */
export const browserReadReasons = [
  'plan_ready','plan_empty','invalid_reference','unsupported_reference_action',
  'unknown_control','noneditable_control','unsupported_field','unchanged_search',
  'autocomplete_enter','nonselect_control','invalid_action_shape',
  'needs_product_detail','source_unusable','empty_page','model_incomplete',
  'invalid_assessment_json','unverified_quotes','verified',
  'action_done','action_skipped','control_unavailable','consequential_control',
  'obscured','wrong_input_type','not_actionable','page_closed','timeout','action_error',
] as const
export const browserReadTargets = ['option','airport','date','trip-type','cabin','passengers','adult-count','passenger-done','calendar-done','search','other'] as const
export type BrowserReadReason = typeof browserReadReasons[number]
export type BrowserReadDiagnostic = {
  phase:'plan'|'assessment'|'execution'
  reason:BrowserReadReason
  target?:typeof browserReadTargets[number]
  matches?:number
  rendered?:number
  proposed?:number
  normalized?:number
  accepted?:number
  evidenceCount?:number
  pageChars?:number
}
export function sanitizeBrowserReadDiagnostics(value:unknown):BrowserReadDiagnostic[]{
  if(!Array.isArray(value))return []
  const recent=value.slice(-32)
  const firstFailure=value.find(item=>item?.phase==='execution'&&browserReadReasons.includes(item.reason)&&!['action_done','action_skipped'].includes(item.reason))
  if(firstFailure&&!recent.includes(firstFailure))recent[0]=firstFailure
  return recent.flatMap(item=>{
    if(!item||!['plan','assessment','execution'].includes(item.phase)||!browserReadReasons.includes(item.reason))return []
    const clean:BrowserReadDiagnostic={phase:item.phase,reason:item.reason}
    if(browserReadTargets.includes(item.target))clean.target=item.target
    for(const key of ['proposed','normalized','accepted','evidenceCount','pageChars','matches','rendered'] as const){
      if(Number.isInteger(item[key])&&item[key]>=0&&item[key]<=20000)clean[key]=item[key]
    }
    return [clean]
  })
}
