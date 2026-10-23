'use client'

import {ServiceNoticeCards} from '@/components/dashboard/service-notice-cards'
import type {ServiceNotice} from '@/lib/dashboard/service-notices'
import type {PendingBrowserHandoff} from '@/lib/dashboard/human-handoffs'
import { findCatalogueSite } from '@/lib/dashboard/connection-catalogue'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ChannelPill, ChatChannels, type ChatChannel } from './chat-channels'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { GogoCharacter } from '@/components/gogo/gogo-character'
import { selectActiveRun, summarizeActiveRunState } from '@/lib/dashboard/run-state'
import { CHAT_STATE_LABEL, CHAT_STATE_SHORT, chatGogoState, type ChatGogoState } from '@/lib/dashboard/gogo-chat-state'
import { flightChoiceFromText } from '@/lib/agent/flight-choices'
import { CHAT_SUGGESTIONS, greetingFor, type ChatSuggestion } from '@/lib/dashboard/chat-suggestions'
import { splitChatText } from '@/lib/dashboard/chat-text'
import { MobileMenuButton } from '@/components/dashboard/mobile-nav'
import { RunStepsLine } from '@/components/dashboard/run-steps'
import { LOCATION_STORAGE_KEY, locationIsStale, locationTag, parseApproxLocation, parseLocationPreference, type LocationPreference } from '@/lib/dashboard/approx-location'

type ChatMessage={
  role:'user'|'assistant'
  content:string
  createdAt?:string
  mediaUrl?:string|null
  /** The task this reply started or reported on: its real steps show above the reply (Wajo-style). */
  runId?:string|null
}

type AgentSnapshot={
  serviceNotices?:ServiceNotice[]
  serviceNoticeCount?:number
  handoffs?:PendingBrowserHandoff[]
  unavailable?:boolean
  runs:any[]
  watchers:any[]
  approvals:any[]
}

function linkify(text:string){
  const parts=String(text||'').split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part,index)=>/^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="font-medium text-[#4cd0bd] underline underline-offset-2">{part}</a>
    : <span key={index}>{part}</span>)
}

// Gogo's own replies: real bold where WhatsApp-style *bold* was written, links still clickable.
function richText(text:string){
  return splitChatText(text).map((part,index)=>part.bold
    ? <strong key={index} className="font-semibold">{linkify(part.text)}</strong>
    : <span key={index}>{linkify(part.text)}</span>)
}

// Gogo's character sits on a cream disc so every pose reads on the dark page. The pose is the canonical
// GogoCharacter state (calm, listening, thinking, acting, watching, approval, done).
function Avatar({state='calm',size=40,showStatus=false}:{state?:ChatGogoState;size?:number;showStatus?:boolean}){
  return <div className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#efe6d7]" style={{width:size,height:size}}><GogoCharacter state={state} size={Math.round(size*.94)} showStatus={showStatus}/></div>
}

