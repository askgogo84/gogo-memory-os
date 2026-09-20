import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
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
  if(status==='completed')return 'bg-[#f0eaf1] text-[#4D2A50]'
  if(['paused','waiting_approval'].includes(status))return 'bg-[#fdf0e2] text-[#D67528]'
  if(status==='failed')return 'border border-[#9a8778] bg-[#fbf6ef] text-[#3E2312]'
  if(['running','queued'].includes(status))return 'bg-[#fff1df] text-[#D67528]'
  return 'bg-[#f0eaf1] text-[#6b4a34]'
}
function dotTone(status:string){
  if(status==='completed')return 'bg-[#714C77]'
  if(['running','queued'].includes(status))return 'bg-[#F18219]'
  if(['paused','waiting_approval'].includes(status))return 'bg-[#E4A97D]'
  if(status==='failed')return 'border-[1.5px] border-[#6b4a34] bg-[#fbf6ef]'
  return 'bg-[#b8a797]'
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

  return <div className="mx-auto w-full max-w-[1180px] pb-8">
    <header className="flex flex-col gap-4 border-b border-[#b8a797]/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#9a8778]">AskGogo</p>
        <h1 className="mt-1 font-serif text-[34px] font-semibold leading-none tracking-[-.02em] text-[#3E2312] lg:text-[38px]">Activity</h1>
        <p className="mt-2 text-[13px] text-[#9a8778]">What Gogo has done, newest first.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map(item=><Link key={item} href={item==='All'?'/dashboard/activity':`/dashboard/activity?filter=${encodeURIComponent(item)}`} className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${filter===item?'bg-[#4D2A50] text-[#fbf6ef]':'border border-[#b8a797] text-[#3E2312] hover:bg-[#f0eaf1]'}`}>{item}</Link>)}
      </div>
    </header>

    {visible.length===0?<section className="mt-6 rounded-[24px] border border-[#b8a797] bg-[#fbf6ef] p-7">
      <div className="flex items-center gap-3"><span className="h-3 w-3 rounded-full border border-[#b8a797]"/><span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#9a8778]">Today</span></div>
      <h2 className="mt-7 font-serif text-[28px] font-semibold text-[#3E2312]">Nothing here yet.</h2>
      <p className="mt-3 max-w-xl text-[14px] leading-6 text-[#6b4a34]">When Gogo does something for you — runs research, opens a site, works through a task, or creates an output — it shows up here.</p>
      <Link href="/dashboard/chat" className="mt-6 inline-flex h-10 items-center rounded-[10px] bg-[#F18219] px-4 text-[13px] font-bold text-[#3E2312]">Ask Gogo</Link>
    </section>:
    <div className="mt-5 space-y-7">
      {[...grouped.entries()].map(([day,items])=><section key={day}>
        <div className="flex items-center gap-2.5 pb-2">
          <span className={`text-[11px] font-bold uppercase tracking-[.12em] ${day==='Today'?'text-[#D67528]':'text-[#9a8778]'}`}>{day}</span>
          <span className="h-px flex-1 bg-[#b8a797]"/>
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#f0eaf1] px-1.5 text-[11px] font-bold text-[#4D2A50]">{items.length}</span>
        </div>
        <div className="relative">
          <div className="absolute bottom-4 left-[9px] top-4 w-px bg-[#b8a797]"/>
          {items.map(run=>{
            const browser=browserContextForRun(run)
            const active=['running','queued'].includes(run.status)
            const waiting=['paused','waiting_approval'].includes(run.status)
            return <Link href={`/dashboard/activity/${encodeURIComponent(run.id)}`} key={run.id} className={`group relative grid grid-cols-[20px_34px_minmax(0,1fr)] gap-x-3 py-3 lg:grid-cols-[20px_34px_minmax(0,1fr)_auto] ${waiting?'my-1 rounded-[16px] bg-[#fdf0e2] px-3 py-3':'px-0'}`}>
              <div className="flex justify-center pt-2.5">
                <span className={`relative z-10 block rounded-full border-2 border-[#fbf6ef] ${active?'h-[13px] w-[13px] bg-[#F18219] shadow-[0_0_0_4px_rgba(241,130,25,.12)]':'h-[11px] w-[11px] '+dotTone(run.status)}`}/>
              </div>
              <span className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-[15px] ${active||waiting?'bg-[#fdf0e2]':'bg-[#f0eaf1]'} text-[#6b4a34]`}>{iconFor(run)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-[#3E2312] group-hover:text-[#4D2A50]">{run.title}</h2>
                  {waiting&&<span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[.1em] ${statusTone(run.status)}`}>{statusLabel(run.status)}</span>}
                </div>
                <p className={`mt-1 line-clamp-2 text-[13px] leading-5 ${active?'font-semibold text-[#D67528]':'text-[#6b4a34]'}`}>{runSubline(run)}</p>
                {active&&<div className="mt-2 flex max-w-[320px] items-center gap-2"><div className="flex flex-1 gap-1">{[1,2,3,4,5].map((n)=><span key={n} className={`h-[2px] flex-1 ${n<=Math.max(1,Math.ceil((run.progress||0)/20))?'bg-[#F18219]':'bg-[#b8a797]/50'}`}/>)}</div><span className="text-[10px] font-bold uppercase tracking-[.08em] text-[#9a8778]">{run.progress||0}%</span></div>}
                {browser.hasBrowser&&<div className="mt-2 inline-flex items-center gap-2 rounded-[10px] border border-[#b8a797] bg-[#fbf6ef] px-2.5 py-1.5 text-[11px] text-[#6b4a34]"><span>▣</span><span>{browser.hostname||'Gogo browser'}</span><span className="font-bold text-[#4D2A50]">Open task →</span></div>}
              </div>
              <span className="col-start-3 mt-1 text-[11px] text-[#9a8778] lg:col-start-4 lg:row-start-1 lg:mt-0">{fmtTime(run.updatedAt||run.startedAt)}</span>
            </Link>
          })}
        </div>
      </section>)}
    </div>}
  </div>
}
