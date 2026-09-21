'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { GogoCharacter } from '@/components/gogo/gogo-character'

type ChatMessage={
  role:'user'|'assistant'
  content:string
  createdAt?:string
  mediaUrl?:string|null
}

type AgentSnapshot={
  runs:any[]
  watchers:any[]
  approvals:any[]
}

const QUICK=[
  'What do I have today?',
  'Find a saved document',
  'Show my reminders',
  'Plan my day',
]

function linkify(text:string){
  const parts=String(text||'').split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part,index)=>/^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="font-medium text-[#2fb8a6] underline underline-offset-2">{part}</a>
    : <span key={index}>{part}</span>)
}

function Avatar(){
  return <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#efe6d7]"><GogoCharacter state="calm" size={30} showStatus={false}/></div>
}

function Message({message}:{message:ChatMessage}){
  if(message.role==='user'){
    return <div className="flex justify-end">
      <div className="max-w-[78%] rounded-[16px] bg-[#1c1c1c] px-4 py-3 text-[14px] leading-6 text-[#f2efea]">
        {linkify(message.content)}
        {message.mediaUrl&&<img src={message.mediaUrl} alt="Gogo result" className="mt-3 max-h-72 rounded-xl border border-[#2a2a2a]"/>}
      </div>
    </div>
  }
  return <div className="flex items-start gap-3">
    <Avatar/>
    <div className="max-w-[78%] pt-1 text-[14px] leading-6 text-[#f2efea]">
      {linkify(message.content)}
      {message.mediaUrl&&<img src={message.mediaUrl} alt="Gogo result" className="mt-3 max-h-72 rounded-xl border border-[#2a2a2a]"/>}
    </div>
  </div>
}

