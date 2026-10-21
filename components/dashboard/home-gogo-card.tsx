'use client'

// Home's live Gogo: the current task's character and live line. Tapping it opens the Gogo sheet on phones and
// tablets; on wide screens the right panel is already showing, so it opens the task itself.
import Link from 'next/link'
import { GogoAgent } from '@/components/gogo/gogo-agent'
import { useGogoLive } from './gogo-live'

export function HomeGogoCard() {
  const { hero, openSheet } = useGogoLive()
  const inner = <>
    <span className="grid w-[96px] shrink-0 place-items-center"><GogoAgent state={hero.state} size={92}/></span>
    <span className="flex min-w-0 flex-col gap-1 text-left">
      <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#ef7a27]">{hero.name}</span>
      <span className="text-[16px] font-medium leading-snug text-[#f2efea]" aria-live="polite">{hero.live}</span>
      <span className="truncate text-[13px] text-[#9a9a96]">{hero.task}<span className="xl:hidden"> · tap to see everything</span></span>
    </span>
  </>
  const cls = 'flex w-full items-center gap-3 rounded-[18px] border border-[#3b312b] py-2 pl-1 pr-4 bg-[radial-gradient(circle_at_12%_55%,#2a1c12_0%,#141210_62%)]'
  return <>
    <button type="button" onClick={openSheet} className={`${cls} xl:hidden`}>{inner}</button>
    {hero.href ? <Link href={hero.href} className={`${cls} hidden xl:flex`}>{inner}</Link> : <div className={`${cls} hidden xl:flex`}>{inner}</div>}
  </>
}
