import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { getMadeForYou, makeKind, MAKE_KINDS } from '@/lib/dashboard/make'
import { GogoAgent } from '@/components/gogo/gogo-agent'

export const dynamic = 'force-dynamic'

function when(v: string | null) {
  if (!v || !Number.isFinite(Date.parse(v))) return ''
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(v))
}

// Duet parity step 3 (approved 22 Oct mock, screen 3): finished work Gogo made for you.
export default async function MakePage({ searchParams }: { searchParams?: Promise<{ kind?: string }> } = {}) {
  const session = await getSession()
  const kind = makeKind((await searchParams)?.kind)
  const made = await getMadeForYou(String(session?.telegramId || ''), kind)
  return (
    <div className="mx-auto w-full max-w-[1000px] pb-10">
      <header className="pb-4 lg:pt-4">
        <div className="final-dark-eyebrow">Gogo’s finished work</div>
        <h1 className="final-dark-title mt-1.5 text-[28px] sm:text-[32px]">Make</h1>
        <p className="mt-1.5 text-[15px] text-[#a8a8a4]">Briefs, comparisons, plans and trackers Gogo made for you. Documents you sent are in <Link href="/dashboard/library" className="text-[#77d2c4] underline">Library</Link>.</p>
      </header>
      <nav aria-label="Filter finished work" className="flex gap-2 overflow-x-auto pb-3">
        {MAKE_KINDS.map(k => {
          const on = k.key === kind
          return <Link key={k.key} href={k.key === 'all' ? '/dashboard/make' : `/dashboard/make?kind=${k.key}`} scroll={false} aria-current={on ? 'page' : undefined}
            className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[14px] font-medium ${on ? 'border-[#2fb8a6] bg-[#132a27] text-[#f2efea]' : 'border-[#262626] bg-[#151515] text-[#9a9a96] hover:text-[#f2efea]'}`}>
            {k.label}<span className="text-[#8a8a86]">{made.counts[k.key]}</span>
          </Link>
        })}
      </nav>
      {!made.ok && <p className="py-5 text-[15px] text-[#d9a441]">Couldn’t load your finished work right now. Try again shortly.</p>}
      {made.ok && !made.items.length && <div className="flex flex-col items-center gap-2 py-10 text-center">
        <GogoAgent state="idle" size={96}/>
        <p className="max-w-[420px] text-[15px] text-[#a8a8a4]">Nothing here yet. Ask Gogo for a research brief, a price comparison or a trip plan and it will be saved here.</p>
        <Link href="/dashboard/chat" className="mt-2 flex min-h-11 items-center rounded-full bg-[#2fb8a6] px-5 text-[15px] font-semibold text-[#04201c]">Ask Gogo</Link>
      </div>}
      {made.items.length > 0 && <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {made.items.map(item => <li key={item.id}>
          <Link href={item.href} className="flex h-full min-h-[140px] flex-col gap-2 rounded-[16px] border border-[#222] bg-[#121212] p-4 hover:border-[#2fb8a6]/50">
            <span className="flex items-center justify-between gap-2">
              <span className="rounded-full bg-[#132a27] px-2.5 py-0.5 text-[12px] font-medium text-[#5fd3c3]">{item.label}</span>
              <span className="text-[12px] text-[#8a8a86]">{when(item.updatedAt)}</span>
            </span>
            <span className="text-[16px] font-medium leading-snug text-[#f2efea]">{item.title}</span>
            {item.subtitle && <span className="line-clamp-2 text-[13px] leading-[1.45] text-[#9a9a96]">{item.subtitle}</span>}
            <span className="mt-auto text-[13px] font-medium text-[#77d2c4]">Open →</span>
          </Link>
        </li>)}
      </ul>}
    </div>
  )
}
