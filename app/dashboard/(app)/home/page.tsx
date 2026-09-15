import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { CommandBar } from '@/components/dashboard/command-bar'
import { GogoCharacter } from '@/components/gogo/gogo-character'

export const dynamic = 'force-dynamic'

type FeedItem = { id:string; kind:'approval'|'working'|'watching'|'idea'|'done'; title:string; body:string; href:string }

function period(now: Date, tz: string) {
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now), 10)
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function FeedCard({ item }: { item: FeedItem }) {
  const badge = item.kind === 'approval' ? 'Needs you' : item.kind === 'working' ? 'Working' : item.kind === 'watching' ? 'Watching' : item.kind === 'idea' ? 'Idea' : 'Done'
  const tone = item.kind === 'approval' ? 'bg-amber-50 text-amber-800' : item.kind === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-gogo-teal-soft text-gogo-teal'
  return (
    <Link href={item.href} className="group rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/90 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(45,32,22,.07)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-gogo-ink">{item.title}</div>
          <div className="mt-1 text-[12px] leading-5 text-gogo-ink-3">{item.body}</div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[8px] font-extrabold uppercase tracking-[.12em] ${tone}`}>{badge}</span>
      </div>
      <div className="mt-4 text-[10px] font-bold text-gogo-teal">Open →</div>
    </Link>
  )
}

export default async function HomePage() {
  const session = await getSession()
  const tg = session?.telegramId || ''
  const tgNum = parseInt(tg, 10)
  const [{ data: user }, runs, watchers, approvals, ideas] = await Promise.all([
    Number.isFinite(tgNum)
      ? supabaseAdmin.from('users').select('name, timezone').eq('telegram_id', tgNum).maybeSingle()
      : Promise.resolve({ data: null as any }),
    session ? supabaseAdmin.from('agent_runs').select('id,title,summary,status,updated_at').eq('telegram_id',tg).order('updated_at',{ascending:false}).limit(12) : Promise.resolve({data:[] as any[]}),
    session ? supabaseAdmin.from('agent_watchers').select('id,condition_json,next_check_at,created_at').eq('telegram_id',tg).eq('active',true).order('created_at',{ascending:false}).limit(8) : Promise.resolve({data:[] as any[]}),
    session ? supabaseAdmin.from('agent_approvals').select('id,title,description,run_id,requested_at').eq('telegram_id',tg).eq('status','pending').order('requested_at',{ascending:false}).limit(8) : Promise.resolve({data:[] as any[]}),
    session ? supabaseAdmin.from('agent_ideas').select('id,title,reason,created_at').eq('telegram_id',tg).eq('status','new').order('created_at',{ascending:false}).limit(6) : Promise.resolve({data:[] as any[]}),
  ])

  const now = new Date()
  const tz = user?.timezone || 'Asia/Kolkata'
  const name = user?.name?.trim().split(/\s+/)[0] || 'there'
  const runRows = (runs.data || []) as any[]
  const watcherRows = (watchers.data || []) as any[]
  const approvalRows = (approvals.data || []) as any[]
  const ideaRows = (ideas.data || []) as any[]
  const working = runRows.filter(r=>['queued','running'].includes(String(r.status))).length
  const watching = watcherRows.length + runRows.filter(r=>String(r.status)==='watching').length
  const waiting = approvalRows.length
  const headline = waiting ? `${waiting} ${waiting===1?'thing needs':'things need'} you.` : working ? `Gogo is working on ${working} ${working===1?'thing':'things'}.` : watching ? `Gogo is watching ${watching} ${watching===1?'thing':'things'} for you.` : 'What can Gogo take off your plate?'
  const gogoState = waiting > 0 ? 'approval' : watching > 0 || working > 0 ? 'watching' : 'calm'

  const feed: FeedItem[] = [
    ...approvalRows.slice(0,3).map(a=>({id:`approval:${a.id}`,kind:'approval' as const,title:String(a.title||'Gogo needs your approval'),body:String(a.description||'Review this action before Gogo continues.'),href:'/dashboard/agent'})),
    ...runRows.filter(r=>['queued','running'].includes(String(r.status))).slice(0,3).map(r=>({id:`run:${r.id}`,kind:'working' as const,title:String(r.title||'Gogo is working'),body:String(r.summary||'Working on this in the background.'),href:'/dashboard/agent'})),
    ...watcherRows.slice(0,2).map(w=>({id:`watch:${w.id}`,kind:'watching' as const,title:String(w.condition_json?.title||'Gogo is watching this'),body:'Gogo will surface a meaningful change when it happens.',href:'/dashboard/today'})),
    ...ideaRows.slice(0,2).map(i=>({id:`idea:${i.id}`,kind:'idea' as const,title:String(i.title||'An idea from Gogo'),body:String(i.reason||'Gogo found something that may help.'),href:'/dashboard/today'})),
    ...runRows.filter(r=>String(r.status)==='completed').slice(0,2).map(r=>({id:`done:${r.id}`,kind:'done' as const,title:String(r.title||'Done'),body:String(r.summary||'Gogo completed this.'),href:'/dashboard/agent'})),
  ].slice(0,8)

  return (
    <div className="relative mx-auto max-w-[1120px] pb-4">
      <div className="rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-5 py-7 shadow-[0_18px_52px_rgba(45,32,22,.055)] backdrop-blur-xl sm:px-8 sm:py-9 xl:px-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[9px] font-extrabold uppercase tracking-[.18em] text-gogo-teal">One Gogo · WhatsApp + app + dashboard</div>
            <div className="mt-3 text-[13px] font-semibold text-gogo-ink-3">Good {period(now,tz)}, {name}</div>
          </div>
          <GogoCharacter state={gogoState} size={66} showStatus={working>0||watching>0||waiting>0}/>
        </div>

        <h1 className="mt-5 max-w-[760px] font-serif text-[43px] leading-[.98] tracking-[-1.2px] text-gogo-ink sm:text-[58px]">{headline}</h1>
        <p className="mt-4 max-w-[680px] text-[13px] leading-6 text-gogo-ink-3">Tell Gogo the outcome. It can work, watch and come back when you are needed. Sending, booking, sharing and spending still stop for approval.</p>

        <div className="mt-6 grid gap-2 sm:max-w-[560px] sm:grid-cols-3">
          <Link href="/dashboard/agent" className="rounded-[18px] bg-gogo-orange/10 px-4 py-3"><div className="text-[22px] font-extrabold text-gogo-orange">{working}</div><div className="text-[10px] font-bold text-gogo-ink-3">working</div></Link>
          <Link href="/dashboard/today" className="rounded-[18px] bg-gogo-teal-soft px-4 py-3"><div className="text-[22px] font-extrabold text-gogo-teal">{watching}</div><div className="text-[10px] font-bold text-gogo-ink-3">watching</div></Link>
          <Link href="/dashboard/agent" className="rounded-[18px] bg-emerald-50 px-4 py-3"><div className="text-[22px] font-extrabold text-emerald-700">{waiting}</div><div className="text-[10px] font-bold text-gogo-ink-3">need you</div></Link>
        </div>

        <div className="mt-6 max-w-[780px]"><CommandBar /></div>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-serif text-[27px] text-gogo-ink">Gogo is on it</h2>
        <Link href="/dashboard/today" className="text-[10px] font-extrabold uppercase tracking-[.12em] text-gogo-teal">See today →</Link>
      </div>

      {feed.length ? <div className="mt-3 grid gap-3 md:grid-cols-2">{feed.map(item=><FeedCard key={item.id} item={item}/>)}</div> : <div className="mt-3 rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/80 p-6"><div className="font-semibold text-gogo-ink">Nothing urgent right now.</div><div className="mt-1 text-[12px] text-gogo-ink-3">Ask Gogo to handle something, watch a change, or remember something for later.</div></div>}

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <Link href="/dashboard/today" className="rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/80 p-5"><div className="text-[9px] font-extrabold uppercase tracking-[.14em] text-gogo-teal">Today</div><div className="mt-2 font-serif text-[24px] text-gogo-ink">What matters now</div><div className="mt-2 text-[12px] leading-5 text-gogo-ink-3">Proactive changes, reminders, watches and things Gogo found.</div></Link>
        <Link href="/dashboard/memory" className="rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/80 p-5"><div className="text-[9px] font-extrabold uppercase tracking-[.14em] text-gogo-teal">Memory</div><div className="mt-2 font-serif text-[24px] text-gogo-ink">Same context everywhere</div><div className="mt-2 text-[12px] leading-5 text-gogo-ink-3">Private documents and context shared across surfaces.</div></Link>
        <Link href="/dashboard/agent" className="rounded-[22px] border border-gogo-ink/8 bg-gogo-surface/80 p-5"><div className="text-[9px] font-extrabold uppercase tracking-[.14em] text-gogo-teal">Activity</div><div className="mt-2 font-serif text-[24px] text-gogo-ink">See how Gogo worked</div><div className="mt-2 text-[12px] leading-5 text-gogo-ink-3">Runs, approvals, goals, watchers and advanced controls.</div></Link>
      </div>
    </div>
  )
}
