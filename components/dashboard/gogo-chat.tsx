'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { GogoCharacter } from '@/components/gogo/gogo-character'
import { selectActiveRun, summarizeActiveRunState } from '@/lib/dashboard/run-state'
import { CHAT_STATE_LABEL, chatGogoState, type ChatGogoState } from '@/lib/dashboard/gogo-chat-state'
import { flightChoiceFromText } from '@/lib/agent/flight-choices'

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
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="font-medium text-[#4cd0bd] underline underline-offset-2">{part}</a>
    : <span key={index}>{part}</span>)
}

// Gogo's character sits on a cream disc so every pose reads on the dark page. The pose is the canonical
// GogoCharacter state (calm, listening, thinking, acting, watching, approval, done).
function Avatar({state='calm',size=40,showStatus=false}:{state?:ChatGogoState;size?:number;showStatus?:boolean}){
  return <div className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#efe6d7]" style={{width:size,height:size}}><GogoCharacter state={state} size={Math.round(size*.94)} showStatus={showStatus}/></div>
}

type Chip={title:string;description?:string}

function Message({message,chips,onPick}:{message:ChatMessage;chips?:Chip[];onPick?:(title:string)=>void}){
  if(message.role==='user'){
    return <div className="flex justify-end">
      <div className="max-w-[86%] whitespace-pre-wrap break-words rounded-[20px] bg-[#1c1c1c] px-5 py-3.5 text-[16px] leading-[1.65] text-[#f2efea] sm:max-w-[72%] sm:text-[17px]">
        {linkify(message.content)}
        {message.mediaUrl&&<img src={message.mediaUrl} alt="Gogo result" className="mt-3 max-h-72 rounded-xl border border-[#2a2a2a]"/>}
      </div>
    </div>
  }
  return <div className="flex items-start gap-3 sm:gap-3.5">
    <Avatar size={40}/>
    <div className="min-w-0 max-w-[90%] pt-1 text-[16px] leading-[1.65] text-[#f2efea] sm:max-w-[84%] sm:text-[17px]">
      <div className="whitespace-pre-wrap break-words">
        {linkify(message.content)}
        {message.mediaUrl&&<img src={message.mediaUrl} alt="Gogo result" className="mt-3 max-h-72 rounded-xl border border-[#2a2a2a]"/>}
      </div>
      {chips&&chips.length>0&&onPick&&<div className="mt-4 flex flex-wrap gap-2.5" role="group" aria-label="Quick answers">
        {chips.map(c=><button key={c.title} type="button" onClick={()=>onPick(c.title)} className="min-h-12 rounded-full border border-[#2f2f2f] bg-[#161616] px-5 text-left text-[16px] font-semibold text-[#f2efea] transition hover:border-[#4cd0bd] hover:bg-[#123d38] hover:text-[#8be6d8] sm:text-[17px]">
          {c.title}{c.description&&<span className="ml-2 text-[14px] font-normal text-[#a8a8a4]">{c.description}</span>}
        </button>)}
      </div>}
    </div>
  </div>
}

