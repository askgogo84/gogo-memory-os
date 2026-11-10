// Tasks › Overview, as in the approved mock "Tasks: who does what" (Addendum 5). Server-rendered, no client state.
import Link from 'next/link'
import { OWNERSHIP_HINT, OWNERSHIP_LABEL, OWNERSHIP_ORDER, type DoneState } from '@/lib/agent/task-ownership'
import { TIME_SAVED_DEFAULT, TIME_SAVED_MINUTES, minutesLabel, type BoardItem, type GoalBoard } from '@/lib/dashboard/goal-board'

const TONE: Partial<Record<DoneState, string>> = {
  verified: 'bg-[#132a27] text-[#5fd3c3]',
  done_unverified: 'bg-[#1f1f1f] text-[#d8d8d3]',
  draft: 'bg-[#3a2a10] text-[#f0c26b]',
  waiting_approval: 'bg-[#3a2a10] text-[#f0c26b]',
  blocked: 'bg-[#35221d] text-[#e4b6a6]',
  failed: 'bg-[#35221d] text-[#e4b6a6]',
  unknown: 'bg-[#35221d] text-[#e4b6a6]',
  running: 'bg-[#13253a] text-[#8cc2ff]',
  queued: 'bg-[#13253a] text-[#8cc2ff]',
  waiting_external: 'bg-[#1f1f1f] text-[#d8d8d3]',
  needs_you: 'bg-[#3a2a10] text-[#f0c26b]',
}
const ACTION: Partial<Record<DoneState, string>> = { draft: 'Review', waiting_approval: 'Review', blocked: 'Open', unknown: 'Check', running: 'Watch', queued: 'Watch', needs_you: 'Open', failed: 'Details' }

/** The prompt "Give Gogo a list" opens chat with. */
export const LIST_PROMPT = 'Gogo, here are the things I need to get done this week: '

function Card({ item }: { item: BoardItem }) {
  return <Link href={item.href} className="flex flex-col gap-1.5 rounded-[14px] border border-[#222] bg-[#121212] px-3.5 py-3 transition hover:border-[#2fb8a6]/50 hover:bg-[#141a19]">
    <span className="flex items-start justify-between gap-3">
      <span className="text-[15px] font-medium leading-snug text-[#f2efea]">{item.title}</span>
      <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-medium ${TONE[item.state] || TONE.waiting_external}`}>{item.label}</span>
    </span>
    {item.sub && <span className="line-clamp-2 text-[13px] leading-[1.45] text-[#9a9a96]">{item.sub}</span>}
    {ACTION[item.state] && <span className="self-end text-[13px] font-semibold text-[#77d2c4]">{ACTION[item.state]} →</span>}
  </Link>
}

function Metric({ value, label, tone, children }: { value: string; label: string; tone?: string; children?: React.ReactNode }) {
  return <div className="flex flex-col gap-1 rounded-[14px] border border-[#1f1f1f] bg-[#111111] p-3">
    <span className={`text-[22px] font-semibold ${tone || 'text-[#f2efea]'}`}>{value}</span>
    <span className="text-[13px] text-[#a8a8a4]">{label}</span>
    {children}
  </div>
}

export function GoalBoardView({ board, notices }: { board: GoalBoard; notices?: React.ReactNode }) {
  const m = board.metrics
  const total = m.worked + m.failed
  const handed = m.handedToGogo + m.ownTodos
  const empty = OWNERSHIP_ORDER.every(o => !board.groups[o].length) && !board.done.length
  return <div className="flex flex-col gap-4">
    {board.unavailable && <p className="text-[14px] text-[#f0c26b]">Some of your tasks could not be loaded just now, so this may be incomplete.</p>}
    {notices}
    <h2 className="text-[13px] font-medium text-[#8a8a86]">Last 30 days</h2>
    <section aria-label="Last 30 days" className="-mt-2 grid grid-cols-2 gap-2">
      <Metric value={String(m.doneChecked)} label="Done and checked"/>
      <Metric value={String(m.needYou)} label="Need you" tone={m.needYou ? 'text-[#f0c26b]' : undefined}/>
      <Metric value={minutesLabel(m.minutesSaved)} label="Time saved, estimated"><a href="#how-we-count" className="-my-2 flex min-h-11 items-center text-[13px] font-medium text-[#77d2c4]">How we count</a></Metric>
      <Metric value={total ? `${m.worked} of ${total}` : '—'} label="Runs that worked">
        <span className="text-[12px] text-[#8a8a86]">{m.failed} failed{m.unknown ? ` · ${m.unknown} not sure` : ''}{handed ? ` · ${m.handedToGogo} of ${handed} handed to Gogo` : ''}</span>
      </Metric>
    </section>
    <Link href={`/dashboard/chat?prompt=${encodeURIComponent(LIST_PROMPT)}`} className="flex min-h-12 items-center justify-center rounded-[12px] bg-[#2fb8a6] text-[15px] font-semibold text-[#06231f]">Give Gogo a list</Link>
    {empty && <p className="py-2 text-[15px] text-[#a8a8a4]">Nothing yet. Give Gogo a list of things to get done and you’ll see here who is doing each one.</p>}
    {OWNERSHIP_ORDER.map(o => board.groups[o].length ? <section key={o} aria-labelledby={`own-${o}`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between"><h2 id={`own-${o}`} className="text-[17px] font-semibold text-[#f2efea]">{OWNERSHIP_LABEL[o]}</h2><span className="text-[13px] text-[#8a8a86]">{board.groups[o].length}</span></div>
      <p className="text-[13px] text-[#9a9a96]">{OWNERSHIP_HINT[o]}</p>
      {board.groups[o].map(item => <Card key={item.id} item={item}/>)}
    </section> : null)}
    {board.done.length > 0 && <section aria-labelledby="own-done" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between"><h2 id="own-done" className="text-[17px] font-semibold text-[#f2efea]">Finished</h2><span className="text-[13px] text-[#8a8a86]">{board.counts.verified} checked</span></div>
      {board.done.map(item => <Card key={item.id} item={item}/>)}
    </section>}
    <section id="how-we-count" aria-labelledby="own-how" className="flex flex-col gap-2">
      <h2 id="own-how" className="text-[17px] font-semibold text-[#f2efea]">What “done” means here</h2>
      <div className="flex flex-col gap-2 rounded-[14px] border border-[#1f1f1f] bg-[#111111] px-3.5 py-3 text-[13px] leading-[1.5] text-[#c9c9c4]">
        <span><strong className="text-[#5fd3c3]">Done, checked</strong>: you marked it complete, or Gogo read the result back from the app it used.</span>
        <span><strong className="text-[#d8d8d3]">Done, not checked</strong>: finished, but nothing has read it back yet. Worth a look.</span>
        <span><strong className="text-[#f0c26b]">Draft ready</strong>: prepared, not sent. Never counted as done or as time saved.</span>
        <span><strong className="text-[#e4b6a6]">Not sure it happened</strong>: Gogo won’t retry until it can check.</span>
        <span>Time saved is an estimate: a fixed number of minutes for each finished task by kind ({Object.entries(TIME_SAVED_MINUTES).filter(([k]) => ['reminder', 'calendar', 'research', 'travel'].includes(k)).map(([k, v]) => `${k} ${v} min`).join(', ')}, anything else {TIME_SAVED_DEFAULT} min), over the last 30 days.</span>
      </div>
    </section>
  </div>
}
