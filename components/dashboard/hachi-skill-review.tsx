'use client'

import {useEffect,useRef,useState} from 'react'

type Proposal={id:string;version:string;title:string;purpose:string;summary:string;digest:string;baseDigest:string;reviewed:boolean;selfAuthored:boolean}
type Skill={skillId:string;generation:number;activeDigest:string;activeVersion:string|null;activeRevisionId:string|null;proposals:Proposal[]}
type Budget={periodStart:string;costMicros:string;costLimitMicros:string;tokens:string;tokenLimit:string;modelCalls:string;modelCallLimit:string;toolCalls:string;toolCallLimit:string;unresolved:string;unresolvedCostMicros:string;recentMemoryBlocks:string;enabled:boolean;overrun:boolean}
type ReviewSnapshot={items:Skill[];buildVerified:boolean;budget:Budget|null}
function rupees(v:string):string{
  if(!/^[0-9]{1,30}$/.test(v))return 'unverified'
  const whole=BigInt(v)/BigInt(1000000),fraction=String(BigInt(v)%BigInt(1000000)).padStart(6,'0')
  return '₹'+whole.toLocaleString('en-IN')+'.'+fraction.replace(/0+$/,'').padEnd(2,'0')
}
type Change={action:'publish'|'rollback';skillId:string;revisionId?:string;expectedGeneration:number;expectedDigest:string}

const button='min-h-10 rounded-xl border border-[#36524d] bg-[#132a27] px-3 py-2 text-sm font-medium text-[#85d9cc] disabled:cursor-not-allowed disabled:opacity-45'
const humanError=(code:string)=>code==='scope_forbidden'?'Your current role cannot review this scope.':code==='stale_revision'?'The revision changed since you opened this page. Refresh to verify it.':code==='unreviewed_revision'?'The exact revision no longer has the required independent receipts.':code==='invalid_revision'?'The requested revision could not be verified.':'The review store is unavailable. No change has been confirmed.'

