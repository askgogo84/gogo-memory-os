import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders, getLists } from '@/lib/dashboard/queries'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { CommandBar } from '@/components/dashboard/command-bar'
import { GogoCharacter } from '@/components/gogo/gogo-character'
import { getPendingBrowserHandoffs } from '@/lib/dashboard/human-handoffs'
import { reminderStateLabel } from '@/lib/dashboard/reminder-state'
import { retiredRunReason } from '@/lib/agent/task-lifecycle'
import { staleRunningCutoff, isStaleRunning } from '@/lib/agent/stale-runs'
import { readableRunSummary } from '@/lib/dashboard/readable-summary'

export const dynamic='force-dynamic'

function dayLabel(now:Date,tz:string){
  return new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:tz}).format(now)
}
function greeting(now:Date,tz:string){
  const h=Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:tz}).format(now))
  return h<12?'Good morning':h<17?'Good afternoon':'Good evening'
}
function clock(iso:string,tz:string){
  return new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:tz}).format(new Date(iso))
}
function Dot({tone}:{tone:'teal'|'amber'|'muted'|'green'}){
  const cls=tone==='teal'?'bg-[#2fb8a6]':tone==='amber'?'bg-[#d9a441]':tone==='green'?'bg-[#7fb069]':'bg-[#6a6a6a]'
  return <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${cls}`}/>
}
function Row({tone,title,meta,right,href}:{tone:'teal'|'amber'|'muted'|'green';title:string;meta:string;right?:string;href?:string}){
  const body=<div className="flex items-start gap-3 border-t border-[#1f1f1f] py-3.5 first:border-t-0">
    <Dot tone={tone}/>
    <div className="min-w-0 flex-1"><div className="truncate text-[16px] font-medium text-[#f2efea]">{title}</div><div className="mt-1 text-[14px] leading-5 text-[#a8a8a4]">{meta}</div></div>
    {right&&<div className="shrink-0 text-[13px] text-[#9a9a9a]">{right}</div>}
  </div>
  return href?<Link href={href} className="block hover:bg-[#141414]">{body}</Link>:body
}

function updateState(status:string){
  if(status==='completed')return {label:'Finished',tone:'text-[#83c3b8] bg-[#12302c]'}
  if(status==='failed')return {label:'Could not finish',tone:'text-[#e4b6a6] bg-[#35221d]'}
  return {label:'Paused',tone:'text-[#e4c17b] bg-[#322a1b]'}
}

export default async function HomePage(){
  const session=await getSession()
  const tg=session?.telegramId||''
  const tgNum=parseInt(tg,10)
  const [{data:user},today,lists,memory,approvals,watchers,runs,workingCountRes,handoffs,recentUpdatesResult]=await Promise.all([
    Number.isFinite(tgNum)?supabaseAdmin.from('users').select('name,timezone').eq('telegram_id',tgNum).maybeSingle():Promise.resolve({data:null as any}),
    session?getTodayReminders(tg):Promise.resolve({ok:true as const,reminders:[]}),
    session?getLists(tg):Promise.resolve({ok:true as const,lists:[]}),
    session?getDashboardMemory(tg):Promise.resolve({ok:true as const,items:[]}),
    session?supabaseAdmin.from('agent_approvals').select('id,run_id,title,description,risk_level,created_at').eq('telegram_id',tg).eq('status','pending').order('created_at',{ascending:false}).limit(4):Promise.resolve({data:[] as any[]}),
    session?supabaseAdmin.from('agent_watchers').select('id,title,type,next_check_at,active',{count:'exact'}).eq('telegram_id',tg).eq('active',true).neq('type','goal_review').order('next_check_at',{ascending:true}).limit(4):Promise.resolve({data:[] as any[],count:0}),
    session?supabaseAdmin.from('agent_runs').select('id,title,summary,status,updated_at').eq('telegram_id',tg).in('status',['running','queued','waiting_approval']).order('updated_at',{ascending:false}).limit(12):Promise.resolve({data:[] as any[]}),
    // Indicator counts come from untruncated head-counts, not the limited display list,
    // so a running row can never be hidden behind more-recent paused/waiting rows.
    session?supabaseAdmin.from('agent_runs').select('id',{count:'exact',head:true}).eq('telegram_id',tg).in('status',['running','queued']).gte('updated_at',staleRunningCutoff()):Promise.resolve({count:0}),
    session?getPendingBrowserHandoffs(tg):Promise.resolve([]),
    session?supabaseAdmin.from('agent_runs').select('id,type,title,summary,status,source,error,metadata_json,updated_at')
      .eq('telegram_id',tg).in('status',['completed','paused','failed']).neq('type','secure_browser')
      .order('updated_at',{ascending:false}).limit(12):Promise.resolve({data:[] as any[],error:null}),
  ])

  const tz=user?.timezone||'Asia/Kolkata'
  const now=new Date()
  const name=user?.name?.trim().split(/\s+/)[0]||'there'
  // A cancelled reminder is not part of today.
  const reminders=(today.ok?today.reminders:[]).filter(r=>r.status!=='cancelled'&&r.delivery_state!=='cancelled')
  const pending=reminders.filter(r=>!r.sent)
  const approvalRows=approvals.data||[]
  const handoffRows=handoffs.filter(handoff=>!approvalRows.some((approval:any)=>String(approval.run_id)===handoff.id))
  // Several hand-offs on the same site (four playo.co robot checks) are one thing to do: one row with a count.
  const handoffGroups=[...handoffRows.reduce((map,h)=>{const g=map.get(h.title);if(g){g.count+=1+h.repeats}else map.set(h.title,{first:h,count:1+h.repeats});return map},new Map<string,{first:typeof handoffRows[number];count:number}>()).values()]
  const watcherRows=watchers.data||[]
  const watcherCount=Number(watchers.count??watcherRows.length)
  // A task stuck in running for hours lost its worker; it is not "now" work.
  const runRows=(runs.data||[]).filter((r:any)=>!isStaleRunning(r,now)).slice(0,4)
  // The same background check repeated (KLM status unchanged, three times) is one update, not three.
  const recentUpdates=((recentUpdatesResult as any)?.data||[]).filter((run:any)=>!retiredRunReason(run))
    .filter((run:any,i:number,all:any[])=>all.findIndex((x:any)=>x.title===run.title&&x.summary===run.summary&&x.status===run.status)===i).slice(0,3)
  const updatesUnavailable=Boolean((recentUpdatesResult as any)?.error)
  // Distinguish actively-executing runs from runs awaiting an approval. Counts come from
  // untruncated head-counts so active work is never hidden by the display limit; only
  // running/queued is "Working" (a paused/blocked run must not read as working).
  // "Waiting for you" is what Needs you shows: approvals plus one item per site that stopped for you. Old paused runs
  // (25 of them, mostly the same playo.co stop) are history, not 25 things to do.
  const runState={ working:Number(workingCountRes?.count||0), waiting:approvalRows.length+handoffGroups.length }
  const contextBits=[
    memory.ok?`${memory.items.length} memories`:null,
    lists.ok?`${lists.lists.length} lists`:null,
    watcherCount?`${watcherCount} background watch${watcherCount===1?'':'es'}`:null,
  ].filter(Boolean)

  const summary=approvalRows.length
    ? `You have ${approvalRows.length} thing${approvalRows.length===1?'':'s'} waiting for your say-so. Gogo is keeping the rest moving in the background.`
    : runState.working
      ? `Gogo is working on ${runState.working} active task${runState.working===1?'':'s'}. You can leave — it will stop if anything needs your approval.`
      : runState.waiting
      ? `${runState.waiting} thing${runState.waiting===1?' is':'s are'} waiting for you in Needs you.`
      : pending.length
        ? `You have ${pending.length} reminder${pending.length===1?'':'s'} today. Gogo is quiet unless something changes or needs you.`
        : 'Your day is clear. Tell Gogo what matters and it will carry the next safe steps.'

  return <div className="mx-auto w-full max-w-[1600px] pb-10">
    <header className="hidden items-center justify-between gap-4 border-b border-[#1f1f1f] pb-4 lg:flex">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f2efea]"><GogoCharacter state={approvalRows.length?'approval':runState.working?'acting':runState.waiting?'approval':watcherRows.length?'watching':'calm'} size={38} showStatus={false}/></div>
        <div>
          <div className="text-[16px] font-medium text-[#f2efea]">Gogo</div>
          <div className="mt-0.5 flex items-center gap-2 text-[13px] text-[#a8a8a4]"><span className={`h-1.5 w-1.5 rounded-full ${runState.working?'bg-[#2fb8a6]':runState.waiting?'bg-[#D9A441]':watcherRows.length?'bg-[#2fb8a6]':'bg-[#6a6a6a]'}`}/>{runState.working?'Working':runState.waiting?'Waiting for you':watcherRows.length?'Watching':'Ready'}</div>
        </div>
      </div>
      <div className="text-right text-[13px] text-[#a8a8a4]">Safe mode on<br/><span className="text-[#9a9a9a]">WhatsApp + Dashboard</span></div>
    </header>

    <section className="pb-5 pt-2 lg:py-8">
      <div className="final-dark-eyebrow">{dayLabel(now,tz)}</div>
      <h1 className="final-dark-title mt-1.5 text-[26px] leading-[1.15] sm:text-[32px] lg:text-[36px]">{greeting(now,tz)}, {name}</h1>
      <p className="mt-2 max-w-[760px] text-[16px] leading-6 text-[#a8a8a4]">{summary}</p>
      <div className="mt-5 hidden max-w-[760px] lg:block"><CommandBar/></div>
    </section>

    <div className="grid gap-4 lg:gap-5 xl:grid-cols-3">
        <section className="final-dark-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">Needs you</div><Link href="/dashboard/agent?section=approvals" className="text-[14px] font-semibold text-[#d9a441]">{approvalRows.length+handoffGroups.length}</Link></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {approvalRows.map((a:any)=><Row key={a.id} tone="amber" title={a.title||'Approval needed'} meta={a.description||'Gogo stopped before a consequential action.'} right="Review" href="/dashboard/agent?section=approvals"/>)}
            {handoffGroups.map(({first,count})=><Row key={first.id} tone="amber" title={first.title} meta={count>1?`Stopped here ${count} times. Latest: ${readableRunSummary(first.summary)}`:readableRunSummary(first.summary)} right={count>1?'Open':'Take control'} href={count>1?'/dashboard/agent?section=approvals':`/dashboard/activity/${first.id}/browser`}/>)}
            {!approvalRows.length&&!handoffGroups.length&&<div className="py-5 text-[15px] text-[#a8a8a4]">Nothing is waiting for you.</div>}
          </div>
        </section>

        <section className="final-dark-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">Today</div><span className="text-[14px] text-[#a8a8a4]">{reminders.length}</span></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {reminders.length?reminders.slice(0,6).map(r=><Row key={String(r.id)} tone={r.status==='completed'||['read','delivered'].includes(r.delivery_state||'')?'green':'muted'} title={r.message||'Reminder'} meta={reminderStateLabel(r)} right={clock(r.remind_at,tz)}/>):<div className="py-5 text-[15px] text-[#a8a8a4]">No reminders today.</div>}
          </div>
        </section>

        <section className="final-dark-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">In the background</div><Link href="/dashboard/agent?section=background" className="text-[14px] text-[#2fb8a6]">All</Link></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {runRows.slice(0,2).map((r:any)=><Row key={r.id} tone={r.status==='waiting_approval'?'amber':'teal'} title={r.title||'Gogo task'} meta={readableRunSummary(r.summary)||r.status} right="now" href={`/dashboard/activity/${r.id}`}/>)}
            {watcherRows.slice(0,3).map((w:any)=><Row key={w.id} tone="teal" title={w.title||'Background watch'} meta={String(w.type||'watch').replaceAll('_',' ')} right={w.next_check_at?clock(w.next_check_at,tz):''} href="/dashboard/agent?section=background"/>)}
            {!runRows.length&&!watcherRows.length&&<div className="py-5 text-[15px] text-[#a8a8a4]">Nothing is running in the background.</div>}
          </div>
        </section>
    </div>

    <div className="mt-4 grid gap-4 lg:mt-5 lg:gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="final-dark-panel overflow-hidden" aria-labelledby="from-your-work">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <div><h2 id="from-your-work" className="final-dark-eyebrow">From your work</h2><p className="mt-1 text-[15px] text-[#a8a8a8]">Recent updates from your saved tasks.</p></div>
            <Link href="/dashboard/activity" className="shrink-0 text-[15px] font-medium text-[#77d2c4] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77d2c4]">All activity →</Link>
          </div>
          <div className="border-t border-[#1f1f1f] px-4">
            {recentUpdates.map((run:any)=>{
              const state=updateState(String(run.status))
              const when=run.updated_at&&Number.isFinite(Date.parse(run.updated_at))
                ?new Intl.DateTimeFormat('en-GB',{timeZone:tz,day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(run.updated_at))
                :'Time unavailable'
              const origin=run.source==='whatsapp'?'WhatsApp':run.source==='web'?'Dashboard':null
              return <Link key={run.id} href={`/dashboard/activity/${encodeURIComponent(String(run.id))}`} className="block border-t border-[#242424] py-4 first:border-t-0 hover:bg-[#151515] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#77d2c4]">
                <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 text-[13px] font-semibold ${state.tone}`}>{state.label}</span><span className="text-[14px] text-[#a8a8a8]">{when}{origin?` · ${origin}`:''}</span></div>
                <h3 className="mt-2 text-[16px] font-semibold leading-5 text-[#f2efea]">{run.title||'Gogo task'}</h3>
                <p className="mt-1 line-clamp-2 text-[15px] leading-5 text-[#b7b7b7]">{readableRunSummary(run.summary)||'Open the task to see what happened.'}</p>
                <span className="mt-2 inline-block text-[14px] font-medium text-[#77d2c4]">View task details →</span>
              </Link>
            })}
            {updatesUnavailable&&<p className="py-5 text-[15px] text-[#b7b7b7]">Recent updates could not be loaded. Open Activity to try again.</p>}
            {!updatesUnavailable&&!recentUpdates.length&&<p className="py-5 text-[15px] text-[#b7b7b7]">No finished or paused task updates yet. They will appear here when Gogo has something to report.</p>}
          </div>
        </section>

      <div className="space-y-5">
        <section className="final-dark-panel p-4">
          <div className="final-dark-eyebrow">Context</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {contextBits.map((x,i)=><span key={i} className="final-dark-pill rounded-full px-2.5 py-1.5 text-[13px]">{x}</span>)}
            {!contextBits.length&&<span className="text-[15px] text-[#6a6a6a]">Gogo will build context as you use it.</span>}
          </div>
          <div className="mt-4 flex gap-2">
            <Link href="/dashboard/memory" className="rounded-[8px] border border-[#2a2a2a] px-3 py-2 text-[13px] text-[#c9c9c4] hover:border-[#2fb8a6] hover:text-[#2fb8a6]">Memory</Link>
            <Link href="/dashboard/activity" className="rounded-[8px] border border-[#2a2a2a] px-3 py-2 text-[13px] text-[#c9c9c4] hover:border-[#2fb8a6] hover:text-[#2fb8a6]">Activity</Link>
          </div>
        </section>
      </div>
    </div>
  </div>
}
