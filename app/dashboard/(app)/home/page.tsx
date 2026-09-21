import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders, getLists } from '@/lib/dashboard/queries'
import { getDashboardMemory } from '@/lib/dashboard/memory'
import { CommandBar } from '@/components/dashboard/command-bar'
import { GogoCharacter } from '@/components/gogo/gogo-character'

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
  const [{data:user},today,lists,memory,approvals,watchers,runs]=await Promise.all([
    Number.isFinite(tgNum)?supabaseAdmin.from('users').select('name,timezone').eq('telegram_id',tgNum).maybeSingle():Promise.resolve({data:null as any}),
    session?getTodayReminders(tg):Promise.resolve({ok:true as const,reminders:[]}),
    session?getLists(tg):Promise.resolve({ok:true as const,lists:[]}),
    session?getDashboardMemory(tg):Promise.resolve({ok:true as const,items:[]}),
    session?supabaseAdmin.from('agent_approvals').select('id,title,description,risk_level,created_at').eq('telegram_id',tg).eq('status','pending').order('created_at',{ascending:false}).limit(4):Promise.resolve({data:[] as any[]}),
    session?supabaseAdmin.from('agent_watchers').select('id,title,type,next_check_at,active').eq('telegram_id',tg).eq('active',true).order('next_check_at',{ascending:true}).limit(4):Promise.resolve({data:[] as any[]}),
    session?supabaseAdmin.from('agent_runs').select('id,title,summary,status,updated_at').eq('telegram_id',tg).in('status',['running','queued','waiting_approval']).order('updated_at',{ascending:false}).limit(4):Promise.resolve({data:[] as any[]}),
  ])

  const tz=user?.timezone||'Asia/Kolkata'
  const now=new Date()
  const name=user?.name?.trim().split(/\s+/)[0]||'there'
  const reminders=today.ok?today.reminders:[]
  const pending=reminders.filter(r=>!r.sent)
  const approvalRows=approvals.data||[]
  const watcherRows=watchers.data||[]
  const runRows=runs.data||[]
  const contextBits=[
    memory.ok?`${memory.items.length} memories`:null,
    lists.ok?`${lists.lists.length} lists`:null,
    watcherRows.length?`${watcherRows.length} background watch${watcherRows.length===1?'':'es'}`:null,
  ].filter(Boolean)

  const summary=approvalRows.length
    ? `You have ${approvalRows.length} thing${approvalRows.length===1?'':'s'} waiting for your say-so. Gogo is keeping the rest moving in the background.`
    : runRows.length
      ? `Gogo is working on ${runRows.length} active task${runRows.length===1?'':'s'}. You can leave — it will stop if anything needs your approval.`
      : pending.length
        ? `You have ${pending.length} reminder${pending.length===1?'':'s'} today. Gogo is quiet unless something changes or needs you.`
        : 'Your day is clear. Tell Gogo what matters and it will carry the next safe steps.'

  return <div className="mx-auto w-full max-w-[1180px] pb-10">
    <header className="flex items-center justify-between gap-4 border-b border-[#1f1f1f] pb-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f2efea]"><GogoCharacter state={approvalRows.length?'approval':runRows.length?'acting':watcherRows.length?'watching':'calm'} size={38} showStatus={false}/></div>
        <div>
          <div className="text-[13px] font-medium text-[#f2efea]">Gogo</div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#6a6a6a]"><span className={`h-1.5 w-1.5 rounded-full ${runRows.length||watcherRows.length?'bg-[#2fb8a6]':'bg-[#6a6a6a]'}`}/>{runRows.length?'Working':watcherRows.length?'Watching':'Ready'}</div>
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
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">Needs you</div><Link href="/dashboard/agent?section=approvals" className="text-[10px] text-[#d9a441]">{approvalRows.length||0}</Link></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {approvalRows.length?approvalRows.map((a:any)=><Row key={a.id} tone="amber" title={a.title||'Approval needed'} meta={a.description||'Gogo stopped before a consequential action.'} right="Review" href="/dashboard/agent?section=approvals"/>):<div className="py-5 text-[12px] text-[#6a6a6a]">Nothing is waiting for you.</div>}
          </div>
        </section>

        <section className="final-dark-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5"><div className="final-dark-eyebrow">Today</div><span className="text-[10px] text-[#6a6a6a]">{reminders.length}</span></div>
          <div className="border-t border-[#1f1f1f] px-4">
            {reminders.length?reminders.slice(0,6).map(r=><Row key={String(r.id)} tone={r.sent?'green':'muted'} title={r.message||'Reminder'} meta={r.sent?'Delivered':'Reminder'} right={clock(r.remind_at,tz)}/>):<div className="py-5 text-[12px] text-[#6a6a6a]">No reminders scheduled for today.</div>}
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
