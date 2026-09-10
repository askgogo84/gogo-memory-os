'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const LEVELS = ['off','read','draft','ask','auto'] as const

type Snapshot = {
  runs:any[]; watchers:any[]; goals:any[]; ideas:any[]; approvals:any[]; permissions:any[]; artifacts:any[]
}

async function api(path:string, init:RequestInit={}){
  const res=await fetch(path,{...init,headers:{Accept:'application/json','Content-Type':'application/json',...(init.headers||{})},credentials:'same-origin',cache:'no-store'})
  const body=await res.json().catch(()=>({}))
  if(!res.ok)throw new Error(String(body?.error||`request_failed_${res.status}`))
  return body
}

export default function AgentDashboardPage(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [command,setCommand]=useState('')
  const [result,setResult]=useState('')
  const [goal,setGoal]=useState('')
  const [artifact,setArtifact]=useState<any|null>(null)
  const [threads,setThreads]=useState<any[]>([])
  const [threadTitle,setThreadTitle]=useState('')
  const [activeThread,setActiveThread]=useState<any|null>(null)

  const load=useCallback(async(silent=false)=>{
    try{
      if(!silent)setLoading(true)
      const [s,t]=await Promise.all([api('/api/agent/snapshot'),api('/api/agent/threads')])
      setSnapshot(s);setThreads(t.threads||[]);setError('')
    }catch(e:any){setError(e?.message||'Could not load Gogo Agent.')}
    finally{if(!silent)setLoading(false)}
  },[])

  useEffect(()=>{load();const id=setInterval(()=>load(true),8000);return()=>clearInterval(id)},[load])

  const counts=useMemo(()=>({
    active:(snapshot?.runs||[]).filter(r=>['queued','running','waiting_approval'].includes(r.status)).length,
    approvals:snapshot?.approvals?.length||0,
    watchers:snapshot?.watchers?.length||0,
    goals:snapshot?.goals?.length||0,
  }),[snapshot])

  async function run(){
    const text=command.trim();if(!text||busy)return
    setBusy('run');setResult('');setError('')
    try{
      const body=await api('/api/agent/run',{method:'POST',body:JSON.stringify({text,context:activeThread?{threadId:activeThread.id}:{}})})
      setResult(body.text||`${body.capability||'Agent'} · ${body.status||'completed'}`);setCommand('');await load(true)
    }catch(e:any){setError(e?.message||'Agent run failed.')}
    finally{setBusy('')}
  }

  async function resolveApproval(a:any,decision:'approve'|'reject'){
    setBusy(`approval:${a.id}`);setError('')
    try{
      await api(`/api/agent/approvals/${encodeURIComponent(a.id)}`,{method:'POST',body:JSON.stringify({decision})})
      if(decision==='approve'){
        const r=await api(`/api/agent/runs/${encodeURIComponent(a.runId)}/execute`,{method:'POST',body:'{}'})
        setResult(r.text||`Approved · ${r.status}`)
      }else setResult(`Rejected: ${a.title}`)
      await load(true)
    }catch(e:any){setError(e?.message||'Could not resolve approval.')}
    finally{setBusy('')}
  }

  async function permission(capability:string,level:string){
    setBusy(`permission:${capability}`)
    try{await api('/api/agent/permissions',{method:'PUT',body:JSON.stringify({capability,level})});await load(true)}
    catch(e:any){setError(e?.message||'Could not update Safe Mode.')}
    finally{setBusy('')}
  }

  async function createGoal(){
    const outcome=goal.trim();if(!outcome||busy)return
    setBusy('goal')
    try{
      const title=outcome.replace(/[.!?].*$/,'').slice(0,120)||'Gogo goal'
      await api('/api/agent/goals',{method:'POST',body:JSON.stringify({title,outcome,deadline:null})})
      setGoal('');await load(true)
    }catch(e:any){setError(e?.message||'Could not create goal.')}
    finally{setBusy('')}
  }

  async function stopWatcher(id:string){
    setBusy(`watcher:${id}`)
    try{await api(`/api/agent/watchers/${encodeURIComponent(id)}`,{method:'DELETE'});await load(true)}
    catch(e:any){setError(e?.message||'Could not stop watcher.')}
    finally{setBusy('')}
  }

  async function openArtifact(id:string){
    setBusy(`artifact:${id}`)
    try{const b=await api(`/api/agent/artifacts/${encodeURIComponent(id)}`);setArtifact(b.artifact||null)}
    catch(e:any){setError(e?.message||'Could not open artifact.')}
    finally{setBusy('')}
  }

  async function createThread(){
    const title=threadTitle.trim();if(!title||busy)return
    setBusy('thread')
    try{const b=await api('/api/agent/threads',{method:'POST',body:JSON.stringify({title,context:{}})});setThreadTitle('');setActiveThread(b.thread);await load(true)}
    catch(e:any){setError(e?.message||'Could not create workspace.')}
    finally{setBusy('')}
  }

  if(loading&&!snapshot)return <div className="mx-auto max-w-[1440px] py-16 text-sm text-gogo-ink-3">Opening Gogo Agent…</div>

  return <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-10">
    <header className="relative overflow-hidden rounded-[34px] bg-[linear-gradient(135deg,#34190d_0%,#542b17_55%,#38233e_100%)] px-7 py-8 text-white shadow-[0_28px_70px_rgba(58,36,24,.20)] lg:px-9">
      <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-gogo-orange/20 blur-[90px]" />
      <div className="pointer-events-none absolute bottom-[-8rem] left-[36%] h-64 w-64 rounded-full bg-gogo-plum/25 blur-[90px]" />
      <div className="relative flex flex-col gap-7 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-5">
          <div className="hidden h-24 w-24 shrink-0 place-items-center rounded-[26px] border border-white/10 bg-white/8 shadow-inner lg:grid">
            <img src="/gogo-float.gif" alt="Gogo Agent" className="h-20 w-20 object-contain" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.22em] text-[#ff9a3d]"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,.10)]"/>Gogo Agent · live</div>
            <h1 className="mt-3 font-serif text-[40px] font-semibold leading-none tracking-[-.8px] lg:text-[48px]">Plan. Act. Watch.</h1>
            <p className="mt-3 max-w-2xl text-[13px] leading-6 text-white/70">Give Gogo an outcome. Safe work can run immediately; consequential actions stop for your approval. Background Gogo keeps watching when you leave.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(counts).map(([k,v])=><div key={k} className="min-w-[92px] rounded-[18px] border border-white/8 bg-white/8 px-4 py-3 text-center backdrop-blur"><div className="font-serif text-[27px] font-semibold leading-none">{v}</div><div className="mt-1.5 text-[8px] font-bold uppercase tracking-[.14em] text-white/45">{k}</div></div>)}</div>
      </div>
    </header>

    {error&&<div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[11px] text-red-700">{error}</div>}

    <section className="relative overflow-hidden rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/92 p-6 shadow-[0_18px_55px_rgba(62,35,18,.07)]">
      <div className="pointer-events-none absolute -right-14 -top-20 h-48 w-48 rounded-full bg-gogo-orange/8 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-3"><div><div className="text-[9px] font-bold uppercase tracking-[.18em] text-gogo-orange">Command Gogo</div><h2 className="mt-1 font-serif text-[28px] font-semibold text-gogo-ink">What outcome do you want?</h2></div>{activeThread&&<button onClick={()=>setActiveThread(null)} className="rounded-full border border-gogo-orange/15 bg-gogo-orange/8 px-3.5 py-2 text-[10px] font-semibold text-gogo-orange">Workspace: {activeThread.title} ×</button>}</div>
      <div className="relative mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_150px]"><textarea value={command} onChange={e=>setCommand(e.target.value)} placeholder="e.g. Compare the cheapest BLR → Mumbai flights next week" className="min-h-[96px] resize-none rounded-[20px] border border-gogo-ink/10 bg-gogo-cream/60 px-4 py-4 text-[13px] leading-6 text-gogo-ink outline-none transition focus:border-gogo-orange/45 focus:bg-gogo-surface"/><button onClick={run} disabled={!command.trim()||!!busy} className="rounded-[20px] bg-gogo-orange px-5 py-3 text-[12px] font-bold text-white shadow-[0_14px_28px_rgba(241,130,25,.22)] transition hover:bg-gogo-orange-deep disabled:opacity-40">{busy==='run'?'Working…':'Run with Gogo →'}</button></div>
      {result&&<div className="relative mt-4 whitespace-pre-wrap rounded-[20px] border border-gogo-ink/7 bg-gogo-cream/60 px-4 py-4 text-[11px] leading-5 text-gogo-ink-2">{result}</div>}
    </section>

    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Approvals" eyebrow="You stay in control" badge={String(snapshot?.approvals?.length||0)}>{!snapshot?.approvals?.length?<Empty text="Nothing is waiting for your approval."/>:snapshot.approvals.map((a:any)=><Card key={a.id}><div className="flex items-start justify-between gap-3"><div><b>{a.title}</b><p>{a.description}</p><span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-[8px] font-bold uppercase text-amber-700">{a.risk} risk</span></div></div><div className="mt-3 flex gap-2"><button onClick={()=>resolveApproval(a,'reject')} className="btn-secondary">Reject</button><button onClick={()=>resolveApproval(a,'approve')} className="btn-primary">Approve & run</button></div></Card>)}</Panel>
      <Panel title="Background Gogo" eyebrow="Keeps watching" badge={String(snapshot?.watchers?.length||0)}>{!snapshot?.watchers?.length?<Empty text="No active watches. Ask Gogo to watch a price, deadline or change."/>:snapshot.watchers.map((w:any)=><Card key={w.id}><b>{w.title}</b><p>{w.type.replaceAll('_',' ')} · every {w.cadenceMinutes} min</p><p>Next: {w.nextCheckAt?new Date(w.nextCheckAt).toLocaleString():'—'}</p><button onClick={()=>stopWatcher(w.id)} className="mt-3 btn-secondary">Stop</button></Card>)}</Panel>
      <Panel title="Goals" eyebrow="Longer outcomes" badge={String(snapshot?.goals?.length||0)}><div className="mb-3 flex gap-2"><input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="Outcome for Background Gogo" className="input flex-1"/><button onClick={createGoal} className="btn-primary">Create</button></div>{!snapshot?.goals?.length?<Empty text="No active goals. Create one for work that should keep moving."/>:snapshot.goals.map((g:any)=><Card key={g.id}><div className="flex justify-between gap-3"><b>{g.title}</b><span>{g.progress||0}%</span></div><div className="mt-2 h-1.5 rounded-full bg-gogo-ink/8"><div className="h-1.5 rounded-full bg-gogo-orange" style={{width:`${Math.max(2,g.progress||0)}%`}}/></div><p>{g.nextAction||g.outcome}</p>{g.blockers?.length>0&&<p className="text-red-600">Blocked: {g.blockers.join(', ')}</p>}</Card>)}</Panel>
      <Panel title="Ideas" eyebrow="Proactive suggestions" badge={String(snapshot?.ideas?.length||0)}>{!snapshot?.ideas?.length?<Empty text="No new proactive ideas right now."/>:snapshot.ideas.map((i:any)=><Card key={i.id}><b>{i.title}</b><p>{i.reason}</p><p className="text-gogo-orange">{i.expectedValue}</p></Card>)}</Panel>
    </div>

    <Panel title="Activity" eyebrow="What Gogo actually did" badge={String(snapshot?.runs?.length||0)}>{!snapshot?.runs?.length?<Empty text="No Agent runs yet. Give Gogo an outcome above."/>:<div className="space-y-2.5">{snapshot.runs.map((r:any)=><Card key={r.id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><b className="block truncate">{r.title}</b><p className="line-clamp-2">{r.summary}</p></div><span className="rounded-full bg-gogo-ink/6 px-2.5 py-1 text-[8px] font-bold uppercase tracking-[.06em]">{r.status} · {r.capability}</span></div>{r.steps?.length>0&&<div className="mt-3 grid gap-1.5 md:grid-cols-2 xl:grid-cols-3">{r.steps.map((s:any)=><div key={s.id} className="flex items-center gap-2 rounded-xl bg-gogo-cream/70 px-3 py-2 text-[9px]"><span className={`h-2 w-2 rounded-full ${s.status==='completed'?'bg-emerald-400':s.status==='failed'?'bg-red-400':s.status==='waiting_approval'?'bg-amber-400':'bg-gogo-orange'}`}/><span className="w-5 text-gogo-ink-4">{s.ordinal}</span><span className="min-w-0 flex-1 truncate font-medium">{s.title}</span></div>)}</div>}</Card>)}</div>}</Panel>

    <Panel title="Safe Mode / Sentinel" eyebrow="Permission boundaries" badge="permissions">
      <p className="mb-4 max-w-3xl text-[11px] leading-5 text-gogo-ink-3">Choose how far Gogo may go for each capability. “Ask” means Gogo must stop for approval. Consequential sends, bookings, purchases and external changes remain approval-gated.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{snapshot?.permissions?.map((p:any)=><div key={p.capability} className="rounded-[18px] border border-gogo-ink/7 bg-gogo-cream/42 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="text-[12px] text-gogo-ink">{p.label}</b><p className="mt-1 text-[9.5px] leading-4 text-gogo-ink-3">{p.description}</p></div><select value={p.level} onChange={e=>permission(p.capability,e.target.value)} disabled={busy===`permission:${p.capability}`} className="shrink-0 rounded-xl border border-gogo-ink/10 bg-gogo-surface px-2 py-1.5 text-[9px] font-semibold text-gogo-ink">{LEVELS.map(l=><option key={l} value={l}>{l}</option>)}</select></div>{p.irreversibleAlwaysAsk&&<div className="mt-3 flex items-center gap-1.5 text-[8px] font-semibold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-500"/>Consequential actions always ask</div>}</div>)}</div>
    </Panel>

    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Workspaces" eyebrow="Separate context, shared memory" badge={String(threads.length)}><div className="mb-3 flex gap-2"><input value={threadTitle} onChange={e=>setThreadTitle(e.target.value)} placeholder="e.g. CreditIQ Seed Raise" className="input flex-1"/><button onClick={createThread} className="btn-primary">Create</button></div><div className="grid gap-2 sm:grid-cols-2">{threads.length?threads.map((t:any)=><button key={t.id} onClick={()=>setActiveThread(t)} className={`rounded-[16px] border p-3 text-left transition ${activeThread?.id===t.id?'border-gogo-orange bg-gogo-orange/6':'border-gogo-ink/7 bg-gogo-cream/40 hover:border-gogo-orange/20'}`}><b className="text-[11px]">{t.title}</b><p className="mt-1 text-[9px] text-gogo-ink-3">Separate context · shared Memory</p></button>):<Empty text="No workspaces yet."/>}</div></Panel>
      <Panel title="Artifacts" eyebrow="Outputs Gogo created" badge={String(snapshot?.artifacts?.length||0)}>{!snapshot?.artifacts?.length?<Empty text="No artifacts created yet."/>:<div className="grid gap-2 sm:grid-cols-2">{snapshot.artifacts.map((a:any)=><button key={a.id} onClick={()=>openArtifact(a.id)} className="block w-full rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/40 p-3 text-left transition hover:border-gogo-orange/25"><b className="text-[11px]">{a.title}</b><p className="mt-1 text-[9px] text-gogo-ink-3">{a.subtitle||a.type}</p></button>)}</div>}{artifact&&<pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-gogo-ink p-4 text-[9px] leading-4 text-white/80">{JSON.stringify(artifact,null,2)}</pre>}</Panel>
    </div>

    <style jsx>{`
      :global(.btn-primary){border-radius:14px;background:#f18219;color:white;padding:10px 14px;font-size:10px;font-weight:800;box-shadow:0 8px 18px rgba(241,130,25,.16)}
      :global(.btn-secondary){border-radius:14px;border:1px solid rgba(58,36,24,.12);background:var(--color-gogo-surface);padding:10px 14px;font-size:10px;font-weight:800}
      :global(.input){min-height:42px;border-radius:14px;border:1px solid rgba(58,36,24,.1);background:var(--color-gogo-surface);padding:0 12px;font-size:11px;outline:none}
    `}</style>
  </div>
}

function Panel({title,eyebrow,badge,children}:{title:string;eyebrow?:string;badge:string;children:React.ReactNode}){return <section className="rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/92 p-5 shadow-[0_16px_48px_rgba(58,36,24,.055)]"><div className="mb-4 flex items-start justify-between gap-4"><div>{eyebrow&&<div className="text-[8px] font-bold uppercase tracking-[.17em] text-gogo-orange">{eyebrow}</div>}<h2 className="mt-1 font-serif text-[23px] font-semibold tracking-[-.3px] text-gogo-ink">{title}</h2></div><span className="rounded-full border border-gogo-orange/10 bg-gogo-orange/8 px-2.5 py-1 text-[8px] font-bold uppercase tracking-wider text-gogo-orange">{badge}</span></div>{children}</section>}
function Card({children}:{children:React.ReactNode}){return <div className="rounded-[17px] border border-gogo-ink/7 bg-gogo-cream/38 p-3.5 text-[10px] leading-4 text-gogo-ink-2 [&_b]:text-[11.5px] [&_b]:text-gogo-ink [&_p]:mt-1 [&_p]:text-[9.5px] [&_p]:text-gogo-ink-3">{children}</div>}
function Empty({text}:{text:string}){return <div className="rounded-[18px] border border-dashed border-gogo-ink/10 bg-gogo-cream/25 px-4 py-7 text-center text-[9.5px] text-gogo-ink-4">{text}</div>}