// A reply asking to connect a site ("…/dashboard/connect/amazon?ask=…") shows a Connect button, as in the approved mock.
function connectCard(text:string){
  const m=String(text||'').match(/https:\/\/app\.askgogo\.in(\/dashboard\/connect\/([a-z0-9]+)[^\s]*)/)
  if(!m)return null
  // Name from the link's site id, so every wording of the reply shows the right site (15 Oct: "Connect the site").
  const name=findCatalogueSite(m[2])?.name||String(text).match(/sign in to (.+?) for you/)?.[1]||'the site'
  return <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-[#1c1c1c] p-3">
    <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[10px] bg-[#2a2a2a] font-bold text-[#ecebe8]" aria-hidden="true">{name[0]?.toUpperCase()}</div>
    <div className="min-w-0 flex-1"><div className="truncate font-semibold text-[#ecebe8]">Connect {name}</div><div className="text-[13px] text-[#a8a8a4]">About 20 seconds</div></div>
    <a href={m[1]} className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-[#4cd0bd] px-4 text-[15px] font-bold text-[#0b0b0b]">Connect</a>
  </div>
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
    <div className="min-w-0 max-w-[90%] pt-1 text-[16px] leading-[1.65] text-[#dcdad5] sm:max-w-[84%] sm:text-[17px]">
      {message.runId&&<div className="mb-1"><RunStepsLine runId={message.runId}/></div>}
      <div className="whitespace-pre-wrap break-words">
        {richText(message.content)}
        {message.mediaUrl&&<img src={message.mediaUrl} alt="Gogo result" className="mt-3 max-h-72 rounded-xl border border-[#2a2a2a]"/>}
      </div>
      {connectCard(message.content)}
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

export type ChatBrief={title:string;summary:string;items:{text:string;tone:'amber'|'teal'|'muted';href:string}[]}

export function GogoChat({initialDrink='coffee',userName='',brief=null}:{initialDrink?:string;userName?:string;brief?:ChatBrief|null}){
  const searchParams=useSearchParams()
  const initialPrompt=searchParams.get('prompt')||''
  // Back from connecting a site: send the question that needed it, once.
  const askAfterConnect=searchParams.get('ask')||''
  const askedAfterConnect=useRef(false)
  const [messages,setMessages]=useState<ChatMessage[]>([])
  const [text,setText]=useState(initialPrompt)
  const [loading,setLoading]=useState(true)
  const [sending,setSending]=useState(false)
  const [sentAt,setSentAt]=useState("")
  const [error,setError]=useState('')
  const [historyOpen,setHistoryOpen]=useState(false)
  const [justReplied,setJustReplied]=useState(false)
  const repliedTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const [snapshot,setSnapshot]=useState<AgentSnapshot>({runs:[],watchers:[],approvals:[]})
  const endRef=useRef<HTMLDivElement|null>(null)
  const messageScrollRef=useRef<HTMLDivElement|null>(null)
  const sendingRef=useRef(false)
  const conversationVersion=useRef(0)
  const [dictating,setDictating]=useState(false)
  const [canDictate,setCanDictate]=useState(false)
  const inputRef=useRef<HTMLTextAreaElement|null>(null)
  const recognitionRef=useRef<any>(null)
  // Location is the person's choice. It lives in this browser only and goes out with a message, never on its own.
  const [loc,setLoc]=useState<LocationPreference>({status:'off'})
  const [locBusy,setLocBusy]=useState(false)
  const [locNote,setLocNote]=useState('')
  // Duet parity step 4: one ongoing thread ('') plus optional channels. Memory, tasks and approvals stay shared.
  const [channels,setChannels]=useState<ChatChannel[]>([])
  const [channel,setChannel]=useState('')
  const channelRef=useRef('')
  const refreshRef=useRef<((initial?:boolean)=>Promise<void>)|null>(null)
  useEffect(()=>{
    fetch('/api/agent/threads',{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json():null)
      .then(d=>{if(Array.isArray(d?.threads)){
        const list=d.threads.map((t:any)=>({id:String(t.id),title:String(t.title||'Channel')}))
        setChannels(list)
        // A channel picked in the side rail (?channel=<id>) opens here.
        const wanted=searchParams.get('channel')||''
        if(wanted&&list.some((c:ChatChannel)=>c.id===wanted))pickChannel(wanted)
      }}).catch(()=>{})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  function pickChannel(id:string){
    if(id===channelRef.current||sendingRef.current)return
    channelRef.current=id;setChannel(id)
    conversationVersion.current++
    setMessages([]);setLoading(true);setHistoryOpen(false);setError('')
    void refreshRef.current?.(true)
  }
  async function createChannel(title:string){
    try{
      const res=await fetch('/api/agent/threads',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({title})})
      const d=await res.json().catch(()=>null)
      if(!res.ok||!d?.thread?.id)return false
      setChannels(cs=>[{id:String(d.thread.id),title:String(d.thread.title)},...cs])
      pickChannel(String(d.thread.id))
      return true
    }catch{return false}
  }

  function saveLoc(next:LocationPreference){
    setLoc(next)
    try{window.localStorage.setItem(LOCATION_STORAGE_KEY,JSON.stringify(next))}catch{}
  }
  function readPosition(quiet:boolean):Promise<LocationPreference|null>{
    return new Promise(resolve=>{
      if(typeof navigator==='undefined'||!navigator.geolocation){if(!quiet)setLocNote('This browser cannot share a location.');resolve(null);return}
      navigator.geolocation.getCurrentPosition(async pos=>{
        const point=parseApproxLocation({lat:pos.coords.latitude,lon:pos.coords.longitude})
        if(!point){resolve(null);return}
        let label:string|undefined
        try{
          const res=await fetch('/api/dashboard/location',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(point),signal:AbortSignal.timeout(8000)})
          const data=await res.json().catch(()=>({}))
          if(typeof data?.label==='string'&&data.label)label=data.label
        }catch{}
        resolve({status:'on',...point,label,at:Date.now()})
      },err=>{
        if(!quiet)setLocNote(err?.code===1?'Location is blocked for this site. Allow it in your browser settings, then try again.':'Could not get your location. Try again in a moment.')
        resolve(null)
      },{enableHighAccuracy:true,timeout:15000,maximumAge:2*60*1000})
    })
  }
  async function enableLocation(){
    if(locBusy)return
    setLocBusy(true);setLocNote('')
    const next=await readPosition(false)
    if(next)saveLoc(next)
    setLocBusy(false)
  }
  function disableLocation(){setLocNote('');saveLoc({status:'off'})}
  useEffect(()=>{
    let stored:string|null=null
    try{stored=window.localStorage.getItem(LOCATION_STORAGE_KEY)}catch{}
    const pref=parseLocationPreference(stored)
    setLoc(pref)
    // Already allowed and the saved position is old: refresh it quietly (no prompt appears if permission was given).
    if(locationIsStale(pref,Date.now()))void readPosition(true).then(next=>{if(next)saveLoc(next)})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  async function loadSnapshot(){
    try{
      const res=await fetch('/api/agent/snapshot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(12000)})
      if(!res.ok)throw new Error('snapshot_unavailable')
      const data=await res.json()
      setSnapshot({
        serviceNotices:Array.isArray(data.serviceNotices)?data.serviceNotices:[],
        serviceNoticeCount:Number(data.serviceNoticeCount??data.serviceNotices?.length??0),
        unavailable:false,
        runs:Array.isArray(data.runs)?data.runs:[],
        watchers:Array.isArray(data.watchers)?data.watchers:[],
        approvals:Array.isArray(data.approvals)?data.approvals:[],
        handoffs:Array.isArray(data.handoffs)?data.handoffs:[],
      })
    }catch{setSnapshot(current=>({...current,unavailable:true}))}
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
            if(!live||sendingRef.current||version!==conversationVersion.current)return
            if(!agent){setSnapshot(current=>({...current,unavailable:true}));return}
            setSnapshot({serviceNotices:Array.isArray(agent.serviceNotices)?agent.serviceNotices:[],serviceNoticeCount:Number(agent.serviceNoticeCount??agent.serviceNotices?.length??0),unavailable:false,runs:Array.isArray(agent.runs)?agent.runs:[],watchers:Array.isArray(agent.watchers)?agent.watchers:[],approvals:Array.isArray(agent.approvals)?agent.approvals:[],handoffs:Array.isArray(agent.handoffs)?agent.handoffs:[]})
          }).catch(()=>{if(live)setSnapshot(current=>({...current,unavailable:true}))})
        const response=await fetch(channelRef.current?`/api/dashboard/chat?thread=${encodeURIComponent(channelRef.current)}`:'/api/dashboard/chat',{cache:'no-store',signal:AbortSignal.timeout(12000)})
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
    refreshRef.current=refresh
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
  // Match Today, navigation and Needs you: several stops on one site are one thing to do.
  const handoffGroups=[...(snapshot.handoffs||[]).reduce((groups,handoff)=>{
    const key=String(handoff.title||handoff.id),group=groups.get(key)
    if(group)group.count+=1+(handoff.repeats||0)
    else groups.set(key,{first:handoff,count:1+(handoff.repeats||0)})
    return groups
  },new Map<string,{first:PendingBrowserHandoff;count:number}>()).values()]
  const waitingCount=snapshot.approvals.length+handoffGroups.length+(snapshot.serviceNoticeCount??snapshot.serviceNotices?.length??0)
  // "Working" must mean Gogo is actively executing. A paused/blocked/approval run is
  // waiting on the user and must not read as working (blocked Blinkit run showed
  // "Working" despite a dead-end reply).
  const runState=summarizeActiveRunState(snapshot.runs)
  const runStateDot=runState.tone==='working'?'bg-[#4cd0bd]':runState.tone==='waiting'?'bg-[#e2b04a]':'bg-[#8a8a86]'
  const gogoState=chatGogoState({sending,typing:text.trim().length>0||dictating,runTone:runState.tone,justReplied,watchers:snapshot.watchers.length})
  // Gogo's own flight questions come back with tap answers, the same ones WhatsApp shows as buttons.
  const lastMessage=visible[visible.length-1]
  const lastChoice=!sending&&!historyOpen&&lastMessage?.role==='assistant'?flightChoiceFromText(lastMessage.content)?.choice:null
  const lastChips:Chip[]=lastChoice?lastChoice.options:[]

  useEffect(()=>{
    if(loading||!askAfterConnect||askedAfterConnect.current)return
    askedAfterConnect.current=true
    try{window.history.replaceState(null,'','/dashboard/chat')}catch{}
    void submit(askAfterConnect)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[loading,askAfterConnect])

  // Stop (approved 22 Oct mock): stops waiting for this reply. Work Gogo already started on the server is not undone,
  // so the line says where to find it instead of claiming nothing happened.
  const stopRef=useRef<AbortController|null>(null)
  function stopWaiting(){stopRef.current?.abort()}

  async function submit(value?:string){
    const next=String(value??text).trim()
    if(!next||sendingRef.current)return
    sendingRef.current=true
    conversationVersion.current++
    setText('');setError('');setSending(true);setSentAt(new Date().toISOString());setHistoryOpen(false)
    setMessages(m=>[...m,{role:'user',content:next}])
    const controller=typeof AbortController==='function'?new AbortController():null;stopRef.current=controller
    try{
      const res=await fetch('/api/dashboard/chat',{
        method:'POST',...(controller?{signal:controller.signal}:{}),
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...(loc.status==='on'?{text:next,location:{lat:loc.lat,lon:loc.lon}}:{text:next}),...(channelRef.current?{threadId:channelRef.current}:{})}),
      })
      const data=await res.json().catch(()=>({}))
      if(!res.ok)throw new Error(data?.message||'chat')
      setLoading(false)
      setMessages(m=>[...m,{role:'assistant',content:String(data.text||'Done.'),mediaUrl:data.mediaUrl||null,runId:typeof data.runId==='string'?data.runId:null}])
      // A short "done" pose after each answer, then back to whatever Gogo is really doing.
      setJustReplied(true)
      if(repliedTimer.current)clearTimeout(repliedTimer.current)
      repliedTimer.current=setTimeout(()=>setJustReplied(false),4000)
      void loadSnapshot()
    }catch(e:any){
      if(e?.name==='AbortError'){
        setMessages(m=>[...m,{role:'assistant',content:'Stopped waiting. If Gogo had already started something, it shows in Tasks.'}])
        void loadSnapshot()
        return
      }
      setError(e?.message&&e.message!=='chat'?e.message:'Gogo had trouble with that. Try once more.')
    }finally{
      sendingRef.current=false
      setSending(false)
    }
  }

  function pickSuggestion(item:ChatSuggestion){
    if(item.send){void submit(item.prompt);return}
    // Needs details from the person: fill the box and put the cursor at the end.
    setText(item.prompt)
    setTimeout(()=>{const el=inputRef.current;if(!el)return;el.focus();el.setSelectionRange(item.prompt.length,item.prompt.length)},0)
  }

  // Voice dictation uses the browser's own speech recognition, so it appears only where the browser has it.
  useEffect(()=>{
    if(typeof window==='undefined')return
    const w=window as any
    setCanDictate(Boolean(w.SpeechRecognition||w.webkitSpeechRecognition))
    return()=>{try{recognitionRef.current?.stop()}catch{}}
  },[])

  function toggleDictation(){
    const w=window as any
    const Recognition=w.SpeechRecognition||w.webkitSpeechRecognition
    if(!Recognition)return
    if(dictating){try{recognitionRef.current?.stop()}catch{};return}
    const rec=new Recognition()
    rec.lang=navigator.language||'en-IN'
    rec.interimResults=false
    rec.continuous=false
    rec.onresult=(event:any)=>{
      const heard=Array.from(event.results||[]).map((r:any)=>r?.[0]?.transcript||'').join(' ').trim()
      if(heard)setText(current=>current?`${current.replace(/\s+$/,'')} ${heard}`:heard)
    }
    rec.onend=()=>setDictating(false)
    rec.onerror=()=>setDictating(false)
    recognitionRef.current=rec
    try{rec.start();setDictating(true)}catch{setDictating(false)}
  }

  function onSubmit(e:FormEvent){
    e.preventDefault()
    void submit()
  }

  return <div className="grid w-full overflow-hidden bg-[#0b0b0b] max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:h-[100dvh] max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)] lg:min-h-[520px] lg:border lg:border-[#1f1f1f] lg:h-[calc(100dvh-4.25rem)] lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
    {/* Phone (approved 22 Oct full-screen mock, Wajo-style): no header bar — menu, channel pill and Needs you float
          over the conversation, which scrolls underneath. */}
      <div className="absolute inset-x-0 top-[env(safe-area-inset-top)] z-20 flex items-center justify-between gap-2 bg-[#0b0b0b] px-2 pb-1.5 pt-1.5 lg:hidden">
        <MobileMenuButton/>
        <ChannelPill channels={channels} active={channel} onPick={pickChannel} onCreate={createChannel} disabled={sending}/>
        <Link href="/dashboard/tasks" aria-label={snapshot.unavailable?'Needs you':`Needs you: ${waitingCount}`} className="flex h-10 items-center gap-1.5 rounded-full border border-[#262626] bg-[#151515] pl-3 pr-1 text-[13px] font-semibold text-[#f2efea]">
          Needs you <span className="grid h-8 min-w-8 place-items-center rounded-full bg-[#3a2a10] px-1 text-[13px] font-bold text-[#f0c26b]">{snapshot.unavailable?'—':waitingCount}</span>
        </Link>
      </div>
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="hidden shrink-0 border-b border-[#1f1f1f] px-1 py-2 sm:px-6 lg:block lg:px-10 lg:py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <MobileMenuButton/>
            <div className="lg:hidden"><Avatar state={gogoState} size={36} showStatus/></div>
            <div className="min-w-0">
              <h1 className="truncate text-[22px] font-bold leading-tight tracking-[-.02em] text-[#f2efea] lg:text-[34px]">Gogo<span className="ml-2 text-[14px] font-normal tracking-normal text-[#b4b4b0] lg:hidden">{CHAT_STATE_SHORT[gogoState]}</span></h1>
              <p className="mt-0.5 hidden text-[16px] text-[#b4b4b0] lg:block">One conversation, across here and WhatsApp.</p>
            </div>
          </div>
          {archived.length>0&&<button type="button" onClick={()=>setHistoryOpen(v=>!v)} className="min-h-10 shrink-0 rounded-full border border-[#2f2f2f] px-4 text-[14px] text-[#d8d8d3] hover:text-[#f2efea] lg:min-h-11 lg:px-5 lg:text-[16px]">{historyOpen?'Current':'History'}</button>}
        </div>
        <div className="mt-2 lg:mt-3"><ChatChannels channels={channels} active={channel} onPick={pickChannel} onCreate={createChannel} disabled={sending} startAdding={searchParams.get('newChannel')==='1'}/></div>
      </header>

      <div ref={messageScrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-16 sm:px-6 lg:px-10 lg:py-6">
        {brief&&!channel&&!historyOpen&&<ChatBriefCard brief={brief}/>}
        {loading&&<div className="py-16 text-center text-[16px] text-[#a8a8a4]">Bringing your conversation in…</div>}
        {!loading&&visible.length===0&&<div className="mx-auto max-w-[980px] py-8 text-center lg:py-14">
          <div className="mx-auto w-fit"><Avatar state={gogoState} size={104}/></div>
          <h2 className="mt-5 text-[28px] font-bold leading-tight text-[#f2efea] lg:text-[34px]" suppressHydrationWarning>{greetingFor(new Date().getHours())}{userName?`, ${userName}`:''}.</h2>
          <p className="mx-auto mt-2 max-w-xl text-[16px] leading-relaxed text-[#b4b4b0]">Ask here or on WhatsApp. The same context, tasks, approvals and background work carry across both.</p>
          {loc.status==='ask'&&<div className="mx-auto mt-6 max-w-xl rounded-[18px] border border-[#2a2a2a] bg-[#151515] p-4 text-left">
            <div className="text-[17px] font-bold text-[#f2efea]">Get more useful local help</div>
            <p className="mt-1 text-[15px] leading-[1.5] text-[#c4c4c0]">Weather for where you are now, and more local help soon. Your approximate area (about 1 km) stays in this browser and goes out only with a message. You can turn it off any time.</p>
            <div className="mt-3 flex gap-3">
              <button type="button" onClick={()=>saveLoc({status:'off'})} className="min-h-11 flex-1 rounded-xl border border-[#2f2f2f] text-[15px] text-[#d8d8d3] hover:text-[#f2efea]">Not now</button>
              <button type="button" onClick={()=>void enableLocation()} disabled={locBusy} className="min-h-11 flex-1 rounded-xl bg-[#efe6d7] text-[15px] font-bold text-[#0b0b0b] disabled:opacity-60">{locBusy?'Checking…':'Enable location'}</button>
            </div>
            {locNote&&<p className="mt-2 text-[14px] text-[#e2b04a]">{locNote}</p>}
          </div>}
          <div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-2 xl:grid-cols-3">
            {CHAT_SUGGESTIONS.map(item=><button key={item.id} type="button" onClick={()=>pickSuggestion(item)} className="min-h-[76px] rounded-[18px] border border-[#242424] bg-[#141414] px-5 py-4 transition hover:border-[#4cd0bd] hover:bg-[#101f1d]">
              <div className="text-[17px] font-semibold text-[#f2efea]">{item.title}</div>
              <div className="mt-0.5 text-[15px] text-[#a8a8a4]">{item.hint}</div>
            </button>)}
          </div>
          {loc.status!=='ask'&&<div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 text-[15px] text-[#a8a8a4] lg:hidden">
            <span>{loc.status==='on'?`Location on · ${locationTag(loc)}`:'Location is off'}</span>
            <button type="button" onClick={loc.status==='on'?disableLocation:()=>void enableLocation()} disabled={locBusy} className="min-h-11 text-[#8be6d8] underline underline-offset-4 disabled:opacity-60">{loc.status==='on'?'Turn off':locBusy?'Checking…':'Turn on'}</button>
            {locNote&&<span className="w-full text-center text-[14px] text-[#e2b04a]">{locNote}</span>}
          </div>}
        </div>}
        <div className="mx-auto flex max-w-[980px] flex-col gap-6">
          {visible.map((message,index)=><Message key={`${index}-${message.createdAt||''}`} message={message} chips={index===visible.length-1?lastChips:undefined} onPick={v=>void submit(v)}/>)}
          {/* While the reply is pending, the live line follows the task Gogo just started (real steps only). */}
          {sending&&<RunStepsLine since={sentAt} fallback="Gogo is working"/>}
          <div ref={endRef}/>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 shrink-0 bg-[#0b0b0b] px-3 pb-1 pt-1 sm:px-6 lg:border-t lg:border-[#1f1f1f] lg:px-10 lg:pb-5 lg:pt-3">
        <div className="mx-auto max-w-[980px]">
          {error&&<div className="mb-3 rounded-[12px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-[15px] text-red-300">{error}</div>}
          {loc.status==='ask'&&visible.length>0&&<div className="mb-3 rounded-[16px] border border-[#2a2a2a] bg-[#151515] p-3.5">
            <div className="text-[16px] font-bold text-[#f2efea]">Get more useful local help</div>
            <p className="mt-0.5 text-[14px] leading-[1.45] text-[#c4c4c0]">Weather for where you are. Your approximate area stays in this browser and goes out only with a message.</p>
            <div className="mt-2.5 flex gap-3">
              <button type="button" onClick={()=>saveLoc({status:'off'})} className="min-h-11 flex-1 rounded-xl border border-[#2f2f2f] text-[15px] text-[#d8d8d3]">Not now</button>
              <button type="button" onClick={()=>void enableLocation()} disabled={locBusy} className="min-h-11 flex-1 rounded-xl bg-[#efe6d7] text-[15px] font-bold text-[#0b0b0b] disabled:opacity-60">{locBusy?'Checking…':'Enable location'}</button>
            </div>
            {locNote&&<p className="mt-2 text-[14px] text-[#e2b04a]">{locNote}</p>}
          </div>}
          {(loading||visible.length>0)&&<div className="mb-3 hidden gap-2.5 overflow-x-auto pb-1 lg:flex">
            {CHAT_SUGGESTIONS.map(item=><button key={item.id} type="button" onClick={()=>pickSuggestion(item)} className="min-h-11 shrink-0 rounded-full border border-[#2f2f2f] px-5 text-[15px] text-[#d8d8d3] hover:border-[#4cd0bd] hover:text-[#f2efea] lg:text-[16px]">{item.title}</button>)}
            {loc.status!=='ask'&&<button type="button" onClick={loc.status==='on'?disableLocation:()=>void enableLocation()} disabled={locBusy} className="min-h-11 shrink-0 rounded-full border border-dashed border-[#2f2f2f] px-5 text-[15px] text-[#a8a8a4] hover:text-[#f2efea] disabled:opacity-60 lg:text-[16px]">{loc.status==='on'?`Location on${loc.label?` · ${loc.label}`:''} · turn off`:locBusy?'Checking…':'Use my location'}</button>}
          </div>}
          <form onSubmit={onSubmit} className="flex items-end gap-3 rounded-[28px] border border-[#2f2f2f] bg-[#131313] py-2 pl-5 pr-2 focus-within:border-[#4cd0bd]">
            <textarea ref={inputRef} value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit()}}} rows={1} maxLength={2000} placeholder="Message Gogo" className="max-h-32 min-h-12 flex-1 resize-none bg-transparent py-3 text-[17px] leading-6 text-[#f2efea] outline-none placeholder:text-[#a8a8a4] lg:text-[18px]"/>
            {canDictate&&<button type="button" onClick={toggleDictation} aria-pressed={dictating} aria-label={dictating?'Stop dictation':'Dictate a message'} className={`grid h-12 w-12 shrink-0 place-items-center rounded-full border ${dictating?'border-[#4cd0bd] bg-[#123d38] text-[#8be6d8]':'border-[#2f2f2f] text-[#d8d8d3]'}`}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
            </button>}
            {sending
              ?<button type="button" onClick={stopWaiting} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#efe6d7] text-[#0b0b0b]" aria-label="Stop"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg></button>
              :<button disabled={!text.trim()} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#efe6d7] text-[22px] font-bold text-[#0b0b0b] disabled:opacity-30" aria-label="Send">↑</button>}
          </form>
          <p className="pb-1 pt-1.5 text-center text-[12px] text-[#8a8a86] lg:hidden">Gogo can make mistakes. It asks before it acts for you.</p>
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
        <div className="flex items-center justify-between text-[13px] font-bold uppercase tracking-[.1em] text-[#a8a8a4]"><span>Needs you</span><Link href="/dashboard/agent?section=approvals" className="text-[#e2b04a]">{snapshot.unavailable?'—':waitingCount}</Link></div>
        <div className="mt-2">
          <ServiceNoticeCards notices={snapshot.serviceNotices||[]} unavailable={snapshot.unavailable}/>
          {snapshot.approvals.slice(0,3).map(a=><RailRow key={a.id} tone="amber" title={a.title||'Approval needed'} meta={a.description||'Gogo is waiting for your decision.'} href="/dashboard/agent?section=approvals"/>)}
          {handoffGroups.slice(0,3).map(({first,count})=><RailRow key={first.id} tone="amber" title={first.title||'Browser task'} meta={count>1?`Stopped here ${count} times. Latest: ${first.summary}`:first.summary} href={count>1?'/dashboard/agent?section=approvals':`/dashboard/activity/${encodeURIComponent(first.id)}/browser`}/>)}
          {!waitingCount&&!snapshot.unavailable&&<div className="py-3 text-[15px] text-[#a8a8a4]">Nothing is waiting.</div>}
        </div>
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between text-[13px] font-bold uppercase tracking-[.1em] text-[#a8a8a4]"><span>In the background</span><Link href="/dashboard/agent?section=background" className="text-[15px] font-medium normal-case tracking-normal text-[#4cd0bd]">All</Link></div>
        <div className="mt-2">
          {snapshot.watchers.length?snapshot.watchers.slice(0,4).map(w=><RailRow key={w.id} tone="teal" title={w.title||'Background watch'} meta={`${String(w.type||'watch').replaceAll('_',' ')} · every ${w.cadenceMinutes||60} min`} href="/dashboard/agent?section=background"/>):<div className="py-3 text-[15px] text-[#a8a8a4]">No active background watches.</div>}
        </div>
      </section>

      <section className="mt-6">
        <div className="text-[13px] font-bold uppercase tracking-[.1em] text-[#a8a8a4]">Location</div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[15px] text-[#c4c4c0]">
          <span className="min-w-0 truncate">{loc.status==='on'?locationTag(loc):'Off'}</span>
          {loc.status==='on'
            ?<button type="button" onClick={disableLocation} className="min-h-10 shrink-0 rounded-full border border-[#2f2f2f] px-4 text-[14px] text-[#d8d8d3] hover:text-[#f2efea]">Turn off</button>
            :<button type="button" onClick={()=>void enableLocation()} disabled={locBusy} className="min-h-10 shrink-0 rounded-full border border-[#2f2f2f] px-4 text-[14px] text-[#d8d8d3] hover:text-[#f2efea] disabled:opacity-60">{locBusy?'Checking…':'Turn on'}</button>}
        </div>
        {locNote&&<p className="mt-2 text-[14px] text-[#e2b04a]">{locNote}</p>}
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

/** The morning brief at the top of the one thread (approved 22 Oct Duet-parity mock, screen 1). */
function ChatBriefCard({brief}:{brief:ChatBrief}){
  const dot={amber:'bg-[#ef7a27]',teal:'bg-[#2fb8a6]',muted:'bg-[#8a8a86]'}
  return <section aria-label={brief.title} className="mx-auto mb-5 flex max-w-[980px] flex-col gap-2.5 rounded-[18px] border border-[#242424] bg-[#141414] p-4">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] font-semibold uppercase tracking-[.04em] text-[#ef7a27]">{brief.title}</span>
      {brief.items.length>0&&<span className="text-[12px] text-[#a8a8a4]">{brief.items.length} thing{brief.items.length===1?'':'s'}</span>}
    </div>
    <p className="text-[15px] leading-[1.45] text-[#f2efea]">{brief.summary}</p>
    {brief.items.length>0&&<ul className="flex flex-col gap-2">
      {brief.items.map((it,i)=><li key={i}><Link href={it.href} className="flex items-start gap-2.5 text-[14px] leading-[1.4] text-[#e0e0dc] hover:text-[#f2efea]">
        <span className={`mt-[6px] h-2 w-2 shrink-0 rounded-full ${dot[it.tone]}`} aria-hidden="true"/><span className="min-w-0">{it.text}</span>
      </Link></li>)}
    </ul>}
  </section>
}
