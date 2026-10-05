import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders, getLists } from '@/lib/dashboard/queries'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { CommandBar } from '@/components/dashboard/command-bar'
import { GogoCharacter } from '@/components/gogo/gogo-character'
import { isActionablePause } from '@/lib/dashboard/run-state'
import { getPendingBrowserHandoffs } from '@/lib/dashboard/human-handoffs'
import { reminderStateLabel } from '@/lib/dashboard/reminder-state'

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
    <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-[#f2efea]">{title}</div><div className="mt-1 text-[11px] leading-4 text-[#6a6a6a]">{meta}</div></div>
    {right&&<div className="shrink-0 text-[10px] text-[#9a9a9a]">{right}</div>}
  </div>
  return href?<Link href={href} className="block hover:bg-[#141414]">{body}</Link>:body
}

export default async function HomePage(){
  const session=await getSession()
  const tg=session?.telegramId||''
  const tgNum=parseInt(tg,10)
  const [{data:user},today,lists,memory,approvals,watchers,runs,workingCountRes,waitingCountRes,pausedRunsRes,handoffs]=await Promise.all([
    Number.isFinite(tgNum)?supabaseAdmin.from('users').select('name,timezone').eq('telegram_id',tgNum).maybeSingle():Promise.resolve({data:null as any}),
    session?getTodayReminders(tg):Promise.resolve({ok:true as const,reminders:[]}),
    session?getLists(tg):Promise.resolve({ok:true as const,lists:[]}),
    session?getDashboardMemory(tg):Promise.resolve({ok:true as const,items:[]}),
    session?supabaseAdmin.from('agent_approvals').select('id,run_id,title,description,risk_level,created_at').eq('telegram_id',tg).eq('status','pending').order('created_at',{ascending:false}).limit(4):Promise.resolve({data:[] as any[]}),
    session?supabaseAdmin.from('agent_watchers').select('id,title,type,next_check_at,active').eq('telegram_id',tg).eq('active',true).order('next_check_at',{ascending:true}).limit(4):Promise.resolve({data:[] as any[]}),
    session?supabaseAdmin.from('agent_runs').select('id,title,summary,status,updated_at').eq('telegram_id',tg).in('status',['running','queued','waiting_approval']).order('updated_at',{ascending:false}).limit(4):Promise.resolve({data:[] as any[]}),
    // Indicator counts come from untruncated head-counts, not the limited display list,
    // so a running row can never be hidden behind more-recent paused/waiting rows.
    session?supabaseAdmin.from('agent_runs').select('id',{count:'exact',head:true}).eq('telegram_id',tg).in('status',['running','queued']):Promise.resolve({count:0}),
    session?supabaseAdmin.from('agent_runs').select('id',{count:'exact',head:true}).eq('telegram_id',tg).eq('status','waiting_approval'):Promise.resolve({count:0}),
    // A paused run stopped at a human-action boundary (sign-in / secure handoff /
    // browser-waiting) is actionable and counts as waiting; a rejected/terminal paused
    // run does not. The signal lives in error OR metadata, so fetch rows and classify.
    session?supabaseAdmin.from('agent_runs').select('id,error,metadata_json,status').eq('telegram_id',tg).eq('status','paused').order('updated_at',{ascending:false}).limit(50):Promise.resolve({data:[] as any[]}),
    session?getPendingBrowserHandoffs(tg):Promise.resolve([]),
  ])

  const tz=user?.timezone||'Asia/Kolkata'
  const now=new Date()
  const name=user?.name?.trim().split(/\s+/)[0]||'there'
  const reminders=today.ok?today.reminders:[]
  const pending=reminders.filter(r=>!r.sent)
  const approvalRows=approvals.data||[]
  const handoffRows=handoffs.filter(handoff=>!approvalRows.some((approval:any)=>String(approval.run_id)===handoff.id))
  const watcherRows=watchers.data||[]
  const runRows=runs.data||[]
  // Distinguish actively-executing runs from runs awaiting an approval. Counts come from
  // untruncated head-counts so active work is never hidden by the display limit; only
  // running/queued is "Working" (a paused/blocked run must not read as working).
  const actionablePaused=((pausedRunsRes as any)?.data||[]).filter((r:any)=>isActionablePause(r)).length
  const runState={ working:Number(workingCountRes?.count||0), waiting:Number(waitingCountRes?.count||0)+actionablePaused }
  const contextBits=[
    memory.ok?`${memory.items.length} memories`:null,
    lists.ok?`${lists.lists.length} lists`:null,
    watcherRows.length?`${watcherRows.length} background watch${watcherRows.length===1?'':'es'}`:null,
  ].filter(Boolean)

  const summary=approvalRows.length
    ? `You have ${approvalRows.length} thing${approvalRows.length===1?'':'s'} waiting for your say-so. Gogo is keeping the rest moving in the background.`
    : runState.working
      ? `Gogo is working on ${runState.working} active task${runState.working===1?'':'s'}. You can leave — it will stop if anything needs your approval.`
      : runState.waiting
      ? `${runState.waiting} task${runState.waiting===1?' is':'s are'} waiting for you to continue.`
      : pending.length
        ? `You have ${pending.length} reminder${pending.length===1?'':'s'} today. Gogo is quiet unless something changes or needs you.`
        : 'Your day is clear. Tell Gogo what matters and it will carry the next safe steps.'

  return <div className="mx-auto w-full max-w-[1180px] pb-10">
    <header className="flex items-center justify-between gap-4 border-b border-[#1f1f1f] pb-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f2efea]"><GogoCharacter state={approvalRows.length?'approval':runState.working?'acting':runState.waiting?'approval':watcherRows.length?'watching':'calm'} size={38} showStatus={false}/></div>
        <div>
          <div className="text-[13px] font-medium text-[#f2efea]">Gogo</div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#6a6a6a]"><span className={`h-1.5 w-1.5 rounded-full ${runState.working?'bg-[#2fb8a6]':runState.waiting?'bg-[#D9A441]':watcherRows.length?'bg-[#2fb8a6]':'bg-[#6a6a6a]'}`}/>{runState.working?'Working':runState.waiting?'Waiting for you':watcherRows.length?'Watching':'Ready'}</div>
        </div>
      </div>
      <div className="text-right text-[10px] text-[#6a6a6a]">Safe mode on<br/><span className="text-[#9a9a9a]">WhatsApp + Dashboard</span></div>
    </header>

    <section className="py-8 lg:py-10">
      <div className="final-dark-eyebrow">{dayLabel(now,tz)}</div>
      <h1 className="final-dark-title mt-2 text-[34px] leading-[1.05] sm:text-[42px]">{greeting(now,tz)}, {name}.</h1>
      <p className="mt-4 max-w-[760px] text-[14px] leading-6 text-[#9a9a9a]">{summary}</p>
      <div className="mt-6 max-w-[760px]"><CommandBar/></div>
    </section>

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
      <div className="space-y-5">
        <section className="final-dark-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">Needs you</div><Link href="/dashboard/agent?section=approvals" className="text-[10px] text-[#d9a441]">{approvalRows.length+handoffRows.length}</Link></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {approvalRows.map((a:any)=><Row key={a.id} tone="amber" title={a.title||'Approval needed'} meta={a.description||'Gogo stopped before a consequential action.'} right="Review" href="/dashboard/agent?section=approvals"/>)}
            {handoffRows.map(handoff=><Row key={handoff.id} tone="amber" title={handoff.title} meta={handoff.summary} right="Take control" href={`/dashboard/activity/${handoff.id}/browser`}/>)}
            {!approvalRows.length&&!handoffRows.length&&<div className="py-5 text-[12px] text-[#6a6a6a]">Nothing is waiting for you.</div>}
          </div>
        </section>

        <section className="final-dark-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">Today</div><span className="text-[10px] text-[#6a6a6a]">{reminders.length}</span></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {reminders.length?reminders.slice(0,6).map(r=><Row key={String(r.id)} tone={r.status==='completed'||['read','delivered'].includes(r.delivery_state||'')?'green':'muted'} title={r.message||'Reminder'} meta={reminderStateLabel(r)} right={clock(r.remind_at,tz)}/>):<div className="py-5 text-[12px] text-[#6a6a6a]">No reminders scheduled for today.</div>}
          </div>
        </section>
      </div>

      <div className="space-y-5">
        <section className="final-dark-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">In the background</div><Link href="/dashboard/agent?section=background" className="text-[10px] text-[#2fb8a6]">All</Link></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {runRows.slice(0,2).map((r:any)=><Row key={r.id} tone={r.status==='waiting_approval'?'amber':'teal'} title={r.title||'Gogo task'} meta={r.summary||r.status} right="now" href={`/dashboard/activity/${r.id}`}/>)}
            {watcherRows.slice(0,3).map((w:any)=><Row key={w.id} tone="teal" title={w.title||'Background watch'} meta={String(w.type||'watch').replaceAll('_',' ')} right={w.next_check_at?clock(w.next_check_at,tz):''} href="/dashboard/agent?section=background"/>)}
            {!runRows.length&&!watcherRows.length&&<div className="py-5 text-[12px] text-[#6a6a6a]">Nothing is running in the background.</div>}
          </div>
        </section>

        <section className="final-dark-panel p-4">
          <div className="final-dark-eyebrow">Context</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {contextBits.map((x,i)=><span key={i} className="final-dark-pill rounded-full px-2.5 py-1.5 text-[10px]">{x}</span>)}
            {!contextBits.length&&<span className="text-[12px] text-[#6a6a6a]">Gogo will build context as you use it.</span>}
          </div>
          <div className="mt-4 flex gap-2">
            <Link href="/dashboard/memory" className="rounded-[8px] border border-[#2a2a2a] px-3 py-2 text-[10px] text-[#c9c9c4] hover:border-[#2fb8a6] hover:text-[#2fb8a6]">Memory</Link>
            <Link href="/dashboard/activity" className="rounded-[8px] border border-[#2a2a2a] px-3 py-2 text-[10px] text-[#c9c9c4] hover:border-[#2fb8a6] hover:text-[#2fb8a6]">Activity</Link>
          </div>
        </section>
      </div>
    </div>
  </div>
}