function RailRow({title,meta,tone='muted',href}:{title:string;meta:string;tone?:'muted'|'teal'|'amber'|'green';href?:string}){
  const dot=tone==='teal'?'bg-[#2fb8a6]':tone==='amber'?'bg-[#d9a441]':tone==='green'?'bg-[#7fb069]':'bg-[#6a6a6a]'
  const body=<div className="flex items-start gap-3 border-t border-[#1f1f1f] py-3 first:border-t-0">
    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`}/>
    <div className="min-w-0 flex-1">
      <div className="truncate text-[12px] font-medium text-[#f2efea]">{title}</div>
      <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-[#6a6a6a]">{meta}</div>
    </div>
  </div>
  return href?<Link href={href} className="block hover:bg-[#111]">{body}</Link>:body
}

export function GogoChat({initialDrink='coffee'}:{initialDrink?:string}){
  const searchParams=useSearchParams()
  const initialPrompt=searchParams.get('prompt')||''
  const [messages,setMessages]=useState<ChatMessage[]>([])
  const [text,setText]=useState(initialPrompt)
  const [loading,setLoading]=useState(true)
  const [sending,setSending]=useState(false)
  const [error,setError]=useState('')
  const [historyOpen,setHistoryOpen]=useState(false)
  const [snapshot,setSnapshot]=useState<AgentSnapshot>({runs:[],watchers:[],approvals:[]})
  const endRef=useRef<HTMLDivElement|null>(null)

  async function loadSnapshot(){
    try{
      const res=await fetch('/api/agent/snapshot',{cache:'no-store',credentials:'same-origin'})
      if(!res.ok)return
      const data=await res.json()
      setSnapshot({
        runs:Array.isArray(data.runs)?data.runs:[],
        watchers:Array.isArray(data.watchers)?data.watchers:[],
        approvals:Array.isArray(data.approvals)?data.approvals:[],
      })
    }catch{}
  }

  useEffect(()=>{
    let live=true
    Promise.all([
      fetch('/api/dashboard/chat',{cache:'no-store'}).then(async res=>{
        if(!res.ok)throw new Error('history')
        return res.json()
      }),
      fetch('/api/agent/snapshot',{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json():null).catch(()=>null),
    ]).then(([chat,agent])=>{
      if(!live)return
      setMessages(Array.isArray(chat.messages)?chat.messages:[])
      if(agent)setSnapshot({
        runs:Array.isArray(agent.runs)?agent.runs:[],
        watchers:Array.isArray(agent.watchers)?agent.watchers:[],
        approvals:Array.isArray(agent.approvals)?agent.approvals:[],
      })
    }).catch(()=>live&&setError('I could not load the recent conversation. You can still start a new message.'))
      .finally(()=>live&&setLoading(false))
    return()=>{live=false}
  },[])

  useEffect(()=>{
    if(!historyOpen)endRef.current?.scrollIntoView({behavior:'smooth',block:'end'})
  },[messages,sending,historyOpen])

  const archived=useMemo(()=>messages.slice(0,Math.max(0,messages.length-12)),[messages])
  const visible=historyOpen?messages:messages.slice(-12)
  const activeRun=snapshot.runs.find(r=>['running','queued','paused','waiting_approval'].includes(r.status))||null

  async function submit(value?:string){
    const next=String(value??text).trim()
    if(!next||sending)return
    setText('');setError('');setSending(true);setHistoryOpen(false)
    setMessages(m=>[...m,{role:'user',content:next}])
    try{
      const res=await fetch('/api/dashboard/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text:next}),
      })
      const data=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(data?.message||'chat')
      setMessages(m=>[...m,{role:'assistant',content:String(data.text||'Done.'),mediaUrl:data.mediaUrl||null}])
      void loadSnapshot()
    }catch(e:any){
      setError(e?.message&&e.message!=='chat'?e.message:'Gogo had trouble with that. Try once more.')
    }finally{
      setSending(false)
    }
  }

  function onSubmit(e:FormEvent){
    e.preventDefault()
    void submit()
  }

  return <div className="mx-auto grid h-[calc(100dvh-7rem)] min-h-[650px] w-full max-w-[1320px] overflow-hidden border border-[#1f1f1f] bg-[#0b0b0b] lg:grid-cols-[minmax(0,1fr)_320px]">
    <section className="flex min-h-0 min-w-0 flex-col">
      <header className="shrink-0 border-b border-[#1f1f1f] px-6 py-5 lg:px-8">
        <div className="flex items-start justify-between gap-5">
          <div>
            <h1 className="text-[32px] font-medium tracking-[-.03em] text-[#f2efea]">Gogo</h1>
            <p className="mt-1 text-[12px] text-[#9a9a9a]">One conversation, across here and WhatsApp.</p>
          </div>
          {archived.length>0&&<button type="button" onClick={()=>setHistoryOpen(v=>!v)} className="rounded-full border border-[#2a2a2a] px-3 py-1.5 text-[10px] text-[#9a9a9a] hover:text-[#f2efea]">{historyOpen?'Current':'History'}</button>}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 lg:px-8">
        {loading&&<div className="py-16 text-center text-[12px] text-[#6a6a6a]">Bringing your conversation in…</div>}
        {!loading&&visible.length===0&&<div className="py-20 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#efe6d7] text-[16px] font-semibold text-[#0b0b0b]">G</div>
          <h2 className="mt-4 text-[22px] font-medium text-[#f2efea]">What should we work on?</h2>
          <p className="mx-auto mt-2 max-w-lg text-[12px] leading-5 text-[#6a6a6a]">Ask Gogo here or on WhatsApp. The same context, tasks, approvals and background work carry across both.</p>
        </div>}
        <div className="mx-auto flex max-w-[850px] flex-col gap-5">
          {visible.map((message,index)=><Message key={`${index}-${message.createdAt||''}`} message={message}/>)}
          {sending&&<div className="flex items-start gap-3"><Avatar/><div className="pt-1 text-[13px] text-[#9a9a9a]">Gogo is working<span className="animate-pulse">…</span></div></div>}
          <div ref={endRef}/>
        </div>
      </div>

      <div className="shrink-0 border-t border-[#1f1f1f] px-6 py-4 lg:px-8">
        <div className="mx-auto max-w-[850px]">
          {error&&<div className="mb-2 rounded-[10px] border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">{error}</div>}
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {QUICK.map(q=><button key={q} type="button" onClick={()=>void submit(q)} className="shrink-0 rounded-full border border-[#2a2a2a] px-3 py-1.5 text-[10px] text-[#9a9a9a] hover:border-[#3a3a3a] hover:text-[#f2efea]">{q}</button>)}
          </div>
          <form onSubmit={onSubmit} className="flex items-end gap-2 border border-[#2a2a2a] bg-[#111] p-2">
            <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit()}}} rows={1} maxLength={2000} placeholder="Message Gogo…" className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] leading-6 text-[#f2efea] outline-none placeholder:text-[#6a6a6a]"/>
            <button disabled={sending||!text.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-[#efe6d7] text-[17px] font-semibold text-[#0b0b0b] disabled:opacity-30" aria-label="Send">↑</button>
          </form>
        </div>
      </div>
    </section>

    <aside className="hidden border-l border-[#1f1f1f] bg-[#0f0f0f] p-5 lg:block">
      <div className="flex items-center gap-3 border-b border-[#1f1f1f] pb-4">
        <Avatar/>
        <div>
          <div className="text-[13px] font-medium text-[#f2efea]">Gogo</div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#9a9a9a]"><span className={`h-2 w-2 rounded-full ${activeRun?'bg-[#2fb8a6]':'bg-[#6a6a6a]'}`}/>{activeRun?'Working':'Ready'}</div>
        </div>
      </div>

      <div className="py-4 text-[11px] leading-5 text-[#9a9a9a]">{activeRun?.summary||'Gogo is ready. Nothing consequential happens without your approval.'}</div>

      <section className="mt-2">
        <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[.12em] text-[#6a6a6a]"><span>Needs you</span><span className="text-[#d9a441]">{snapshot.approvals.length}</span></div>
        <div className="mt-2">
          {snapshot.approvals.length?snapshot.approvals.slice(0,3).map(a=><RailRow key={a.id} tone="amber" title={a.title||'Approval needed'} meta={a.description||'Gogo is waiting for your decision.'} href="/dashboard/agent?section=approvals"/>):<div className="py-3 text-[10px] text-[#6a6a6a]">Nothing is waiting.</div>}
        </div>
      </section>

      <section className="mt-5">
        <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-[.12em] text-[#6a6a6a]"><span>In the background</span><Link href="/dashboard/agent?section=background" className="normal-case tracking-normal text-[#9a9a9a]">All</Link></div>
        <div className="mt-2">
          {snapshot.watchers.length?snapshot.watchers.slice(0,4).map(w=><RailRow key={w.id} tone="teal" title={w.title||'Background watch'} meta={`${String(w.type||'watch').replaceAll('_',' ')} · every ${w.cadenceMinutes||60} min`} href="/dashboard/agent?section=background"/>):<div className="py-3 text-[10px] text-[#6a6a6a]">No active background watches.</div>}
        </div>
      </section>

      <section className="mt-5">
        <div className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#6a6a6a]">In this conversation</div>
        <div className="mt-2">
          {snapshot.runs.slice(0,4).map(r=><RailRow key={r.id} tone={r.status==='completed'?'green':r.status==='waiting_approval'?'amber':'muted'} title={r.title||'Gogo task'} meta={r.summary||r.status} href={`/dashboard/activity/${r.id}`}/>)}
          {!snapshot.runs.length&&<div className="py-3 text-[10px] text-[#6a6a6a]">No task activity yet.</div>}
        </div>
      </section>
    </aside>
  </div>
}
