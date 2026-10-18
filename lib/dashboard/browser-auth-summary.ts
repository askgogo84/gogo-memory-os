type AuthEvidence={status?:unknown;error?:unknown;reason?:unknown;completedAt?:unknown}
type SummaryRun={summary?:unknown;status?:unknown;error?:unknown;metadata?:{handoff?:{providerUrl?:unknown}};metadata_json?:{handoff?:{providerUrl?:unknown}}}
type SummaryStep={id?:string;ordinal?:number;toolName?:string;status?:string;error?:string|null;completedAt?:string|null;output?:{authReason?:unknown}}

/** Consume only evidence already read through an owner-bound dashboard path. */
export function latestBrowserAuthEvidence(steps:SummaryStep[]):AuthEvidence|undefined{
  const browser=steps.filter(step=>step.toolName==='secure_browser')
  if(browser.some(step=>!Number.isInteger(step.ordinal)||step.ordinal!<0))return undefined
  const latest=[...browser].sort((a,b)=>{
    if(a.ordinal!==b.ordinal)return b.ordinal!-a.ordinal!
    const at=Date.parse(a.completedAt||''),bt=Date.parse(b.completedAt||'')
    if(!Number.isFinite(at)||!Number.isFinite(bt))return Number.isFinite(at)?1:Number.isFinite(bt)?-1:0
    return bt-at||String(b.id||'').localeCompare(String(a.id||''))
  })[0]
  return latest?{status:latest.status,error:latest.error,reason:latest.output?.authReason,completedAt:latest.completedAt}:undefined
}

/** Read-time current-state copy; historical records and task authority stay intact. */
export function browserAuthSummary(run:SummaryRun,step?:AuthEvidence,now=Date.now()):string{
  const summary=String(run.summary||'')
  if(run.status!=='paused'||run.error!=='human_auth_required')return summary
  const completed=Date.parse(String(step?.completedAt||''))
  const reason=step?.status==='failed'&&step.error==='human_auth_required'&&Number.isFinite(completed)&&completed<=now&&typeof step.reason==='string'?step.reason:''
  if(reason==='login_unavailable'){
    let host=''
    try{host=new URL(String((run.metadata||run.metadata_json)?.handoff?.providerUrl||'')).hostname.toLowerCase().replace(/^www\./,'').slice(0,180)}catch{}
    return `I couldn't sign in${host?` to ${host}`:''} automatically, so I paused this task. Open Take control to sign in yourself, then Resume. Keep passwords and sign-in codes out of chat.`
  }
  if(!/couldn.t get[\s\S]*send you a sign.in code/i.test(summary))return summary
  const known:Record<string,string>={otp:'Complete secondary authentication yourself',password:'Sign in yourself',device_approval:'Approve sign-in on your device',captcha:'Complete the provider verification yourself',payment_auth:'Complete payment authentication yourself'}
  return Object.prototype.hasOwnProperty.call(known,reason)?`${known[reason]} in Take control, then Resume this same task. Keep passwords and sign-in codes out of chat.`
    :"This task is paused for a secure provider step. I couldn't verify the recorded sign-in reason. Open Take control to check it, then Resume."
}
