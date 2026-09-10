'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DashboardTask } from '@/lib/dashboard/tasks'

async function request(path:string, init:RequestInit){
  const res=await fetch(path,{...init,headers:{'Content-Type':'application/json',Accept:'application/json',...(init.headers||{})},credentials:'same-origin'})
  const body=await res.json().catch(()=>({}))
  if(!res.ok) throw new Error(String(body?.error||`request_failed_${res.status}`))
  return body
}

function dateLabel(iso:string|null,tz:string){
  if(!iso)return 'Saved in AskGogo'
  const d=new Date(iso)
  if(Number.isNaN(d.getTime()))return 'Saved in AskGogo'
  return new Intl.DateTimeFormat('en-GB',{timeZone:tz,day:'numeric',month:'short',year:'numeric'}).format(d)
}

export function TaskManager({open,completed,tz}:{open:DashboardTask[];completed:DashboardTask[];tz:string}){
  const router=useRouter()
  const [text,setText]=useState('')
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')

  async function add(){
    const value=text.trim();if(!value||busy)return
    setBusy('add');setError('')
    try{
      await request('/api/dashboard/tasks',{method:'POST',body:JSON.stringify({text:value})})
      setText('');router.refresh()
    }catch(e:any){setError(e?.message||'Could not add task.')}
    finally{setBusy('')}
  }

  async function setDone(id:string,done:boolean){
    if(busy)return
    setBusy(id);setError('')
    try{
      await request('/api/dashboard/tasks',{method:'PATCH',body:JSON.stringify({id,done})})
      router.refresh()
    }catch(e:any){setError(e?.message||'Could not update task.')}
    finally{setBusy('')}
  }

  return <>
    <section className="mt-5 rounded-[24px] border border-gogo-ink/8 bg-gogo-surface/82 p-4 shadow-[0_14px_36px_rgba(62,35,18,.045)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')add()}} placeholder="Add a task…" className="min-h-12 flex-1 rounded-[16px] border border-gogo-ink/10 bg-gogo-cream/45 px-4 text-[13px] text-gogo-ink outline-none focus:border-gogo-orange/40 focus:bg-gogo-surface" />
        <button type="button" onClick={add} disabled={!text.trim()||!!busy} className="rounded-[16px] bg-gogo-orange px-5 py-3 text-[12px] font-bold text-white shadow-[0_10px_22px_rgba(241,130,25,.18)] disabled:opacity-40">{busy==='add'?'Adding…':'Add task'}</button>
      </div>
      {error&&<p className="mt-2 text-[11px] text-red-600">{error}</p>}
    </section>

    <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <TaskBoard title="Open" subtitle="Things you still want to get done" tasks={open} tone="bg-gogo-orange-tint text-gogo-orange-deep" tz={tz} busy={busy} onDone={setDone}/>
      <TaskBoard title="Completed" subtitle="Recently cleared" tasks={completed} tone="bg-emerald-50 text-emerald-700" tz={tz} busy={busy} onDone={setDone} completed/>
    </div>
  </>
}

function TaskBoard({title,subtitle,tasks,tone,tz,busy,onDone,completed=false}:{title:string;subtitle:string;tasks:DashboardTask[];tone:string;tz:string;busy:string;onDone:(id:string,done:boolean)=>void;completed?:boolean}){
  return <section className="min-h-[430px] rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/82 p-5 shadow-[0_20px_55px_rgba(62,35,18,.05)] backdrop-blur-xl">
    <div className="flex items-start justify-between gap-4"><div><h2 className="font-serif text-[25px] font-semibold tracking-[-.4px] text-gogo-ink">{title}</h2><p className="mt-1 text-[12px] text-gogo-ink-3">{subtitle}</p></div><span className={`grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-bold ${tone}`}>{tasks.length}</span></div>
    <div className="mt-5 space-y-3">
      {tasks.length?tasks.slice(0,20).map(task=><article key={task.id} className="rounded-[18px] border border-gogo-ink/8 bg-gogo-cream/48 px-4 py-3.5 transition hover:-translate-y-0.5 hover:bg-gogo-surface"><div className="flex items-start gap-3"><button type="button" onClick={()=>onDone(task.id,!completed)} disabled={!!busy} aria-label={completed?'Move task back to open':'Mark task complete'} className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] transition ${completed?'border-emerald-500 bg-emerald-50 text-emerald-700':'border-gogo-orange text-gogo-orange hover:bg-gogo-orange hover:text-white'}`}>{busy===task.id?'…':completed?'↶':'✓'}</button><div className="min-w-0 flex-1"><div className={`text-[14px] font-semibold leading-5 ${completed?'text-gogo-ink-3 line-through':'text-gogo-ink'}`}>{task.label}</div><div className="mt-1 text-[11px] text-gogo-ink-3">{completed?`Completed ${dateLabel(task.doneAt||task.createdAt,tz)}`:`Added ${dateLabel(task.createdAt,tz)}`}</div></div></div></article>):<div className="grid min-h-[280px] place-items-center rounded-[20px] border border-dashed border-gogo-ink/10 bg-gogo-cream/25 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gogo-surface text-gogo-orange">✓</div><div className="mt-3 font-serif text-[18px] font-semibold text-gogo-ink">{completed?'Nothing completed yet':'All clear'}</div><div className="mt-1 max-w-[260px] text-[12px] leading-5 text-gogo-ink-3">{completed?'Completed tasks will collect here quietly.':'No open tasks are waiting for you.'}</div></div></div>}
    </div>
  </section>
}
