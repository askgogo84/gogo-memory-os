// Needs you · On radar · Recent tabs and their cards, shared by Home and Tasks. Every card carries its own Gogo
// state (approval, watcher, flight, done…) and a short live line, as in the approved 21 Oct mock.
import Link from 'next/link'
import { Companion } from '@/components/gogo/companion'
import { ConfirmDoneCard } from './confirm-done-card'
import type { FeedItem, FeedTab, TaskFeed } from '@/lib/dashboard/task-feed'

const TAG_TONE: Record<FeedTab, string> = { need: 'bg-[#3a2a10] text-[#f0c26b]', radar: 'bg-[#13253a] text-[#8cc2ff]', recent: 'bg-[#132a27] text-[#5fd3c3]' }
const LABEL: Record<FeedTab, string> = { need: 'Needs you', radar: 'On radar', recent: 'Recent' }

export function FeedTabs({ base, tab, feed, needCount, extra }: { base: string; tab: string; feed: TaskFeed; needCount: number; extra?: { key: string; label: string; count: number } }) {
  const tabs: { key: string; label: string; count: number | string }[] = [
    { key: 'need', label: LABEL.need, count: needCount },
    { key: 'radar', label: LABEL.radar, count: feed.radarCount ?? feed.radar.length },
    { key: 'recent', label: LABEL.recent, count: feed.recent.length },
    ...(extra ? [extra] : []),
  ]
  return <div role="tablist" aria-label="Your tasks" className="flex gap-1 overflow-x-auto border-b border-[#1f1f1f]">
    {tabs.map(t => {
      const on = t.key === tab
      return <Link key={t.key} role="tab" aria-selected={on} href={`${base}?tab=${t.key}`} scroll={false}
        className={`-mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[15px] font-medium ${on ? 'border-[#2fb8a6] text-[#f2efea]' : 'border-transparent text-[#9a9a96] hover:text-[#f2efea]'}`}>
        {t.label}<span className="text-[#8a8a86]">{t.count}</span>
      </Link>
    })}
  </div>
}

export function FeedCard({ item, size = 56 }: { item: FeedItem; size?: number }) {
  return <Link href={item.href} className="flex items-center gap-3 rounded-[14px] border border-[#222] bg-[#121212] py-2 pl-1.5 pr-4 text-left transition hover:border-[#2fb8a6]/50 hover:bg-[#141a19]">
    <span className="grid shrink-0 place-items-center" style={{ width: size + 4 }}><Companion state={item.state} size={size}/></span>
    <span className="flex min-w-0 flex-1 flex-col gap-1 py-1">
      <span className="flex items-start justify-between gap-3">
        <span className="text-[15px] font-medium leading-snug text-[#f2efea]">{item.title}</span>
        <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TAG_TONE[item.tab]}`}>{item.tag}</span>
      </span>
      {item.sub && <span className="line-clamp-2 text-[13px] leading-[1.45] text-[#9a9a96]">{item.sub}</span>}
      <span className="flex items-center justify-between gap-3 text-[12px]"><span className="text-[#c9a77c]">{item.live}</span><span className="shrink-0 font-medium text-[#77d2c4]">{item.action} →</span></span>
    </span>
  </Link>
}

export function FeedItems({ items, size, empty }: { items: FeedItem[]; size?: number; empty: string }) {
  if (!items.length) return <p className="py-5 text-[15px] text-[#a8a8a4]">{empty}</p>
  return <div className="flex flex-col gap-2">{items.map(item => item.confirm ? <ConfirmDoneCard key={item.id} item={item} size={size}/> : <FeedCard key={item.id} item={item} size={size}/>)}</div>
}
