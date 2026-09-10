import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDashboardTasks, type DashboardTask } from '@/lib/dashboard/tasks'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

function dateLabel(iso: string | null, tz: string): string {
  if (!iso) return 'Saved in AskGogo'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Saved in AskGogo'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

function TaskBoard({
  title,
  subtitle,
  tasks,
  tone,
  tz,
  completed = false,
}: {
  title: string
  subtitle: string
  tasks: DashboardTask[]
  tone: string
  tz: string
  completed?: boolean
}) {
  return (
    <section className="min-h-[430px] rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/82 p-5 shadow-[0_20px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-[25px] font-semibold tracking-[-0.4px] text-gogo-ink">{title}</h2>
          <p className="mt-1 text-[12px] text-gogo-ink-3">{subtitle}</p>
        </div>
        <span className={`grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-bold ${tone}`}>{tasks.length}</span>
      </div>

      <div className="mt-5 space-y-3">
        {tasks.length ? tasks.slice(0, 16).map((task) => (
          <article key={task.id} className="rounded-[18px] border border-gogo-ink/8 bg-gogo-cream/48 px-4 py-3.5 transition hover:-translate-y-0.5 hover:bg-gogo-surface">
            <div className="flex items-start gap-3">
              <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${completed ? 'border-emerald-500 bg-emerald-100' : 'border-gogo-orange bg-gogo-surface'}`} />
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-semibold leading-5 ${completed ? 'text-gogo-ink-3 line-through' : 'text-gogo-ink'}`}>{task.label}</div>
                <div className="mt-1 text-[11px] text-gogo-ink-3">
                  {completed ? `Completed ${dateLabel(task.doneAt || task.createdAt, tz)}` : `Added ${dateLabel(task.createdAt, tz)}`}
                </div>
              </div>
            </div>
          </article>
        )) : (
          <div className="grid min-h-[280px] place-items-center rounded-[20px] border border-dashed border-gogo-ink/10 bg-gogo-cream/25 text-center">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gogo-surface text-gogo-orange">✓</div>
              <div className="mt-3 font-serif text-[18px] font-semibold text-gogo-ink">{completed ? 'Nothing completed yet' : 'All clear'}</div>
              <div className="mt-1 max-w-[260px] text-[12px] leading-5 text-gogo-ink-3">{completed ? 'Completed tasks will collect here quietly.' : 'No open tasks are waiting for you.'}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

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
          <div className="flex flex-wrap gap-2">
            <WhatsAppChip message="Gogo, add task: " label="New task" />
            <WhatsAppChip message="Gogo, show my tasks" label="Manage with Gogo" />
          </div>
        </div>

        <div className="relative mt-5 grid max-w-[520px] grid-cols-2 gap-2">
          <div className="rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/55 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.12em] text-gogo-ink-3">Open</div><div className="mt-1 font-serif text-[24px] font-semibold text-gogo-orange">{result.open.length}</div></div>
          <div className="rounded-[16px] border border-gogo-ink/7 bg-gogo-cream/55 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.12em] text-gogo-ink-3">Completed</div><div className="mt-1 font-serif text-[24px] font-semibold text-emerald-700">{result.completed.length}</div></div>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TaskBoard title="Open" subtitle="Things you still want to get done" tasks={result.open} tone="bg-gogo-orange-tint text-gogo-orange-deep" tz={tz} />
        <TaskBoard title="Completed" subtitle="Recently cleared" tasks={result.completed} tone="bg-emerald-50 text-emerald-700" tz={tz} completed />
      </div>
    </div>
  )
}