export function HachiSkillReview({workspaceId}:{workspaceId?:string}){
  const [snapshot,setSnapshot]=useState<ReviewSnapshot|null>(null)
  const [busy,setBusy]=useState(true)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [confirm,setConfirm]=useState<{change:Change;label:string}|null>(null)
  const sequence=useRef(0)
  const locked=useRef(false)
  async function request(body:Record<string,unknown>,signal?:AbortSignal){
    const r=await fetch('/api/agent/hachi/skills',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,...(workspaceId?{workspaceId}:{})}),signal})
    const json=await r.json().catch(()=>null)
    if(!r.ok)throw Error(humanError(String(json?.error||'')))
    return json
  }
  async function load(signal?:AbortSignal){
    const n=++sequence.current
    setBusy(true);setError('');setSnapshot(null);setConfirm(null)
    try{
      const data=await request({action:'list'},signal)
      if(!data||!Array.isArray(data.items)||typeof data.buildVerified!=='boolean')throw Error('Review data is unavailable.')
      if(n===sequence.current&&!signal?.aborted)setSnapshot(data)
    }catch(e){
      if(n===sequence.current&&!signal?.aborted)setError(e instanceof Error?e.message:'Could not read the review store.')
    }finally{if(n===sequence.current&&!signal?.aborted)setBusy(false)}
  }
  useEffect(()=>{
    const c=new AbortController()
    void load(c.signal)
    return ()=>{c.abort();sequence.current++}
    // The server renders a distinct key for every selected workspace.
  },[workspaceId])
  async function apply(){
    if(!confirm||locked.current||busy)return
    const action=confirm.change,n=++sequence.current
    locked.current=true;setBusy(true);setError('');setNotice('');setConfirm(null)
    try{
      const r=await request(action)
      if(r?.status!=='changed'||r.generation!==action.expectedGeneration+1)throw Error('The change has no verified receipt. Refresh before attempting another change.')
      if(n===sequence.current){setNotice('Revision change recorded. Reloading the active version…');await load()}
    }catch(e){
      if(n===sequence.current){setSnapshot(null);setError(e instanceof Error?e.message:'Outcome not confirmed. Refresh to verify before retrying.')}
    }finally{locked.current=false;if(n===sequence.current)setBusy(false)}
  }
  return <section aria-label="Governed skill review" className="mt-6 space-y-4 rounded-2xl border border-[#303c39] bg-[#121817] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-[#f2efea]">Skill review &amp; history</h2><p className="mt-1 text-sm leading-relaxed text-[#a8a8a4]">Review independently tested descriptions for this scope. Publishing never changes executable code, permissions or approval requirements.</p></div>
      <button type="button" className={button} disabled={busy} onClick={()=>{setNotice('');void load()}}>Refresh</button>
    </div>
    {busy&&<p role="status" className="text-sm text-[#a8a8a4]">Checking the review store…</p>}
    {notice&&!busy&&<p role="status" className="text-sm text-[#85d9cc]">{notice}</p>}
    {error&&<p role="alert" className="text-sm text-[#e6be7e]">{error}</p>}
    {snapshot&&!snapshot.buildVerified&&<p className="text-sm text-[#e6be7e]">The running build has no verified commit identity. Publication is disabled.</p>}
    {snapshot&&<div className="space-y-2 rounded-xl border border-[#303c39] p-3">
      <h3 className="text-sm font-semibold text-[#f2efea]">Scope budget · IST month</h3>
      {snapshot.budget?<><p className="text-xs text-[#a8a8a4]">Month beginning {snapshot.budget.periodStart} · conservative ledger charges, not provider invoices.</p>
        <div className="grid grid-cols-2 gap-3 text-sm text-[#f2efea]">
          <div><p className="text-xs text-[#a8a8a4]">Reserved / charged vs cap</p>{rupees(snapshot.budget.costMicros)} / {rupees(snapshot.budget.costLimitMicros)}</div>
          <div><p className="text-xs text-[#a8a8a4]">Tokens vs cap</p>{snapshot.budget.tokens} / {snapshot.budget.tokenLimit}</div>
          <div><p className="text-xs text-[#a8a8a4]">Model calls vs cap</p>{snapshot.budget.modelCalls} / {snapshot.budget.modelCallLimit}</div>
          <div><p className="text-xs text-[#a8a8a4]">Tool calls vs cap</p>{snapshot.budget.toolCalls} / {snapshot.budget.toolCallLimit}</div>
          <div><p className="text-xs text-[#a8a8a4]">Unresolved attempts, all periods</p>{snapshot.budget.unresolved} · {rupees(snapshot.budget.unresolvedCostMicros)} held</div>
          <div><p className="text-xs text-[#a8a8a4]">Recent memory denials</p>{snapshot.budget.recentMemoryBlocks}</div>
        </div>
        {(!snapshot.budget.enabled||snapshot.budget.overrun||snapshot.budget.unresolved!=='0')&&<p role="status" className="text-xs text-[#e6be7e]">Budget execution is disabled, breached, or awaiting reconciliation. Check the operator ledger before another attempt.</p>}
      </>:<p className="text-xs text-[#a8a8a4]">Usage totals could not be verified.</p>}
    </div>}
    {snapshot?.items.length===0&&<p className="text-sm text-[#a8a8a4]">No skill descriptions are registered in this scope.</p>}
    {snapshot?.items.map(skill=><article key={skill.skillId} className="space-y-3 rounded-xl border border-[#303c39] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="text-sm font-semibold text-[#f2efea]">{skill.skillId}</h3><p className="mt-1 text-xs text-[#a8a8a4]">Active version: {skill.activeVersion||'unverified'} · revision generation {skill.generation}</p></div>
        {skill.activeRevisionId&&<button type="button" className={button} disabled={busy||!snapshot.buildVerified} onClick={()=>setConfirm({change:{action:'rollback',skillId:skill.skillId,expectedGeneration:skill.generation,expectedDigest:skill.activeDigest},label:'Restore the built-in description for '+skill.skillId})}>Restore built-in</button>}
      </div>
      {skill.proposals.length===0&&<p className="text-xs text-[#a8a8a4]">No operator-reviewed proposals for this build.</p>}
      {skill.proposals.map(p=>{
        const active=p.id===skill.activeRevisionId
        const eligible=p.reviewed&&!p.selfAuthored&&p.baseDigest===skill.activeDigest&&!active&&!!skill.activeVersion&&snapshot.buildVerified
        return <div key={p.id} className="space-y-2 rounded-lg border border-[#27332f] p-3">
          <div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-medium text-[#f2efea]">{p.title} · v{p.version}</span><span className="text-xs text-[#a8a8a4]">{active?'Active':p.reviewed?'Independent receipts present':'Not independently reviewed'}</span></div>
          <p className="text-sm leading-relaxed text-[#b8b8b5]">{p.purpose}</p><p className="text-xs text-[#a8a8a4]">{p.summary}</p>
          <button type="button" className={button} disabled={busy||!eligible} onClick={()=>setConfirm({change:{action:'publish',skillId:skill.skillId,revisionId:p.id,expectedGeneration:skill.generation,expectedDigest:skill.activeDigest},label:'Publish '+p.title+' v'+p.version})}>Review &amp; publish</button>
        </div>
      })}
    </article>)}
    {confirm&&<div role="group" aria-label="Confirm exact revision change" className="space-y-3 rounded-xl border border-[#665230] p-3">
      <p className="text-sm font-semibold text-[#f2efea]">{confirm.label}?</p><p className="text-xs text-[#a8a8a4]">This applies only to the exact version and scope you are reviewing. A stale or revoked receipt prevents the change.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void apply()}>Confirm change</button><button type="button" className={button} disabled={busy} onClick={()=>setConfirm(null)}>Cancel</button></div>
    </div>}
  </section>
}
