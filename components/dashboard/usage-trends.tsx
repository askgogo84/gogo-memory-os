// Usage trends (31 Oct): this week against the weekly allowance, 7/30/60/90-day totals, a 12-week bar chart, what you
// use most, and the recent tasks Gogo finished. Presentation only; numbers come from lib/dashboard/activity.ts.
import type { ActivityTrends } from '@/lib/dashboard/activity'
import { QuotaBar } from './quota-bar'

const shortDay = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(iso))

function WeeksChart({ weeks }: { weeks: ActivityTrends['weeks'] }) {
  const max = Math.max(1, ...weeks.map(w => w.ai))
  const W = 320, H = 120, gap = 6, bw = (W - gap * (weeks.length - 1)) / weeks.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="AI actions per week, last 12 weeks">
      {weeks.map((w, i) => {
        const h = Math.round((w.ai / max) * H)
        const x = i * (bw + gap)
        const last = i === weeks.length - 1
        return (
          <g key={w.start}>
            <title>{`Week of ${shortDay(w.start)}: ${w.ai} AI actions, ${w.tasks} tasks`}</title>
            <rect x={x} y={H - h} width={bw} height={Math.max(h, 1)} rx={3} className={last ? 'fill-gogo-orange' : 'fill-gogo-plum/60'} />
            {(i === 0 || last || i === 6) && (
              <text x={x + bw / 2} y={H + 14} textAnchor="middle" className="fill-gogo-ink-4 text-[10px]">{shortDay(w.start)}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function UsageTrends({ a }: { a: ActivityTrends }) {
  return (
    <section className="flex flex-col gap-3" aria-label="Usage trends">
      <h2 className="mt-2 text-[18px] font-semibold text-gogo-ink">This week</h2>
      {a.weekLimit > 0
        ? <QuotaBar label={`AI actions since ${shortDay(a.weekStart)}`} used={a.weekUsed} limit={a.weekLimit} tone="orange" />
        : <p className="text-[16px] text-gogo-ink-2">{a.weekUsed} AI actions since {shortDay(a.weekStart)}.</p>}

      <div className="grid grid-cols-2 gap-3">
        {a.trends.map(t => (
          <div key={t.days} className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-[12px]">
            <div className="text-[14px] font-medium text-gogo-ink-3">Last {t.days} days</div>
            <div className="mt-1 font-serif text-[26px] font-semibold tabular-nums text-gogo-ink">{t.ai}</div>
            <div className="text-[13px] leading-[1.45] text-gogo-ink-3">AI actions · {t.tasks} tasks · {t.reminders} reminders · {t.alerts} alerts</div>
          </div>
        ))}
      </div>

      <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-[13px]">
        <div className="mb-2 text-[15px] font-semibold text-gogo-ink">AI actions per week</div>
        <WeeksChart weeks={a.weeks} />
      </div>

      {a.topActions.length > 0 && (
        <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-[13px]">
          <div className="mb-2 text-[15px] font-semibold text-gogo-ink">What you use most (30 days)</div>
          <ul className="flex flex-col gap-1.5">
            {a.topActions.map(t => (
              <li key={t.action} className="flex justify-between text-[15px] text-gogo-ink-2"><span>{t.action}</span><span className="tabular-nums text-gogo-ink-3">{t.count}</span></li>
            ))}
          </ul>
        </div>
      )}

      {a.recent.length > 0 && (
        <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-[13px]">
          <div className="mb-2 text-[15px] font-semibold text-gogo-ink">Recent tasks</div>
          <ul className="flex flex-col gap-2">
            {a.recent.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-3 text-[15px] leading-[1.4]">
                <span className="text-gogo-ink-2">{r.title}</span>
                <span className="shrink-0 text-[13px] text-gogo-ink-4">{r.status.replace(/_/g, ' ')} · {shortDay(r.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
