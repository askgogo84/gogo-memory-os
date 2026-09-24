export function partitionAttentionRuns(runs:any[]){
  const activeNow:any[]=[],incomplete:any[]=[],pendingDecisions:any[]=[],waitingContext:any[]=[]
  const seen=new Set<string>()
  for(const run of runs){
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
