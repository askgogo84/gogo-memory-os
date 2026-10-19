import { retiredRunReason } from './task-lifecycle'

export function partitionAttentionRuns(runs:any[]){
  const activeNow:any[]=[],incomplete:any[]=[],pendingDecisions:any[]=[],waitingContext:any[]=[]
  const seen=new Set<string>()
  for(const run of runs){
    if(retiredRunReason(run))continue
    if(!run.id||seen.has(String(run.id)))continue
    seen.add(String(run.id))
    if(run.status==='running')activeNow.push(run)
    else if(run.status==='queued')incomplete.push(run)
    else if(run.status==='waiting_approval')pendingDecisions.push(run)
    else if(['paused','outcome_unknown'].includes(run.status))waitingContext.push(run)
  }
  return {activeNow,incomplete,pendingDecisions,waitingContext}
}

export function ideaWatcherIds(idea:any):string[]{
  return (Array.isArray(idea.source_refs)?idea.source_refs:[])
    .filter((r:any)=>r?.type==='watcher'&&r.id).map((r:any)=>String(r.id))
}
export function currentWatcherIdeas(ideas:any[],activeIds:Set<string>){
  return ideas.filter(idea=>ideaWatcherIds(idea).every(id=>activeIds.has(id)))
}

export function watcherSupportsCurrentIdea(watcher:any){
  const state=watcher.last_state_json||{}
  return watcher.active===true||(state.triggered===true&&!state.stoppedAt&&!state.stopped_at)
}

// General "what are you working on" asks. Anchored and short so a named object ("status of flight
// 6E123", "usage status", "any update on the news", "my reminder status") never matches here.
const WHAT_IS="what(?:'s|s| is)"
const GENERAL_STATUS_PATTERNS=[
  /^(?:any|got any)\s+(?:updates?|progress)(?:\s+(?:for me|yet|so far))?$/,
  /^(?:status|status update|status check|update|updates)(?:\s+(?:please|pls))?$/,
  new RegExp(`^(?:${WHAT_IS}\\s+the\\s+(?:status|update)|give me (?:a|an)\\s+(?:status\\s+)?update)(?:\\s+(?:please|pls))?$`),
  /^what(?:'re| are)?\s+(?:you|u)\s+(?:currently\s+)?(?:working on|doing|up to|busy with|handling)(?:\s+(?:for me|in the background|right now|now|currently))*$/,
  new RegExp(`^(?:${WHAT_IS}\\s+)?(?:gogo|askgogo)\\s+(?:working on|doing)(?:\\s+(?:for me|right now|now))*$`),
  new RegExp(`^(?:(?:${WHAT_IS}\\s+the\\s+)?status\\s+of\\s+|any\\s+updates?\\s+on\\s+|${WHAT_IS}\\s+happening\\s+with\\s+)(?:all\\s+)?my\\s+(?:background\\s+)?(?:tasks|runs|jobs)$`),
  /^how(?:'s|s| is| are)\s+(?:all\s+)?my\s+(?:background\s+)?(?:tasks|runs|jobs)\s+(?:going|coming along|doing|progressing)$/,
  /^(?:my\s+)?(?:task|tasks)\s+status$/,
]

export function normalizeStatusAsk(text:string){
  return String(text||'').replace(/[\u2018\u2019]/g,"'").replace(/\s+/g,' ').trim().slice(0,500).toLowerCase()
    .replace(/^(?:hey|hi|ok|okay|so)\b\s*,?\s*/,'').replace(/^(?:gogo|askgogo)\s*,\s*/,'')
    .replace(/[?!.\s]+$/,'')
}

export function isAutonomyStatus(text:string){
  const t=String(text||'').replace(/\s+/g,' ').trim().slice(0,500).toLowerCase()
  if(/^(?:what(?:'s| is)?|show me|give me)\s+(?:are\s+you\s+)?(?:working on|doing|handling|tracking)(?:\s+(?:for\s+me|in the background|right now|now))*\??$/.test(t)
    || /^(?:what(?:'s| is)?|show me)\s+(?:my\s+)?(?:agent|gogo|background)\s+(?:status|activity|work)\??$/.test(t))return true
  const n=normalizeStatusAsk(text)
  return Boolean(n)&&n.length<=120&&GENERAL_STATUS_PATTERNS.some(re=>re.test(n))
}
