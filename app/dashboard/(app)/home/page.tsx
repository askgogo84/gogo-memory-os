import {getServiceNoticesForPage,EMPTY_SERVICE_NOTICES} from '@/lib/dashboard/service-notices'
import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders, getUpcomingReminders } from '@/lib/dashboard/queries'
import { getTaskFeed, EMPTY_FEED } from '@/lib/dashboard/task-feed'
import { FeedItems } from '@/components/dashboard/feed-list'
import { buildHomeSections, homeSummary, type HomeLine } from '@/lib/dashboard/home-sections'
import { HomeAsk, HomeGogo } from '@/components/dashboard/home-ask'

export const dynamic='force-dynamic'

function dayLabel(now:Date,tz:string){
  return new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',timeZone:tz}).format(now)
}
function greeting(now:Date,tz:string){
  const h=Number(new Intl.DateTimeFormat('en-US',{hour:'2-digit',hourCycle:'h23',timeZone:tz}).format(now))
  return h<12?'Good morning':h<17?'Good afternoon':'Good evening'
}

/** "[Action Required] Payment Failed And Shutdown Coming Soon" → readable and short; the full text stays in Tasks. */
function noticeTitle(raw:string){
  const billing=/^Review service billing notice/i.test(String(raw||''))
  const rest=String(raw||'').replace(/^Review service (?:billing )?notice\s*[—-]\s*/i,'').replace(/\[(?:action required|important|urgent)\]\s*/ig,'').trim()
  return `${billing?'Billing notice':'Service notice'}${rest?`: ${rest}`:''}`.slice(0,90)
}
/** The watch line's end ("… · ends Sun") shown on the right, like the mock's "till Sun". */
function handlingWhen(sub:string){
  const m=String(sub||'').match(/(?:ends?|till|until)\s+([^·]+)$/i)
  return m?`till ${m[1].trim()}`.slice(0,24):''
}

function Lines({lines,empty}:{lines:HomeLine[];empty:string}){
  if(!lines.length)return <p className="py-1 text-[15px] text-[#a8a8a4]">{empty}</p>
  return <div className="flex flex-col">{lines.map(l=><Link key={l.id} href={l.href} className="flex min-h-11 items-center gap-4 text-[15px] text-[#f2efea] hover:text-[#77d2c4]">
    <span className="w-14 shrink-0 text-[14px] text-[#9a9a96]">{l.when}</span><span className="min-w-0 flex-1 truncate">{l.title}</span>
  </Link>)}</div>
}

