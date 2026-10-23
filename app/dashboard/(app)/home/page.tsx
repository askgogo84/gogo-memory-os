import {getServiceNoticesForPage,EMPTY_SERVICE_NOTICES} from '@/lib/dashboard/service-notices'
import {ServiceNoticeCards} from '@/components/dashboard/service-notice-cards'
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

// Shortcuts open the chat with a ready prompt; Gogo still asks before it books, pays or sends anything.
const SHORTCUTS=[
  {icon:'◷',label:'Book a table or appointment',prompt:'Book a table for 2 tonight at 8'},
  {icon:'₹',label:'Compare prices',prompt:'Compare iPhone 16 256GB prices'},
  {icon:'☏',label:'Call a place for me',prompt:'Call a restaurant and book a table for me'},
  {icon:'✓',label:'Plan my day',prompt:'Plan my day'},
]

function Lines({lines,empty}:{lines:HomeLine[];empty:string}){
  if(!lines.length)return <p className="py-1 text-[15px] text-[#a8a8a4]">{empty}</p>
  return <div className="flex flex-col">{lines.map(l=><Link key={l.id} href={l.href} className="flex min-h-11 items-center gap-4 text-[15px] text-[#f2efea] hover:text-[#77d2c4]">
    <span className="w-14 shrink-0 text-[14px] text-[#9a9a96]">{l.when}</span><span className="min-w-0 flex-1 truncate">{l.title}</span>
  </Link>)}</div>
}

// Home v2 (approved 23 Oct mock, Duet brief phase 1): Gogo and the greeting, the Ask box, then one glance at the day —
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

  return <div className="mx-auto w-full max-w-[1040px] pb-10">
    <section className="mx-auto flex max-w-[780px] flex-col items-center gap-4 pb-8 pt-2 text-center">
      <HomeGogo/>
      <div>
        <h1 className="text-[28px] font-medium leading-[1.15] tracking-[-0.02em] text-[#a8a8a4] sm:text-[34px]">{greeting(now,tz)}, <span className="text-[#f2efea]">{name}.</span></h1>
        <p className="mx-auto mt-2 max-w-[560px] text-[15px] leading-6 text-[#8a8a86]">{summary}</p>
      </div>
      <HomeAsk/>
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {SHORTCUTS.map(s=><Link key={s.label} href={`/dashboard/chat?prompt=${encodeURIComponent(s.prompt)}`} className="flex min-h-[56px] items-center gap-2.5 rounded-[16px] border border-[#222] bg-[#121212] px-3 py-3 text-left text-[14px] font-medium leading-snug text-[#f2efea] hover:border-[#2fb8a6]/50">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#132a27] font-semibold text-[#2fb8a6]">{s.icon}</span>{s.label}
        </Link>)}
      </div>
      <p className="text-[12px] text-[#8a8a86]">Safe mode on · Gogo asks before it books, pays or sends anything · {dayLabel(now,tz)}</p>
    </section>

    <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-2">
      <div className="flex flex-col gap-8">
        <section aria-labelledby="home-now" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between"><h2 id="home-now" className="final-dark-eyebrow">Needs you now</h2><span className="text-[14px] text-[#a8a8a4]">{serviceNotices.unavailable?'—':nowCount}</span></div>
          <FeedItems items={sections.now} empty={serviceNotices.total||serviceNotices.unavailable?'':'Nothing is waiting for you.'}/>
          {(serviceNotices.total>0||serviceNotices.unavailable)&&<div className="final-dark-panel px-4"><ServiceNoticeCards notices={serviceNotices.items} unavailable={serviceNotices.unavailable}/></div>}
        </section>
        <section aria-labelledby="home-handling" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between"><h2 id="home-handling" className="final-dark-eyebrow">Gogo is handling</h2><span className="text-[14px] text-[#a8a8a4]">{sections.handlingTotal}</span></div>
          <FeedItems items={sections.handling.slice(0,6)} empty="Nothing is running in the background. Ask Gogo to watch a price, a fare or a seat."/>
          {sections.handlingTotal>6&&<Link href="/dashboard/tasks?tab=radar" className="self-start text-[14px] font-medium text-[#77d2c4] hover:underline">All {sections.handlingTotal} in Tasks →</Link>}
        </section>
      </div>
      <div className="flex flex-col gap-8">
        <section aria-labelledby="home-soon" className="flex flex-col gap-1">
          <h2 id="home-soon" className="final-dark-eyebrow">Coming up today</h2>
          <Lines lines={sections.comingUp} empty="Nothing else scheduled today."/>
        </section>
        <details className="group flex flex-col gap-2">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between"><span className="final-dark-eyebrow">Can wait · {waitCount}</span><span aria-hidden="true" className="text-[#9a9a96] transition group-open:rotate-180">⌄</span></summary>
          <div className="flex flex-col gap-3 pt-1">
            <FeedItems items={sections.canWait} size={48} empty={sections.canWaitLater.length?'':'Nothing parked.'}/>
            {sections.canWaitLater.length>0&&<Lines lines={sections.canWaitLater} empty=""/>}
          </div>
        </details>
        <section aria-labelledby="home-done" className="flex flex-col gap-2">
          <h2 id="home-done" className="final-dark-eyebrow">Done today</h2>
          {feed.recentUnavailable
            ?<p className="py-1 text-[15px] text-[#b7b7b7]">Recent updates could not be loaded. Open Tasks to try again.</p>
            :<FeedItems items={sections.doneToday.slice(0,4)} size={48} empty="Nothing finished yet today."/>}
          <Link href="/dashboard/tasks?tab=recent" className="self-start text-[14px] font-medium text-[#77d2c4] hover:underline">Everything Gogo did →</Link>
        </section>
      </div>
    </div>
  </div>
}
