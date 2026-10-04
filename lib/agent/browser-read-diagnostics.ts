/** Diagnostics deliberately contain only allowlisted reason codes and counts. */
export const browserReadReasons = [
  'plan_ready','plan_empty','invalid_reference','unsupported_reference_action',
  'unknown_control','noneditable_control','unsupported_field','unchanged_search',
  'autocomplete_enter','nonselect_control','invalid_action_shape',
  'needs_product_detail','source_unusable','empty_page','model_incomplete',
  'invalid_assessment_json','unverified_quotes','verified',
] as const
export type BrowserReadReason = typeof browserReadReasons[number]
export type BrowserReadDiagnostic = {
  phase:'plan'|'assessment'
  reason:BrowserReadReason
  proposed?:number
  normalized?:number
  accepted?:number
  evidenceCount?:number
  pageChars?:number
}
export function sanitizeBrowserReadDiagnostics(value:unknown):BrowserReadDiagnostic[]{
  if(!Array.isArray(value))return []
  return value.slice(-32).flatMap(item=>{
    if(!item||!['plan','assessment'].includes(item.phase)||!browserReadReasons.includes(item.reason))return []
    const clean:BrowserReadDiagnostic={phase:item.phase,reason:item.reason}
    for(const key of ['proposed','normalized','accepted','evidenceCount','pageChars'] as const){
      if(Number.isInteger(item[key])&&item[key]>=0&&item[key]<=20000)clean[key]=item[key]
    }
    return [clean]
  })
}
