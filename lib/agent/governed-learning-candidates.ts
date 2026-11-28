// Code-owned evidence mapping for the previously blocked personal journeys.
// No prompt, generated code or external message content is stored here.
import type {AgentCapability} from './policy'
import type {SkillDefinition} from './skill-registry'
export const RECOVERY_SKILLS=[
  {id:'calendar.exact.read',title:'Exact calendar read',purpose:'Resolve the connected calendar, date and timezone before answering. Ask when the account, event or date is ambiguous; require source evidence.',caps:['calendar'],handler:'calendar-named-read',source:'google_calendar',cases:['AG05','AG06','AG22']},
  {id:'email.exact.verify',title:'Email verification and thread continuity',purpose:'Use the exact connected mailbox and thread. Read back the specific message before claiming completion; drafts are not sends.',caps:['email'],handler:'gmail-verification',source:'gmail',cases:['AG07','AG08','AG16','AG22']},
  {id:'reminder.exact.read',title:'Reminder identity and schedule verification',purpose:'Preserve the exact reminder title, date, time, timezone and recurrence. Read canonical state; ask before an ambiguous change.',caps:['reminders'],handler:'reminder-query',source:'canonical_reminders',cases:['AG03','AG09','AG23']},
  {id:'watcher.exact.status',title:'Watcher state and continuity',purpose:'Read the canonical watcher, cadence and latest check state. Never call an unknown delivery successful or restart a stopped watcher.',caps:['browser','reminders'],handler:'watcher-status',source:'canonical_watchers',cases:['AG10','AG15','AG16']},
] as const
export function recoverySkillDefinitions():SkillDefinition[]{
  return RECOVERY_SKILLS.map(x=>({id:x.id,sopVersion:'1.0.0',title:x.title,purpose:x.purpose,requiredCapabilities:[...x.caps] as AgentCapability[],
    input:{},output:{},limits:{maxSteps:1,maxMinutes:1,maxCostPaise:0},exactActionApproval:false,evidence:['provider_readback'],risk:'low',irreversible:false}))
}
// A bounded hourly pass asks the DB to derive candidates from its own verified
// decision receipts. A candidate is an engineering/review suggestion, NOT an
// active skill revision, an approval, a new handler or a claim of success.
export async function generateGovernedLearningCandidates(env:Record<string,string|undefined>,deadline:number,deps?:{now:()=>number;propose:(owner:string,skillId:string,build:string,signal:AbortSignal)=>Promise<unknown>}){
  if(env.GOGO_HACHI_ENFORCEMENT!=='1'||env.GOGO_HACHI_LEARNING_ENABLED!=='1'||!/^[0-9a-f]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA||''))return {considered:0,created:0,unavailable:0}
  const d=deps||{now:Date.now,propose:async(owner,skillId,build,signal)=>{
    const {supabaseAdmin}=await import('@/lib/supabase-admin')
    const r=await supabaseAdmin.rpc('gogo_propose_skill_learning',{p_owner:owner,p_skill_id:skillId,p_build_sha:build}).abortSignal(signal)
    if(r.error)throw Error('learning_candidate_unavailable')
    return r.data
  }}
  const owners=[...new Set(String(env.GOGO_HACHI_PERSONAL_OWNERS||'').split(',').map(s=>s.trim()).filter(s=>/^-?[1-9][0-9]{0,18}$/.test(s)&&Number.isSafeInteger(Number(s))&&String(Number(s))===s))].sort()
  const tasks=owners.flatMap(owner=>RECOVERY_SKILLS.map(s=>({owner,skill:s.id})))
  const offset=tasks.length?Math.floor(d.now()/3600000)%tasks.length:0
  const work=[...tasks.slice(offset),...tasks.slice(0,offset)].slice(0,12)
  let considered=0,created=0,unavailable=0
  for(const item of work){
    const left=deadline-d.now()
    if(left<300)break
    considered++
    try{const r=await d.propose(item.owner,item.skill,env.VERCEL_GIT_COMMIT_SHA!,AbortSignal.timeout(Math.min(1500,left)))
      if(r==='created')created++
      else if(!['existing','insufficient','unavailable'].includes(String(r)))unavailable++
    }catch{unavailable++}
  }
  return {considered,created,unavailable}
}
