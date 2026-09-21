import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { browserContextForRun, getDashboardActivityRuns, type DashboardActivityRun } from '@/lib/dashboard/agent-activity'

export const dynamic='force-dynamic'

const FILTERS=['All','Reminders','Browser','Research','Documents'] as const
type Filter=(typeof FILTERS)[number]

function fmtTime(value:string|null){
  if(!value)return '—'
  return new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Kolkata'}).format(new Date(value))
}
function dayKey(value:string|null){
  if(!value)return 'Unknown'
  const d=new Date(value)
  const today=new Date()
  const fmt=(x:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(x)
  const current=fmt(today)
  const key=fmt(d)
  const yesterday=new Date(today.getTime()-86400000)
  if(key===current)return 'Today'
  if(key===fmt(yesterday))return 'Yesterday'
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'}).format(d)
}
function statusTone(status:string){
  if(status==='completed')return 'bg-[#161616] text-[#2FB8A6]'
  if(['paused','waiting_approval'].includes(status))return 'bg-[#1A1710] text-[#D9A441]'
  if(status==='failed')return 'border border-[#6A6A6A] bg-[#111111] text-[#F2EFEA]'
  if(['running','queued'].includes(status))return 'bg-[#161616] text-[#D9A441]'
  return 'bg-[#161616] text-[#9A9A9A]'
}
function dotTone(status:string){
  if(status==='completed')return 'bg-[#7FB069]'
  if(['running','queued'].includes(status))return 'bg-[#2FB8A6]'
  if(['paused','waiting_approval'].includes(status))return 'bg-[#D9A441]'
  if(status==='failed')return 'border-[1.5px] border-[#9A9A9A] bg-[#111111]'
  return 'bg-[#2A2A2A]'
}
function statusLabel(status:string){
  if(status==='completed')return 'Complete'
  if(status==='waiting_approval')return 'Waiting on you'
  if(status==='paused')return 'Paused'
  if(status==='running')return 'Running'
  if(status==='queued')return 'Queued'
  if(status==='failed')return 'Failed'
  return status.replaceAll('_',' ')
}
function runSubline(run:DashboardActivityRun){
  const browser=browserContextForRun(run)
  if(run.status==='running')return run.summary||'Gogo is working on it.'
  if(run.status==='waiting_approval')return run.summary||'Waiting for your approval.'
  if(run.status==='paused'&&browser.providerBlocked)return 'The provider blocked server access. Open it on your own device to continue.'
  if(run.status==='paused')return run.summary||'This task is waiting for you.'
  if(run.status==='failed')return run.error||run.summary||'This task could not be completed.'
  return run.summary||run.why||'Gogo completed this task.'
}
function iconFor(run:DashboardActivityRun){
  if(run.category==='Reminders')return '◔'
  if(run.category==='Documents')return '▱'
  if(run.category==='Browser')return '▣'
  return '⌕'
}

export default async function ActivityPage({searchParams}:{searchParams:Promise<{filter?:string}>}){
  const session=await getSession()
  const runs=session?await getDashboardActivityRuns(session.telegramId):[]
  const [watchersResult,approvalsResult]=session?await Promise.all([
    supabaseAdmin.from('agent_watchers')
      .select('id,type,condition_json,cadence_minutes,last_checked_at,next_check_at')
      .eq('telegram_id',String(session.telegramId))
      .eq('active',true)
      .order('next_check_at',{ascending:true})
      .limit(6),
    supabaseAdmin.from('agent_approvals')
      .select('id,run_id,title,description,risk_level,requested_at')
      .eq('telegram_id',String(session.telegramId))
      .eq('status','pending')
      .order('requested_at',{ascending:false})
      .limit(5),
  ]):[{data:[]},{data:[]}]
  const watchers=(watchersResult as any).data||[]
  const approvals=(approvalsResult as any).data||[]
  const activeRun=runs.find(r=>['running','queued','paused','waiting_approval'].includes(r.status))||null
  const params=await searchParams
  const requested=String(params?.filter||'All')
  const filter=(FILTERS.includes(requested as Filter)?requested:'All') as Filter
  const visible=filter==='All'?runs:runs.filter(r=>r.category===filter)
  const grouped=new Map<string,DashboardActivityRun[]>()
  for(const run of visible){
    const key=dayKey(run.updatedAt||run.startedAt)
    const list=grouped.get(key)||[]
    list.push(run);grouped.set(key,list)
  }

  return <div className="w-full pb-8">
    <header className="flex flex-col gap-4 border-b border-[#2A2A2A]/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">AskGogo</p>
        <h1 className="mt-1 font-serif text-[34px] font-semibold leading-none tracking-[-.02em] text-[#F2EFEA] lg:text-[38px]">Activity</h1>
        <p className="mt-2 text-[13px] text-[#6A6A6A]">What Gogo has done, newest first.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map(item=><Link key={item} href={item==='All'?'/dashboard/activity':`/dashboard/activity?filter=${encodeURIComponent(item)}`} className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${filter===item?'bg-[#2FB8A6] text-[#111111]':'border border-[#2A2A2A] text-[#F2EFEA] hover:bg-[#161616]'}`}>{item}</Link>)}
      </div>
    </header>

    <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_390px]">
      <main className="min-w-0">
    {visible.length===0?<section className="rounded-[24px] border border-[#2A2A2A] bg-[#111111] p-7">
      <div className="flex items-center gap-3"><span className="h-3 w-3 rounded-full border border-[#2A2A2A]"/><span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">Today</span></div>
      <h2 className="mt-7 font-serif text-[28px] font-semibold text-[#F2EFEA]">Nothing here yet.</h2>
      <p className="mt-3 max-w-xl text-[14px] leading-6 text-[#9A9A9A]">When Gogo does something for you — runs research, opens a site, works through a task, or creates an output — it shows up here.</p>
      <Link href="/dashboard/chat" className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-[#2FB8A6] px-4 text-[13px] font-bold text-[#F2EFEA]">Ask Gogo</Link>
    </section>:
    <div className="mt-5 space-y-7">
      {[...grouped.entries()].map(([day,items])=><section key={day}>
        <div className="flex items-center gap-2.5 pb-2">
          <span className={`text-[11px] font-bold uppercase tracking-[.12em] ${day==='Today'?'text-[#D9A441]':'text-[#6A6A6A]'}`}>{day}</span>
          <span className="h-px flex-1 bg-[#2A2A2A]"/>
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#161616] px-1.5 text-[11px] font-bold text-[#2FB8A6]">{items.length}</span>
        </div>
        <div className="relative">
          <div className="absolute bottom-4 left-[9px] top-4 w-px bg-[#2A2A2A]"/>
          {items.map(run=>{
            const browser=browserContextForRun(run)
            const active=['running','queued'].includes(run.status)
            const waiting=['paused','waiting_approval'].includes(run.status)
            return <Link href={`/dashboard/activity/${encodeURIComponent(run.id)}`} key={run.id} className={`group relative grid grid-cols-[20px_34px_minmax(0,1fr)] gap-x-3 py-3 lg:grid-cols-[20px_34px_minmax(0,1fr)_auto] ${waiting?'my-1 rounded-[16px] bg-[#1A1710] px-3 py-3':'px-0'}`}>
              <div className="flex justify-center pt-2.5">
                <span className={`relative z-10 block rounded-full border-2 border-[#111111] ${active?'h-[13px] w-[13px] bg-[#2FB8A6] shadow-[0_0_0_4px_rgba(241,130,25,.12)]':'h-[11px] w-[11px] '+dotTone(run.status)}`}/>
              </div>
              <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-[15px] ${active||waiting?'bg-[#1A1710]':'bg-[#161616]'} text-[#9A9A9A]`}>{iconFor(run)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-[#F2EFEA] group-hover:text-[#2FB8A6]">{run.title}</h2>
                  {waiting&&<span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[.1em] ${statusTone(run.status)}`}>{statusLabel(run.status)}</span>}
                </div>
                <p className={`mt-1 line-clamp-2 text-[13px] leading-5 ${active?'font-semibold text-[#D9A441]':'text-[#9A9A9A]'}`}>{runSubline(run)}</p>
                {active&&<div className="mt-2 flex max-w-[320px] items-center gap-2"><div className="flex flex-1 gap-1">{[1,2,3,4,5].map((n)=><span key={n} className={`h-[2px] flex-1 ${n<=Math.max(1,Math.ceil((run.progress||0)/20))?'bg-[#2FB8A6]':'bg-[#2A2A2A]/50'}`}/>)}</div><span className="text-[10px] font-bold uppercase tracking-[.08em] text-[#6A6A6A]">{run.progress||0}%</span></div>}
                {browser.hasBrowser&&<div className="mt-2 inline-flex items-center gap-2 rounded-[10px] border border-[#2A2A2A] bg-[#111111] px-2.5 py-1.5 text-[11px] text-[#9A9A9A]"><span>▣</span><span>{browser.hostname||'Gogo browser'}</span><span className="font-bold text-[#2FB8A6]">Open task →</span></div>}
              </div>
              <span className="col-start-3 mt-1 text-[11px] text-[#6A6A6A] lg:col-start-4 lg:row-start-1 lg:mt-0">{fmtTime(run.updatedAt||run.startedAt)}</span>
            </Link>
          })}
        </div>
      </section>)}
    </div>}
      </main>

      <aside className="hidden xl:block">
        <div className="sticky top-8 space-y-4">
          <section className="overflow-hidden rounded-[22px] border border-[#2A2A2A]/80 bg-[#111111] shadow-[0_14px_38px_rgba(62,35,18,.05)]">
            <div className="border-b border-[#2A2A2A]/60 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#6A6A6A]">Now</p>
                  <h2 className="mt-1 font-serif text-[23px] font-semibold text-[#F2EFEA]">Gogo at work</h2>
                </div>
                <span className="h-2.5 w-2.5 rounded-full bg-[#2FB8A6] shadow-[0_0_0_5px_rgba(241,130,25,.10)]"/>
              </div>
            </div>
            {activeRun?
              <Link href={`/dashboard/activity/${encodeURIComponent(activeRun.id)}`} className="block px-5 py-4 transition hover:bg-[#141414]">
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-[#1A1710] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.1em] text-[#D9A441]">{statusLabel(activeRun.status)}</span>
                  <span className="text-[11px] font-semibold text-[#6A6A6A]">{activeRun.progress||0}%</span>
                </div>
                <h3 className="mt-3 text-[15px] font-semibold leading-5 text-[#F2EFEA]">{activeRun.title}</h3>
                <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-5 text-[#9A9A9A]">{runSubline(activeRun)}</p>
                <div className="mt-4 flex gap-1">{[1,2,3,4,5].map(n=><span key={n} className={`h-[3px] flex-1 rounded-full ${n<=Math.max(1,Math.ceil((activeRun.progress||0)/20))?'bg-[#2FB8A6]':'bg-[#2A2A2A]'}`}/>)}</div>
                <div className="mt-3 text-[11px] font-bold text-[#2FB8A6]">Open task →</div>
              </Link>
            :<div className="px-5 py-5 text-[13px] leading-5 text-[#9A9A9A]">Nothing is running right now. Gogo is standing by.</div>}
          </section>

          <section className="rounded-[22px] border border-[#2A2A2A]/80 bg-[#111111] p-5 shadow-[0_14px_38px_rgba(62,35,18,.04)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#6A6A6A]">Needs you</p>
                <h2 className="mt-1 font-serif text-[21px] font-semibold text-[#F2EFEA]">Approvals</h2>
              </div>
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#161616] px-2 text-[11px] font-bold text-[#2FB8A6]">{approvals.length}</span>
            </div>
            {approvals.length===0?<p className="mt-3 text-[12.5px] leading-5 text-[#9A9A9A]">Nothing is waiting for your approval.</p>:
              <div className="mt-3 space-y-2">
                {approvals.slice(0,3).map((a:any)=><Link key={a.id} href="/dashboard/agent" className="block rounded-[14px] bg-[#1A1710] px-3.5 py-3 transition hover:bg-[#221D13]">
                  <div className="text-[12.5px] font-semibold text-[#F2EFEA]">{a.title}</div>
                  <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-[#9A9A9A]">{a.description||'Gogo is waiting for your decision.'}</div>
                </Link>)}
              </div>}
          </section>

          <section className="rounded-[22px] border border-[#2A2A2A]/80 bg-[#111111] p-5 shadow-[0_14px_38px_rgba(62,35,18,.04)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#6A6A6A]">Background Gogo</p>
                <h2 className="mt-1 font-serif text-[21px] font-semibold text-[#F2EFEA]">Watching for you</h2>
              </div>
              <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[#161616] px-2 text-[11px] font-bold text-[#2FB8A6]">{watchers.length}</span>
            </div>
            {watchers.length===0?<p className="mt-3 text-[12.5px] leading-5 text-[#9A9A9A]">No active background watches.</p>:
              <div className="mt-3 space-y-2.5">
                {watchers.slice(0,4).map((w:any)=>{
                  const condition=w.condition_json||{}
                  const title=String(condition.title||condition.productName||condition.query||w.type||'Background watch')
                  return <div key={w.id} className="rounded-[14px] border border-[#2A2A2A]/60 px-3.5 py-3">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#7FB069]"/>
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] font-semibold text-[#F2EFEA]">{title}</div>
                        <div className="mt-1 text-[10.5px] text-[#6A6A6A]">Every {w.cadence_minutes||60} min · next {w.next_check_at?fmtTime(w.next_check_at):'—'}</div>
                      </div>
                    </div>
                  </div>
                })}
              </div>}
          </section>

          <Link href="/dashboard/chat" className="flex h-12 items-center justify-between rounded-[16px] bg-[#2FB8A6] px-4 text-[13px] font-bold text-[#111111] shadow-[0_14px_30px_rgba(77,42,80,.16)]">
            <span>Talk to Gogo</span><span>→</span>
          </Link>
        </div>
      </aside>
    </div>
  </div>
}
