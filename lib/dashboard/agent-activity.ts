import { supabaseAdmin } from '@/lib/supabase-admin'

export type DashboardActivityStep = {
  id:string
  ordinal:number
  toolName:string
  title:string
  status:string
  output:any
  error:string|null
  startedAt:string|null
  completedAt:string|null
}

export type DashboardActivityRun = {
  id:string
  type:string
  capability:string
  status:string
  title:string
  summary:string
  progress:number
  source:string
  why:string
  startedAt:string|null
  updatedAt:string|null
  completedAt:string|null
  error:string|null
  metadata:any
  steps:DashboardActivityStep[]
  category:'Reminders'|'Browser'|'Research'|'Documents'
}

function categoryFor(run:any, steps:DashboardActivityStep[]):DashboardActivityRun['category']{
  const capability=String(run?.capability||'').toLowerCase()
  const type=String(run?.type||'').toLowerCase()
  const title=String(run?.title||'').toLowerCase()
  const hasBrowser=steps.some(s=>/browser|playwright|secure_browser/i.test(s.toolName)||/browser/i.test(s.title))
  if(capability==='reminders'||/remind/.test(type)||/remind/.test(title))return 'Reminders'
  if(['files','memory'].includes(capability)||/document|invoice|receipt|file/.test(type+' '+title))return 'Documents'
  if(hasBrowser||['browser','travel'].includes(capability)||/train|flight|hotel|booking|browser/.test(type+' '+title))return 'Browser'
  return 'Research'
}

function mapStep(step:any):DashboardActivityStep{
  return {
    id:String(step.id),
    ordinal:Number(step.ordinal||0),
    toolName:String(step.tool_name||''),
    title:String(step.title||'Step'),
    status:String(step.status||'queued'),
    output:step.output_json||{},
    error:step.error?String(step.error):null,
    startedAt:step.started_at||null,
    completedAt:step.completed_at||null,
  }
}

export async function getDashboardActivityRuns(telegramId:string,limit=60):Promise<DashboardActivityRun[]>{
  const [runs,steps]=await Promise.all([
    supabaseAdmin.from('agent_runs')
      .select('id,type,capability,status,title,summary,progress,source,why,metadata_json,started_at,updated_at,completed_at,error')
      .eq('telegram_id',String(telegramId))
      .order('updated_at',{ascending:false})
      .limit(limit),
    supabaseAdmin.from('agent_steps')
      .select('id,run_id,ordinal,tool_name,title,status,output_json,error,started_at,completed_at')
      .eq('telegram_id',String(telegramId))
      .order('created_at',{ascending:false})
      .limit(Math.max(180,limit*6)),
  ])
  if(runs.error)throw new Error(`dashboard_activity_runs_failed:${runs.error.message}`)
  if(steps.error)throw new Error(`dashboard_activity_steps_failed:${steps.error.message}`)

  const byRun=new Map<string,DashboardActivityStep[]>()
  for(const row of steps.data||[]){
    const key=String((row as any).run_id)
    const list=byRun.get(key)||[]
    list.push(mapStep(row))
    byRun.set(key,list)
  }
  for(const list of byRun.values())list.sort((a,b)=>a.ordinal-b.ordinal)

  return (runs.data||[]).map((run:any)=>{
    const runSteps=byRun.get(String(run.id))||[]
    return {
      id:String(run.id),
      type:String(run.type||'command'),
      capability:String(run.capability||''),
      status:String(run.status||'queued'),
      title:String(run.title||'Gogo task'),
      summary:String(run.summary||''),
      progress:Number(run.progress||0),
      source:String(run.source||''),
      why:String(run.why||''),
      startedAt:run.started_at||null,
      updatedAt:run.updated_at||null,
      completedAt:run.completed_at||null,
      error:run.error?String(run.error):null,
      metadata:run.metadata_json||{},
      steps:runSteps,
      category:categoryFor(run,runSteps),
    }
  })
}

export async function getDashboardActivityRun(telegramId:string,runId:string):Promise<DashboardActivityRun|null>{
  const {data:run,error}=await supabaseAdmin.from('agent_runs')
    .select('id,type,capability,status,title,summary,progress,source,why,metadata_json,started_at,updated_at,completed_at,error')
    .eq('telegram_id',String(telegramId))
    .eq('id',String(runId))
    .maybeSingle()
  if(error)throw new Error(`dashboard_activity_run_failed:${error.message}`)
  if(!run)return null
  const {data:steps,error:stepError}=await supabaseAdmin.from('agent_steps')
    .select('id,run_id,ordinal,tool_name,title,status,output_json,error,started_at,completed_at')
    .eq('telegram_id',String(telegramId))
    .eq('run_id',String(runId))
    .order('ordinal',{ascending:true})
  if(stepError)throw new Error(`dashboard_activity_run_steps_failed:${stepError.message}`)
  const runSteps=(steps||[]).map(mapStep)
  return {
    id:String(run.id),
    type:String(run.type||'command'),
    capability:String(run.capability||''),
    status:String(run.status||'queued'),
    title:String(run.title||'Gogo task'),
    summary:String(run.summary||''),
    progress:Number(run.progress||0),
    source:String(run.source||''),
    why:String(run.why||''),
    startedAt:run.started_at||null,
    updatedAt:run.updated_at||null,
    completedAt:run.completed_at||null,
    error:run.error?String(run.error):null,
    metadata:run.metadata_json||{},
    steps:runSteps,
    category:categoryFor(run,runSteps),
  }
}

export function browserContextForRun(run:DashboardActivityRun){
  const meta=run.metadata||{}
  const handoff=meta?.handoff||null
  const browserStep=[...run.steps].reverse().find(s=>s.toolName==='secure_browser'||/browser/i.test(s.toolName)||s.output?.browser)
  // Some browser executors store the browser result directly in output_json,
  // while others nest it under browser/browserState. Accept all live formats.
  const browser=browserStep?.output?.browser||browserStep?.output?.browserState||browserStep?.output||null
  const rawUrl=String(browser?.url||handoff?.providerUrl||'')
  let hostname=''
  try{hostname=rawUrl?new URL(rawUrl).hostname:''}catch{}
  const mode=String(handoff?.mode||'')
  const handoffActive=['paused','waiting_approval'].includes(run.status)
  return {
    hasBrowser:Boolean(browserStep||handoff),
    hostname,
    title:String(browser?.title||''),
    status:String(browser?.status||''),
    summary:String(browser?.summary||run.summary||''),
    handoffMode:mode,
    providerBlocked:handoffActive&&(mode==='device'||String(browser?.blockReason||'')==='provider_access_limited'),
    takeoverAvailable:handoffActive&&Boolean(handoff?.takeoverUrl),
    deviceHandoff:handoffActive&&Boolean(mode==='device'&&handoff?.providerUrl),
  }
}
