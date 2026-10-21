import {getServiceNoticesForPage,EMPTY_SERVICE_NOTICES} from '@/lib/dashboard/service-notices'
import {ServiceNoticeCards} from '@/components/dashboard/service-notice-cards'
import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getTodayReminders } from '@/lib/dashboard/queries'
import { reminderStateLabel } from '@/lib/dashboard/reminder-state'
import { getTaskFeed, feedTab, EMPTY_FEED } from '@/lib/dashboard/task-feed'
import { FeedItems, FeedTabs } from '@/components/dashboard/feed-list'
import { HomeAsk, HomeGogo } from '@/components/dashboard/home-ask'

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

// Shortcuts open the chat with a ready prompt; Gogo still asks before it books, pays or sends anything.
const SHORTCUTS=[
  {icon:'◷',label:'Book a table or appointment',prompt:'Book a table for 2 tonight at 8'},
  {icon:'₹',label:'Compare prices',prompt:'Compare iPhone 16 256GB prices'},
  {icon:'☏',label:'Call a place for me',prompt:'Call a restaurant and book a table for me'},
  {icon:'✓',label:'Plan my day',prompt:'Plan my day'},
]

// Approved 21 Oct mock (Muse + Wajo): greeting, live Gogo, Ask box, four shortcuts, then Needs you · On radar ·
// Recent with a Gogo on every card, and today's reminders.
export default async function HomePage({searchParams}:{searchParams?:Promise<{tab?:string}>}={}){
  const session=await getSession()
  const tg=session?.telegramId||''
  const tgNum=parseInt(tg,10)
  const tab=feedTab((await searchParams)?.tab)
  const [{data:user},today,feed,serviceNotices]=await Promise.all([
    session&&Number.isFinite(tgNum)?supabaseAdmin.from('users').select('name,timezone').eq('telegram_id',tgNum).maybeSingle():Promise.resolve({data:null as any}),
    session?getTodayReminders(tg):Promise.resolve({ok:true as const,reminders:[]}),
    session?getTaskFeed(tg):Promise.resolve(EMPTY_FEED),
    session?getServiceNoticesForPage(tg):Promise.resolve(EMPTY_SERVICE_NOTICES),
  ])

  const tz=user?.timezone||'Asia/Kolkata'
  const now=new Date()
  const name=user?.name?.trim().split(/\s+/)[0]||'there'
  // A cancelled reminder is not part of today.
  const reminders=(today.ok?today.reminders:[]).filter((r:any)=>r.status!=='cancelled'&&r.delivery_state!=='cancelled')
  const pending=reminders.filter((r:any)=>!r.sent)
  const needCount=feed.need.length+serviceNotices.total
  const working=feed.radar.filter(i=>i.tag==='Working now').length

  const summary=serviceNotices.unavailable
    ? 'Some attention items could not be loaded. Refresh to check service notices.'
    : needCount
    ? `${needCount} thing${needCount===1?' needs':'s need'} your say-so. Gogo keeps the rest moving in the background.`
    : working
      ? `Gogo is working on ${working} task${working===1?'':'s'}. You can leave — it stops and asks if anything needs you.`
      : pending.length
        ? `You have ${pending.length} reminder${pending.length===1?'':'s'} today. Gogo is quiet unless something changes or needs you.`
        : 'Your day is clear. Tell Gogo what matters and it will carry the next safe steps.'

  // Wajo layout (21 Oct feedback): Gogo, the greeting and a big chat box centred in the first screen, shortcuts under
  // it, then Needs you · On radar · Recent below the fold.
  return <div className="mx-auto w-full max-w-[780px] pb-10">
    <section className="flex min-h-[calc(100svh-9rem)] flex-col items-center justify-center gap-4 pb-8 pt-2 text-center lg:min-h-[calc(100vh-7rem)]">
      <HomeGogo/>
      <div>
        <h1 className="text-[28px] font-medium leading-[1.15] tracking-[-0.02em] text-[#a8a8a4] sm:text-[34px]">{greeting(now,tz)}, <span className="text-[#f2efea]">{name}.</span></h1>
        <p className="mx-auto mt-2 max-w-[560px] text-[15px] leading-6 text-[#8a8a86]">{summary}</p>
      </div>
      <HomeAsk/>
      <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
        {SHORTCUTS.map(s=><Link key={s.label} href={`/dashboard/chat?prompt=${encodeURIComponent(s.prompt)}`} className="flex min-h-[64px] items-center gap-2.5 rounded-[16px] border border-[#222] bg-[#121212] px-3 py-3 text-left text-[14px] font-medium leading-snug text-[#f2efea] hover:border-[#2fb8a6]/50 sm:min-h-[96px] sm:flex-col sm:items-start sm:justify-between">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-[#132a27] font-semibold text-[#2fb8a6]">{s.icon}</span>{s.label}
        </Link>)}
      </div>
      <p className="text-[12px] text-[#8a8a86]">Safe mode on · Gogo asks before it books, pays or sends anything · {dayLabel(now,tz)}</p>
    </section>

    <section aria-label="Your tasks" className="flex flex-col gap-3">
      <FeedTabs base="/dashboard/home" tab={tab} feed={feed} needCount={serviceNotices.unavailable?0:needCount}/>
      {tab==='need'&&<div className="flex flex-col gap-2">
        <FeedItems items={feed.need} empty={serviceNotices.total||serviceNotices.unavailable?'':'Nothing is waiting for you.'}/>
        {(serviceNotices.total>0||serviceNotices.unavailable)&&<div className="final-dark-panel px-4"><ServiceNoticeCards notices={serviceNotices.items} unavailable={serviceNotices.unavailable}/></div>}
      </div>}
      {tab==='radar'&&<FeedItems items={feed.radar} empty="Nothing is running in the background. Ask Gogo to watch a price, a fare or a seat."/>}
      {tab==='recent'&&(feed.recentUnavailable
        ?<p className="py-5 text-[15px] text-[#b7b7b7]">Recent updates could not be loaded. Open Tasks to try again.</p>
        :<FeedItems items={feed.recent.slice(0,6)} empty="No finished tasks yet. They will appear here when Gogo has something to report."/>)}
      {tab!=='need'&&<Link href={`/dashboard/tasks?tab=${tab}`} className="self-start text-[14px] font-medium text-[#77d2c4] hover:underline">All in Tasks →</Link>}
    </section>

    <section className="final-dark-panel mt-6 overflow-hidden" aria-labelledby="today-reminders">
      <div className="flex items-center justify-between px-4 py-3.5"><h2 id="today-reminders" className="final-dark-eyebrow">Today’s reminders</h2><span className="text-[14px] text-[#a8a8a4]">{reminders.length}</span></div>
      <div className="border-t border-[#1f1f1f] px-4">
        {reminders.length?reminders.slice(0,6).map((r:any)=><div key={String(r.id)} className="flex items-start gap-3 border-t border-[#1f1f1f] py-3 first:border-t-0">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.status==='completed'||['read','delivered'].includes(r.delivery_state||'')?'bg-[#7fb069]':'bg-[#6a6a6a]'}`}/>
          <div className="min-w-0 flex-1"><div className="truncate text-[15px] font-medium text-[#f2efea]">{r.message||'Reminder'}</div><div className="mt-0.5 text-[13px] text-[#a8a8a4]">{reminderStateLabel(r)}</div></div>
          <div className="shrink-0 text-[13px] text-[#9a9a9a]">{clock(r.remind_at,tz)}</div>
        </div>):<div className="py-4 text-[15px] text-[#a8a8a4]">No reminders today.</div>}
      </div>
    </section>
  </div>
}