function RailRow({title,meta,tone='muted',href}:{title:string;meta:string;tone?:'muted'|'teal'|'amber'|'green';href?:string}){
  const dot=tone==='teal'?'bg-[#4cd0bd]':tone==='amber'?'bg-[#e2b04a]':tone==='green'?'bg-[#7fb069]':'bg-[#8a8a86]'
  const body=<div className="flex items-start gap-3 border-t border-[#1f1f1f] py-3 first:border-t-0">
    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${dot}`}/>
    <div className="min-w-0 flex-1">
      <div className="line-clamp-2 text-[16px] font-semibold leading-snug text-[#f2efea]">{title}</div>
      <div className="mt-1 line-clamp-2 text-[14px] leading-[1.45] text-[#a8a8a4]">{meta}</div>
    </div>
  </div>
  return href?<Link href={href} className="block rounded-lg hover:bg-[#151515]">{body}</Link>:body
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
  const [justReplied,setJustReplied]=useState(false)
  const repliedTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const [snapshot,setSnapshot]=useState<AgentSnapshot>({runs:[],watchers:[],approvals:[]})
  const endRef=useRef<HTMLDivElement|null>(null)
  const messageScrollRef=useRef<HTMLDivElement|null>(null)
  const sendingRef=useRef(false)
  const conversationVersion=useRef(0)

  async function loadSnapshot(){
    try{
      const res=await fetch('/api/agent/snapshot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)})
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
    let refreshing=false
    async function refresh(initial=false){
      if(refreshing||sendingRef.current||(!initial&&document.hidden))return
      refreshing=true
      const version=conversationVersion.current
      try{
        // A slow activity rail must not hold conversation history hostage.
        void fetch('/api/agent/snapshot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)})
          .then(r=>r.ok?r.json():null).then(agent=>{
            if(!agent||!live||sendingRef.current||version!==conversationVersion.current)return
            setSnapshot({runs:Array.isArray(agent.runs)?agent.runs:[],watchers:Array.isArray(agent.watchers)?agent.watchers:[],approvals:Array.isArray(agent.approvals)?agent.approvals:[]})
          }).catch(()=>{})
        const response=await fetch('/api/dashboard/chat',{cache:'no-store',signal:AbortSignal.timeout(12000)})
        if(!response.ok)throw new Error('history')
        const chat=await response.json()
        // A response started before a new send must not overwrite its optimistic
        // message or its reply. Poll only persisted, owner-scoped conversation.
        if(!live||sendingRef.current||version!==conversationVersion.current)return
        const next=Array.isArray(chat.messages)?chat.messages:[]
        setMessages(current=>JSON.stringify(current)===JSON.stringify(next)?current:next)
      }catch{if(initial&&live)setError('I could not load the recent conversation. You can still start a new message.')}
      finally{refreshing=false;if(live)setLoading(false)}
    }
    void refresh(true)
    const onVisible=()=>{void refresh()}
    const timer=setInterval(onVisible,15000)
    document.addEventListener('visibilitychange',onVisible)
    return()=>{live=false;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);if(repliedTimer.current)clearTimeout(repliedTimer.current)}
  },[])

  useEffect(()=>{
    if(historyOpen)return
    const el=messageScrollRef.current
    if(!el)return
    requestAnimationFrame(()=>{ el.scrollTop=el.scrollHeight })
  },[messages,sending,historyOpen])

  const archived=useMemo(()=>messages.slice(0,Math.max(0,messages.length-12)),[messages])
  const visible=historyOpen?messages:messages.slice(-12)
  const activeRun=selectActiveRun(snapshot.runs)
  // "Working" must mean Gogo is actively executing. A paused/blocked/approval run is
  // waiting on the user and must not read as working (blocked Blinkit run showed
  // "Working" despite a dead-end reply).
  const runState=summarizeActiveRunState(snapshot.runs)
  const runStateDot=runState.tone==='working'?'bg-[#4cd0bd]':runState.tone==='waiting'?'bg-[#e2b04a]':'bg-[#8a8a86]'
  const gogoState=chatGogoState({sending,typing:text.trim().length>0,runTone:runState.tone,justReplied,watchers:snapshot.watchers.length})
  // Gogo's own flight questions come back with tap answers, the same ones WhatsApp shows as buttons.
  const lastMessage=visible[visible.length-1]
  const lastChoice=!sending&&!historyOpen&&lastMessage?.role==='assistant'?flightChoiceFromText(lastMessage.content)?.choice:null
  const lastChips:Chip[]=lastChoice?lastChoice.options:[]

  async function submit(value?:string){
    const next=String(value??text).trim()
    if(!next||sendingRef.current)return
    sendingRef.current=true
    conversationVersion.current++
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
      setLoading(false)
      setMessages(m=>[...m,{role:'assistant',content:String(data.text||'Done.'),mediaUrl:data.mediaUrl||null}])
      // A short "done" pose after each answer, then back to whatever Gogo is really doing.
      setJustReplied(true)
      if(repliedTimer.current)clearTimeout(repliedTimer.current)
      repliedTimer.current=setTimeout(()=>setJustReplied(false),4000)
      void loadSnapshot()
    }catch(e:any){
      setError(e?.message&&e.message!=='chat'?e.message:'Gogo had trouble with that. Try once more.')
    }finally{
      sendingRef.current=false
      setSending(false)
    }
  }

  function onSubmit(e:FormEvent){
    e.preventDefault()
    void submit()
  }

  return <div className="grid h-[calc(100dvh-6rem)] min-h-[520px] w-full overflow-hidden border border-[#1f1f1f] bg-[#0b0b0b] lg:h-[calc(100dvh-4.25rem)] lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-[#1f1f1f] px-4 py-4 sm:px-6 lg:px-10 lg:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="lg:hidden"><Avatar state={gogoState} size={48} showStatus/></div>
            <div className="min-w-0">
              <h1 className="text-[28px] font-bold leading-tight tracking-[-.02em] text-[#f2efea] lg:text-[34px]">Gogo</h1>
              <p className="mt-0.5 text-[15px] text-[#b4b4b0] lg:text-[16px]"><span className="lg:hidden">{CHAT_STATE_LABEL[gogoState]} · </span>One conversation, across here and WhatsApp.</p>
            </div>
          </div>
          {archived.length>0&&<button type="button" onClick={()=>setHistoryOpen(v=>!v)} className="min-h-11 shrink-0 rounded-full border border-[#2f2f2f] px-5 text-[15px] text-[#d8d8d3] hover:text-[#f2efea] lg:text-[16px]">{historyOpen?'Current':'History'}</button>}
        </div>
      </header>

      <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6 lg:px-10">
        {loading&&<div className="py-16 text-center text-[16px] text-[#a8a8a4]">Bringing your conversation in…</div>}
        {!loading&&visible.length===0&&<div className="py-16 text-center">
          <div className="mx-auto w-fit"><Avatar state={gogoState==='calm'?'calm':gogoState} size={104}/></div>
          <h2 className="mt-5 text-[26px] font-bold text-[#f2efea]">What should we work on?</h2>
          <p className="mx-auto mt-2 max-w-xl text-[16px] leading-relaxed text-[#b4b4b0]">Ask Gogo here or on WhatsApp. The same context, tasks, approvals and background work carry across both.</p>
        </div>}
        <div className="mx-auto flex max-w-[980px] flex-col gap-6">
          {visible.map((message,index)=><Message key={`${index}-${message.createdAt||''}`} message={message} chips={index===visible.length-1?lastChips:undefined} onPick={v=>void submit(v)}/>)}
          {sending&&<div className="flex items-start gap-3.5"><Avatar state="thinking" size={40} showStatus/><div className="pt-1.5 text-[16px] text-[#b4b4b0] sm:text-[17px]">Gogo is working<span className="animate-pulse">…</span></div></div>}
          <div ref={endRef}/>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 border-t border-[#1f1f1f] bg-[#0b0b0b] px-4 pb-4 pt-3 sm:px-6 lg:px-10 lg:pb-5">
        <div className="mx-auto max-w-[980px]">
          {error&&<div className="mb-3 rounded-[12px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-[15px] text-red-300">{error}</div>}
          <div className="mb-3 flex gap-2.5 overflow-x-auto pb-1">
            {QUICK.map(q=><button key={q} type="button" onClick={()=>void submit(q)} className="min-h-11 shrink-0 rounded-full border border-[#2f2f2f] px-5 text-[15px] text-[#d8d8d3] hover:border-[#4cd0bd] hover:text-[#f2efea] lg:text-[16px]">{q}</button>)}
          </div>
          <form onSubmit={onSubmit} className="flex items-end gap-3 rounded-[28px] border border-[#2f2f2f] bg-[#131313] py-2 pl-5 pr-2 focus-within:border-[#4cd0bd]">
            <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit()}}} rows={1} maxLength={2000} placeholder="Message Gogo" className="max-h-32 min-h-12 flex-1 resize-none bg-transparent py-3 text-[17px] leading-6 text-[#f2efea] outline-none placeholder:text-[#a8a8a4] lg:text-[18px]"/>
            <button disabled={sending||!text.trim()} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#efe6d7] text-[22px] font-bold text-[#0b0b0b] disabled:opacity-30" aria-label="Send">↑</button>
          </form>
        </div>
      </div>
    </section>

    <aside className="hidden h-full overflow-y-auto border-l border-[#1f1f1f] bg-[#0f0f0f] p-6 lg:block">
      <div className="flex items-center gap-4 border-b border-[#1f1f1f] pb-5">
        <Avatar state={gogoState} size={88} showStatus/>
        <div className="min-w-0">
          <div className="text-[20px] font-bold text-[#f2efea]">Gogo</div>
          <div className="mt-1 flex items-center gap-2 text-[16px] text-[#c4c4c0]"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${runStateDot}`}/>{CHAT_STATE_LABEL[gogoState]}</div>
        </div>
      </div>

      <div className="py-5 text-[16px] leading-[1.55] text-[#b4b4b0]">{activeRun?.summary||'Gogo is ready. Nothing consequential happens without your approval.'}</div>

      <section className="mt-1">
        <div className="flex items-center justify-between text-[13px] font-bold uppercase tracking-[.1em] text-[#a8a8a4]"><span>Needs you</span><span className="text-[#e2b04a]">{snapshot.approvals.length}</span></div>
        <div className="mt-2">
          {snapshot.approvals.length?snapshot.approvals.slice(0,3).map(a=><RailRow key={a.id} tone="amber" title={a.title||'Approval needed'} meta={a.description||'Gogo is waiting for your decision.'} href="/dashboard/agent?section=approvals"/>):<div className="py-3 text-[15px] text-[#a8a8a4]">Nothing is waiting.</div>}
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between text-[13px] font-bold uppercase tracking-[.1em] text-[#a8a8a4]"><span>In the background</span><Link href="/dashboard/agent?section=background" className="text-[15px] font-medium normal-case tracking-normal text-[#4cd0bd]">All</Link></div>
        <div className="mt-2">
          {snapshot.watchers.length?snapshot.watchers.slice(0,4).map(w=><RailRow key={w.id} tone="teal" title={w.title||'Background watch'} meta={`${String(w.type||'watch').replaceAll('_',' ')} · every ${w.cadenceMinutes||60} min`} href="/dashboard/agent?section=background"/>):<div className="py-3 text-[15px] text-[#a8a8a4]">No active background watches.</div>}
        </div>
      </section>

      <section className="mt-6">
        <div className="text-[13px] font-bold uppercase tracking-[.1em] text-[#a8a8a4]">In this conversation</div>
        <div className="mt-2">
          {snapshot.runs.slice(0,4).map(r=><RailRow key={r.id} tone={r.status==='completed'?'green':r.status==='waiting_approval'?'amber':'muted'} title={r.title||'Gogo task'} meta={r.summary||r.status} href={`/dashboard/activity/${r.id}`}/>)}
          {!snapshot.runs.length&&<div className="py-3 text-[15px] text-[#a8a8a4]">No task activity yet.</div>}
        </div>
      </section>
    </aside>
  </div>
}
