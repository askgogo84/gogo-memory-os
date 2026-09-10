import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDashboardTasks } from '@/lib/dashboard/tasks'
import { CardError } from '@/components/dashboard/card-error'
import { TaskManager } from '@/components/dashboard/task-manager'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  const session = await getSession()
  const tg = session?.telegramId || ''
  const tgNum = parseInt(tg, 10)
  const { data: user } = Number.isFinite(tgNum)
    ? await supabaseAdmin.from('users').select('timezone').eq('telegram_id', tgNum).maybeSingle()
    : { data: null as any }
  const tz = user?.timezone || 'Asia/Kolkata'
  const result = session ? await getDashboardTasks(session.telegramId) : { ok: true as const, open: [], completed: [] }

  if (!result.ok) return <CardError message="Couldn’t load your tasks right now." />

  return (
    <div className="w-full">
      <header className="relative overflow-hidden rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-gogo-plum/12 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-8rem] left-[42%] h-52 w-52 rounded-full bg-gogo-orange/8 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">Your to-dos</p>
            <h1 className="mt-1 font-serif text-[38px] font-semibold tracking-[-0.9px] text-gogo-ink">Tasks</h1>
            <p className="mt-2 text-[13.5px] text-gogo-ink-3">{result.open.length} open · {result.completed.length} completed · separate from reminders</p>
          </div>
          <Link href="/dashboard/chat?prompt=show%20my%20tasks" className="rounded-full border border-gogo-orange/15 bg-gogo-orange/8 px-4 py-2.5 text-[11px] font-bold text-gogo-orange transition hover:bg-gogo-orange hover:text-white">Manage with Gogo →</Link>
        </div>

        <div className="relative mt-5 grid max-w-[520px] grid-cols-2 gap-2">
          <div className="rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/55 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.12em] text-gogo-ink-3">Open</div><div className="mt-1 font-serif text-[24px] font-semibold text-gogo-orange">{result.open.length}</div></div>
          <div className="rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/55 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.12em] text-gogo-ink-3">Completed</div><div className="mt-1 font-serif text-[24px] font-semibold text-emerald-700">{result.completed.length}</div></div>
        </div>
      </header>

      <TaskManager open={result.open} completed={result.completed} tz={tz} />
    </div>
  )
}
