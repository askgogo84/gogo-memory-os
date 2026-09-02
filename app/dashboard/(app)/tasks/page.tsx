import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDashboardTasks, type DashboardTask } from '@/lib/dashboard/tasks'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

function clock(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}

function dateLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

function Board({ title, subtitle, tasks, tone, tz }: { title: string; subtitle: string; tasks: DashboardTask[]; tone: string; tz: string }) {
  return (
    <section className="min-h-[430px] rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/78 p-5 shadow-[0_20px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-[24px] font-semibold tracking-[-0.4px] text-gogo-ink">{title}</h2>
          <p className="mt-1 text-[12px] text-gogo-ink-3">{subtitle}</p>
        </div>
        <span className={`grid h-9 min-w-9 place-items-center rounded-full px-2 text-[12px] font-bold ${tone}`}>{tasks.length}</span>
      </div>

      <div className="mt-5 space-y-3">
        {tasks.length ? tasks.slice(0, 12).map((task) => (
          <div key={task.id} className="rounded-[18px] border border-gogo-ink/8 bg-gogo-cream/50 px-4 py-3.5 transition hover:-translate-y-0.5 hover:bg-gogo-surface">
            <div className="flex items-start gap-3">
              <span className={`mt-1 h-3 w-3 shrink-0 rounded-full border-2 ${task.sent ? 'border-gogo-ink/20 bg-gogo-ink/10' : 'border-gogo-orange'}`} />
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-semibold ${task.sent ? 'text-gogo-ink-3 line-through' : 'text-gogo-ink'}`}>{task.label}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-gogo-ink-3">
                  <span>{dateLabel(task.remindAt, tz)}</span>
                  <span>·</span>
                  <span>{clock(task.remindAt, tz)}</span>
                  {task.recurring && <><span>·</span><span>Recurring</span></>}
                </div>
              </div>
            </div>
          </div>
        )) : (
          <div className="grid min-h-[260px] place-items-center rounded-[20px] border border-dashed border-gogo-ink/10 bg-gogo-cream/25 text-center">
            <div>
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-gogo-surface text-gogo-orange">✓</div>
              <div className="mt-3 font-serif text-[18px] font-semibold text-gogo-ink">All clear</div>
              <div className="mt-1 text-[12px] text-gogo-ink-3">Nothing waiting here.</div>
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
  const result = session ? await getDashboardTasks(session.telegramId, tz) : { ok: true as const, today: [], upcoming: [], completed: [] }

  if (!result.ok) return <CardError message="Couldn’t load your tasks right now." />

  const totalOpen = result.today.length + result.upcoming.length

  return (
    <div className="w-full">
      <header className="relative overflow-hidden rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/75 px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-gogo-plum/10 blur-3xl" />
        <div className="relative flex items-end justify-between gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">Your boards</p>
            <h1 className="mt-1 font-serif text-[36px] font-semibold tracking-[-0.8px] text-gogo-ink">Tasks</h1>
            <p className="mt-2 text-[13px] text-gogo-ink-3">{totalOpen} open · one calm place for what needs doing</p>
          </div>
          <WhatsAppChip message="Gogo, remind me to…" label="New task" />
        </div>
      </header>

      <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Board title="Today" subtitle="What matters now" tasks={result.today} tone="bg-gogo-orange-tint text-gogo-orange-deep" tz={tz} />
        <Board title="Upcoming" subtitle="Coming up next" tasks={result.upcoming} tone="bg-gogo-plum-tint text-gogo-plum" tz={tz} />
        <Board title="Completed" subtitle="Recently cleared" tasks={result.completed} tone="bg-emerald-50 text-emerald-700" tz={tz} />
      </div>
    </div>
  )
}