// Home v2 (approved 22 Oct mock, Duet brief phase 1). 23 Oct feedback "home looks completely out of design": the live
// page had drifted to a centred hero (big character, four shortcut tiles) and full email bodies in Needs you. Back
// to the mock: Gogo beside a left-aligned greeting, one Ask bar, then —
// Needs you now · Gogo is handling (left) and Coming up · Can wait · Done today (right; stacked on the phone).
// Every task card keeps its own companion character state; the character is drawn through Companion so people
// can pick other characters later.
export default async function HomePage(){
  const session=await getSession()
  const tg=session?.telegramId||''
  const tgNum=parseInt(tg,10)
  const [{data:user},today,upcoming,feed,serviceNotices]=await Promise.all([
    session&&Number.isFinite(tgNum)?supabaseAdmin.from('users').select('name,timezone').eq('telegram_id',tgNum).maybeSingle():Promise.resolve({data:null as any}),
    session?getTodayReminders(tg):Promise.resolve({ok:true as const,reminders:[]}),
    session?getUpcomingReminders(tg):Promise.resolve([]),
    session?getTaskFeed(tg):Promise.resolve(EMPTY_FEED),
    session?getServiceNoticesForPage(tg):Promise.resolve(EMPTY_SERVICE_NOTICES),
  ])

  const tz=user?.timezone||'Asia/Kolkata'
  const now=new Date()
  const name=user?.name?.trim().split(/\s+/)[0]||'there'
  const sections=buildHomeSections({feed,today:today.ok?today.reminders:[],upcoming,now,tz})
  const nowCount=sections.now.length+serviceNotices.total
  const summary=serviceNotices.unavailable
    ? 'Some attention items could not be loaded. Refresh to check service notices.'
    : homeSummary(sections,serviceNotices.total)
  const waitCount=sections.canWait.length+sections.canWaitLater.length

  return <div className="mx-auto w-full max-w-[1040px] pb-10 lg:pt-4">
    {/* Header: Gogo beside the greeting, left-aligned (approved 22 Oct Home mock). */}
    <section className="flex items-center gap-3 pb-5">
      <HomeGogo compact/>
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#f2efea] sm:text-[32px]">{greeting(now,tz)}, {name}.</h1>
        <p className="mt-1 text-[15px] leading-6 text-[#a8a8a4]">{summary}</p>
      </div>
    </section>
    <HomeAsk compact/>
    <p className="pb-7 pt-2 text-[12px] text-[#8a8a86]">Safe mode on · Gogo asks before it books, pays or sends anything · {dayLabel(now,tz)}</p>

    <div className="grid grid-cols-1 items-start gap-7 lg:grid-cols-2">
      <div className="flex flex-col gap-7">
        <section aria-labelledby="home-now" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between"><h2 id="home-now" className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[#2fb8a6]">Needs you now</h2><span className="text-[13px] text-[#a8a8a4]">{serviceNotices.unavailable?'—':nowCount}</span></div>
          <FeedItems items={sections.now} size={44} empty={serviceNotices.total||serviceNotices.unavailable?'':'Nothing is waiting for you.'}/>
          {serviceNotices.unavailable&&<p role="status" className="text-[14px] text-[#d9a441]">Service notices could not be loaded. Refresh to check.</p>}
          {serviceNotices.items.map(n=><Link key={n.id} href="/dashboard/tasks" className="flex flex-col gap-1 rounded-[14px] border border-[#222] bg-[#121212] px-4 py-3 hover:border-[#2fb8a6]/50">
            <span className="flex items-start justify-between gap-3"><span className="line-clamp-1 text-[15px] font-medium text-[#f2efea]">{noticeTitle(n.title)}</span><span className="shrink-0 rounded-full bg-[#3a2a10] px-2.5 py-0.5 text-[12px] font-medium text-[#f0c26b]">Review</span></span>
            <span className="line-clamp-1 text-[13px] text-[#9a9a96]">{n.summary}</span>
            <span className="text-[12px] text-[#9a9a96]">Email from the provider · No payment or account change is authorized{(n as any).copies>1?` · sent ${(n as any).copies} times`:''}</span>
          </Link>)}
        </section>
        <section aria-labelledby="home-handling" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between"><h2 id="home-handling" className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[#a8a8a4]">Gogo is handling</h2><span className="text-[13px] text-[#a8a8a4]">{sections.handlingTotal}</span></div>
          {sections.handling.length
            ?<div className="flex flex-col overflow-hidden rounded-[14px] border border-[#222] bg-[#121212]">{sections.handling.slice(0,6).map(h=><Link key={h.id} href={h.href} className="flex min-h-12 items-center gap-3 border-b border-[#222] px-4 py-2.5 last:border-b-0 hover:bg-[#141a19]">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${h.state==='watcher'?'bg-[#9a9a96]':'bg-[#2fb8a6]'}`}/>
                <span className="min-w-0 flex-1 truncate text-[15px] text-[#f2efea]">{h.title}</span>
                <span className="shrink-0 text-[13px] text-[#9a9a96]">{handlingWhen(h.sub)}</span>
              </Link>)}</div>
            :<p className="py-1 text-[15px] text-[#a8a8a4]">Nothing is running in the background. Ask Gogo to watch a price, a fare or a seat.</p>}
          {sections.handlingTotal>6&&<Link href="/dashboard/tasks?tab=radar" className="self-start text-[14px] font-medium text-[#77d2c4] hover:underline">All {sections.handlingTotal} in Tasks →</Link>}
        </section>
      </div>
      <div className="flex flex-col gap-7">
        <section aria-labelledby="home-soon" className="flex flex-col gap-1">
          <h2 id="home-soon" className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[#a8a8a4]">Coming up today</h2>
          <Lines lines={sections.comingUp} empty="Nothing else scheduled today."/>
        </section>
        <details className="group flex flex-col gap-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between"><span className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[#a8a8a4]">Can wait · {waitCount}</span><span aria-hidden="true" className="text-[#9a9a96] transition group-open:rotate-180">⌄</span></summary>
          <div className="flex flex-col gap-3 pt-1">
            <FeedItems items={sections.canWait} size={40} empty={sections.canWaitLater.length?'':'Nothing parked.'}/>
            {sections.canWaitLater.length>0&&<Lines lines={sections.canWaitLater} empty=""/>}
          </div>
        </details>
        <section aria-labelledby="home-done" className="flex flex-col gap-1">
          <h2 id="home-done" className="text-[13px] font-semibold uppercase tracking-[0.04em] text-[#a8a8a4]">Done today</h2>
          {feed.recentUnavailable
            ?<p className="py-1 text-[15px] text-[#b7b7b7]">Recent updates could not be loaded. Open Tasks to try again.</p>
            :sections.doneToday.length
              ?<div className="flex flex-col">{sections.doneToday.slice(0,4).map(d=><Link key={d.id} href={d.href} className="flex min-h-11 items-center gap-2.5 text-[15px] text-[#f2efea] hover:text-[#77d2c4]">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2fb8a6" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>
                  <span className="min-w-0 flex-1 truncate">{d.title}</span></Link>)}</div>
              :<p className="py-1 text-[15px] text-[#a8a8a4]">Nothing finished yet today.</p>}
          <Link href="/dashboard/tasks?tab=recent" className="self-start text-[14px] font-medium text-[#77d2c4] hover:underline">Everything Gogo did →</Link>
        </section>
      </div>
    </div>
  </div>
}
