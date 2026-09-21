import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { browserContextForRun, getDashboardActivityRun } from '@/lib/dashboard/agent-activity'

export const dynamic='force-dynamic'

function fmt(value:string|null){
  if(!value)return '—'
  return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Kolkata'}).format(new Date(value))
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
function badge(status:string){
  if(status==='completed')return 'bg-[#161616] text-[#2FB8A6]'
  if(['paused','waiting_approval'].includes(status))return 'bg-[#1A1710] text-[#D9A441]'
  if(status==='failed')return 'border border-[#6A6A6A] bg-[#111111] text-[#F2EFEA]'
  return 'bg-[#161616] text-[#D9A441]'
}
function dot(status:string){
  if(status==='completed')return 'bg-[#7FB069]'
  if(['running','queued'].includes(status))return 'bg-[#2FB8A6]'
  if(['paused','waiting_approval'].includes(status))return 'bg-[#D9A441]'
  if(status==='failed')return 'border-[1.5px] border-[#9A9A9A] bg-[#111111]'
  return 'bg-[#2A2A2A]'
}

export default async function ActivityRunPage({params}:{params:Promise<{runId:string}>}){
  const session=await getSession()
  if(!session)notFound()
  const {runId}=await params
  const run=await getDashboardActivityRun(session.telegramId,runId)
  if(!run)notFound()
  const browser=browserContextForRun(run)
  const done=run.steps.filter(s=>s.status==='completed').length
  const total=Math.max(run.steps.length,1)
  const needsUser=['paused','waiting_approval'].includes(run.status)

  return <div className="mx-auto w-full max-w-[1180px] pb-10">
    <header className="border-b border-[#2A2A2A] pb-5">
      <Link href="/dashboard/activity" className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.12em] text-[#6A6A6A] hover:text-[#2FB8A6]">← Activity</Link>
      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-serif text-[30px] font-semibold leading-[1.08] tracking-[-.02em] text-[#F2EFEA] lg:text-[38px]">{run.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.12em] ${badge(run.status)}`}><span className={`h-2 w-2 rounded-full ${dot(run.status)}`}/>{statusLabel(run.status)}</span>
            <span className="text-[12px] text-[#6A6A6A]">Started {fmt(run.startedAt)}</span>
            <span className="inline-flex items-center gap-1.5 text-[12px] text-[#6A6A6A]"><span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#161616] px-1.5 text-[11px] font-bold text-[#2FB8A6]">{done}</span>of {total} steps</span>
            {run.source&&<span className="rounded-full border border-[#2A2A2A] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.08em] text-[#9A9A9A]">{run.source}</span>}
          </div>
        </div>
        <div className="text-right text-[12px] text-[#6A6A6A]">{run.progress||0}%</div>
      </div>
    </header>

    <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">Steps</p>
        {run.steps.length===0?<div className="mt-4 rounded-[16px] border border-[#2A2A2A] p-4 text-[13px] text-[#9A9A9A]">This run has not created any execution steps yet.</div>:
        <div className="relative mt-2">
          <div className="absolute bottom-4 left-[9px] top-4 w-px bg-[#2A2A2A]"/>
          {run.steps.map((step,index)=>{
            const waiting=step.status==='waiting_approval'||(index===run.steps.length-1&&needsUser&&step.status!=='completed'&&step.status!=='failed')
            return <div key={step.id} className={`relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 py-2.5 ${waiting?'mt-1':''}`}>
              <div className="flex justify-center pt-1.5"><span className={`relative z-10 h-[11px] w-[11px] rounded-full border-2 border-[#111111] ${dot(step.status)}`}/></div>
              <div className={waiting?'rounded-[14px] bg-[#1A1710] px-4 py-3':'pr-2'}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[14px] font-semibold text-[#F2EFEA]">{step.title}</div>
                    <div className="mt-1 text-[12.5px] leading-5 text-[#9A9A9A]">{step.error?step.error:step.status==='completed'?'Completed successfully.':step.status==='failed'?'This step failed and Gogo stopped or retried safely.':step.status==='running'?'Gogo is working on this step now.':step.status==='queued'?'Queued for execution.':'Waiting before this step can continue.'}</div>
                  </div>
                  <div className="flex items-center gap-2"><span className={`text-[9px] font-bold uppercase tracking-[.1em] ${step.status==='failed'?'text-[#9A9A9A]':step.status==='completed'?'text-[#7FB069]':'text-[#D9A441]'}`}>{statusLabel(step.status)}</span><span className="text-[11px] text-[#6A6A6A]">{fmt(step.completedAt||step.startedAt)}</span></div>
                </div>
              </div>
            </div>
          })}
        </div>}
      </section>

      <aside className="space-y-4">
        {browser.hasBrowser&&<section className="rounded-[16px] border border-[#2A2A2A] bg-[#111111] p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">Gogo&apos;s browser</p>
          <h2 className="mt-2 text-[14px] font-semibold text-[#F2EFEA]">{browser.providerBlocked?'Blocked by provider':browser.takeoverAvailable?'Waiting for you':'Browser task'}</h2>
          <p className="mt-1 text-[12.5px] leading-5 text-[#9A9A9A]">{browser.hostname||'Secure browser'}{browser.summary?` · ${browser.summary}`:''}</p>
          <Link href={`/dashboard/activity/${encodeURIComponent(run.id)}/browser`} className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[#2FB8A6]">Open browser view →</Link>
        </section>}

        {needsUser&&<section className="rounded-[16px] bg-[#1A1710] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#D9A441]">Waiting on you</p>
          <h2 className="mt-2 font-serif text-[23px] font-semibold leading-tight text-[#F2EFEA]">{browser.providerBlocked?'Open the provider on your own device.':run.status==='waiting_approval'?'Review the pending action.':'This task needs one thing from you.'}</h2>
          <p className="mt-2 text-[13px] leading-5 text-[#9A9A9A]">{run.summary||'Gogo paused safely before continuing.'}</p>
          {run.status==='waiting_approval'&&<Link href="/dashboard/agent" className="mt-4 inline-flex h-10 items-center rounded-[10px] bg-[#2FB8A6] px-4 text-[13px] font-bold text-[#F2EFEA]">Review approval</Link>}
        </section>}

        <section className="rounded-[16px] border border-[#2A2A2A] bg-[#111111] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">Summary</p>
          <h2 className="mt-2 font-serif text-[22px] font-semibold leading-tight text-[#F2EFEA]">{run.status==='completed'?'Done.':run.status==='failed'?'Stopped safely.':needsUser?'Almost done — needs you.':'Gogo is working on it.'}</h2>
          <p className="mt-2 text-[13px] leading-5 text-[#9A9A9A]">{run.summary||run.why||'This task is recorded in Activity.'}</p>
          {run.error&&<p className="mt-3 rounded-[10px] bg-[#161616] px-3 py-2 text-[11px] text-[#9A9A9A]">Error: {run.error}</p>}
        </section>
      </aside>
    </div>
  </div>
}
