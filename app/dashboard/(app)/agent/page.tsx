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

  if(loading&&!snapshot)return <div className="mx-auto max-w-6xl py-16 text-sm text-gogo-ink-3">Opening Gogo Agent…</div>

  return <div className="mx-auto w-full max-w-6xl space-y-7">
    <header className="rounded-[30px] bg-gogo-ink px-6 py-7 text-white shadow-[0_20px_55px_rgba(58,36,24,.16)] lg:px-8">
      <div className="text-[9px] font-bold uppercase tracking-[.22em] text-gogo-orange">Gogo Agent · Live backend</div>
      <div className="mt-2 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div><h1 className="font-serif text-3xl font-semibold lg:text-4xl">Plan. Act. Watch.</h1><p className="mt-2 max-w-2xl text-[12px] leading-5 text-white/65">This is the same Agent OS used by WhatsApp. Runs, approvals, Background Gogo, goals, Ideas and artifacts update here automatically.</p></div>
        <div className="grid grid-cols-4 gap-2 text-center">{Object.entries(counts).map(([k,v])=><div key={k} className="min-w-[66px] rounded-2xl bg-white/8 px-3 py-2"><div className="text-lg font-semibold">{v}</div><div className="text-[7px] uppercase tracking-wider text-white/45">{k}</div></div>)}</div>
      </div>
    </header>

    {error&&<div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[11px] text-red-700">{error}</div>}

    <section className="rounded-[26px] border border-gogo-ink/8 bg-white/75 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[9px] font-bold uppercase tracking-[.16em] text-gogo-orange">Command Gogo</div><h2 className="mt-1 font-serif text-2xl">Run an outcome</h2></div>{activeThread&&<button onClick={()=>setActiveThread(null)} className="rounded-full bg-gogo-orange/10 px-3 py-1.5 text-[9px] font-semibold text-gogo-orange">Workspace: {activeThread.title} ×</button>}</div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row"><textarea value={command} onChange={e=>setCommand(e.target.value)} placeholder="e.g. Find my Dubai flight and add it to my calendar" className="min-h-20 flex-1 resize-none rounded-2xl border border-gogo-ink/10 bg-gogo-cream/60 px-4 py-3 text-[12px] outline-none focus:border-gogo-orange/40"/><button onClick={run} disabled={!command.trim()||!!busy} className="rounded-2xl bg-gogo-orange px-5 py-3 text-[11px] font-bold text-white disabled:opacity-40">{busy==='run'?'Working…':'Run with Gogo'}</button></div>
      {result&&<div className="mt-3 whitespace-pre-wrap rounded-2xl bg-gogo-cream px-4 py-3 text-[11px] leading-5 text-gogo-ink-2">{result}</div>}
    </section>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Approvals" badge={String(snapshot?.approvals?.length||0)}>{!snapshot?.approvals?.length?<Empty text="No actions waiting for approval."/>:snapshot.approvals.map((a:any)=><Card key={a.id}><div className="flex items-start justify-between gap-3"><div><b>{a.title}</b><p>{a.description}</p><span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-[8px] font-bold uppercase text-amber-700">{a.risk} risk</span></div></div><div className="mt-3 flex gap-2"><button onClick={()=>resolveApproval(a,'reject')} className="btn-secondary">Reject</button><button onClick={()=>resolveApproval(a,'approve')} className="btn-primary">Approve & run</button></div></Card>)}</Panel>
      <Panel title="Background Gogo" badge={String(snapshot?.watchers?.length||0)}>{!snapshot?.watchers?.length?<Empty text="No active watches."/>:snapshot.watchers.map((w:any)=><Card key={w.id}><b>{w.title}</b><p>{w.type.replaceAll('_',' ')} · every {w.cadenceMinutes} min</p><p>Next: {w.nextCheckAt?new Date(w.nextCheckAt).toLocaleString():'—'}</p><button onClick={()=>stopWatcher(w.id)} className="mt-3 btn-secondary">Stop</button></Card>)}</Panel>
      <Panel title="Goals" badge={String(snapshot?.goals?.length||0)}><div className="mb-3 flex gap-2"><input value={goal} onChange={e=>setGoal(e.target.value)} placeholder="Outcome for Background Gogo" className="input flex-1"/><button onClick={createGoal} className="btn-primary">Create</button></div>{!snapshot?.goals?.length?<Empty text="No active goals."/>:snapshot.goals.map((g:any)=><Card key={g.id}><div className="flex justify-between gap-3"><b>{g.title}</b><span>{g.progress||0}%</span></div><div className="mt-2 h-1.5 rounded-full bg-gogo-ink/8"><div className="h-1.5 rounded-full bg-gogo-orange" style={{width:`${Math.max(2,g.progress||0)}%`}}/></div><p>{g.nextAction||g.outcome}</p>{g.blockers?.length>0&&<p className="text-red-600">Blocked: {g.blockers.join(', ')}</p>}</Card>)}</Panel>
      <Panel title="Ideas" badge={String(snapshot?.ideas?.length||0)}>{!snapshot?.ideas?.length?<Empty text="Gogo has no new proactive Ideas right now."/>:snapshot.ideas.map((i:any)=><Card key={i.id}><b>{i.title}</b><p>{i.reason}</p><p className="text-gogo-orange">{i.expectedValue}</p></Card>)}</Panel>
    </div>

    <Panel title="Activity & visible steps" badge={String(snapshot?.runs?.length||0)}>{!snapshot?.runs?.length?<Empty text="No Agent runs yet. Send a Muse-style command on WhatsApp or above."/>:snapshot.runs.map((r:any)=><Card key={r.id}><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{r.title}</b><p>{r.summary}</p></div><span className="rounded-full bg-gogo-ink/6 px-2 py-1 text-[8px] font-bold uppercase">{r.status} · {r.capability}</span></div>{r.steps?.length>0&&<div className="mt-3 space-y-1.5">{r.steps.map((s:any)=><div key={s.id} className="flex items-center gap-2 rounded-xl bg-gogo-cream/70 px-3 py-2 text-[9px]"><span className={`h-2 w-2 rounded-full ${s.status==='completed'?'bg-emerald-400':s.status==='failed'?'bg-red-400':s.status==='waiting_approval'?'bg-amber-400':'bg-gogo-orange'}`}/><span className="w-5 text-gogo-ink-4">{s.ordinal}</span><span className="flex-1 font-medium">{s.title}</span><span className="text-gogo-ink-4">{s.toolName}</span></div>)}</div>}</Card>)}</Panel>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Safe Mode / Sentinel" badge="permissions">{snapshot?.permissions?.map((p:any)=><div key={p.capability} className="mb-2 rounded-2xl border border-gogo-ink/7 bg-white/70 p-3"><div className="flex items-start justify-between gap-3"><div><b className="text-[11px]">{p.label}</b><p className="mt-1 text-[9px] leading-4 text-gogo-ink-3">{p.description}</p></div><select value={p.level} onChange={e=>permission(p.capability,e.target.value)} disabled={busy===`permission:${p.capability}`} className="rounded-xl border border-gogo-ink/10 bg-gogo-cream px-2 py-1.5 text-[9px]">{LEVELS.map(l=><option key={l} value={l}>{l}</option>)}</select></div>{p.irreversibleAlwaysAsk&&<div className="mt-2 text-[8px] font-semibold text-amber-700">Consequential actions always ask.</div>}</div>)}</Panel>
      <Panel title="Artifacts" badge={String(snapshot?.artifacts?.length||0)}>{!snapshot?.artifacts?.length?<Empty text="No artifacts created yet."/>:snapshot.artifacts.map((a:any)=><button key={a.id} onClick={()=>openArtifact(a.id)} className="mb-2 block w-full rounded-2xl border border-gogo-ink/7 bg-white/70 p-3 text-left hover:border-gogo-orange/30"><b className="text-[11px]">{a.title}</b><p className="mt-1 text-[9px] text-gogo-ink-3">{a.subtitle||a.type}</p></button>)}{artifact&&<pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl bg-gogo-ink p-4 text-[9px] leading-4 text-white/80">{JSON.stringify(artifact,null,2)}</pre>}</Panel>
    </div>

    <Panel title="Workspaces" badge={String(threads.length)}><div className="mb-3 flex gap-2"><input value={threadTitle} onChange={e=>setThreadTitle(e.target.value)} placeholder="e.g. CreditIQ Seed Raise" className="input flex-1"/><button onClick={createThread} className="btn-primary">Create</button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{threads.map((t:any)=><button key={t.id} onClick={()=>setActiveThread(t)} className={`rounded-2xl border p-3 text-left ${activeThread?.id===t.id?'border-gogo-orange bg-gogo-orange/5':'border-gogo-ink/7 bg-white/70'}`}><b className="text-[11px]">{t.title}</b><p className="mt-1 text-[9px] text-gogo-ink-3">Separate context · shared Memory</p></button>)}</div></Panel>

    <style jsx>{`
      :global(.btn-primary){border-radius:14px;background:#f47b20;color:white;padding:9px 13px;font-size:9px;font-weight:800}
      :global(.btn-secondary){border-radius:14px;border:1px solid rgba(58,36,24,.12);background:white;padding:9px 13px;font-size:9px;font-weight:800}
      :global(.input){min-height:40px;border-radius:14px;border:1px solid rgba(58,36,24,.1);background:rgba(255,255,255,.8);padding:0 12px;font-size:10px;outline:none}
    `}</style>
  </div>
}

function Panel({title,badge,children}:{title:string;badge:string;children:React.ReactNode}){return <section className="rounded-[26px] border border-gogo-ink/8 bg-gogo-surface/80 p-5 shadow-[0_10px_35px_rgba(58,36,24,.04)]"><div className="mb-4 flex items-center justify-between"><h2 className="font-serif text-xl font-semibold">{title}</h2><span className="rounded-full bg-gogo-orange/9 px-2.5 py-1 text-[8px] font-bold uppercase tracking-wider text-gogo-orange">{badge}</span></div>{children}</section>}
function Card({children}:{children:React.ReactNode}){return <div className="mb-2 rounded-2xl border border-gogo-ink/7 bg-white/70 p-3 text-[10px] leading-4 text-gogo-ink-2 [&_b]:text-[11px] [&_b]:text-gogo-ink [&_p]:mt-1 [&_p]:text-[9px] [&_p]:text-gogo-ink-3">{children}</div>}
function Empty({text}:{text:string}){return <div className="rounded-2xl border border-dashed border-gogo-ink/10 px-4 py-6 text-center text-[9px] text-gogo-ink-4">{text}</div>}
