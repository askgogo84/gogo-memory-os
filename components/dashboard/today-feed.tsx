'use client'
import { useState } from 'react'
import { waLink } from '@/lib/product-urls'
import type { TodayCard, TodayDone } from '@/lib/dashboard/today-feed'

// Today feed (approved mockup, 5 Nov): Needs you, Gogo noticed, and a quiet done line. Main actions hand off to
// WhatsApp with the message typed but not sent, or open the source link; nothing happens without a yes.
async function post(op: 'hide' | 'fewer' | 'done', card: string, tz: string) {
  try { await fetch('/api/dashboard/today-feed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, card, tz }) }) } catch {}
}

function Card({ c, tz, onHide }: { c: TodayCard; tz: string; onHide: (key: string, fewer: boolean) => void }) {
  const href = c.action.href || (c.action.message ? waLink(c.action.message) : undefined)
  return (
    <article className="flex flex-col gap-2 rounded-2xl border border-gogo-ink/10 bg-gogo-surface px-4 py-3.5">
      <span className={`text-[12px] font-semibold uppercase tracking-[0.08em] ${c.section === 'needs' ? 'text-gogo-orange' : 'text-gogo-ink-3'}`}>{c.label}</span>
      <span className="text-[17px] font-semibold leading-snug text-gogo-ink">{c.title}</span>
      <span className="text-[14px] leading-snug text-gogo-ink-3">{c.why}</span>
      <div className="mt-0.5 flex flex-wrap items-center gap-2">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => post('done', c.key, tz)}
            className="inline-flex min-h-[44px] items-center rounded-full bg-gogo-ink px-4 text-[14px] font-medium text-gogo-surface">{c.action.label}</a>
        ) : null}
        <button type="button" onClick={() => onHide(c.key, false)}
          className="min-h-[44px] rounded-full border border-gogo-ink/15 px-3.5 text-[14px] font-medium text-gogo-ink">Not now</button>
        {c.section === 'noticed' ? (
          <button type="button" onClick={() => onHide(c.key, true)}
            className="min-h-[44px] px-2 text-[13px] font-medium text-gogo-ink-3 underline">Fewer like this</button>
        ) : null}
      </div>
    </article>
  )
}

export function TodayFeed({ needs, noticed, done, tz }: { needs: TodayCard[]; noticed: TodayCard[]; done: TodayDone; tz: string }) {
  const [gone, setGone] = useState<string[]>([])
  const [fewer, setFewer] = useState<string[]>([])
  const hide = (key: string, less: boolean) => {
    setGone(g => [...g, key])
    if (less) setFewer(f => [...f, key.split(':')[0]])
    void post(less ? 'fewer' : 'hide', key, tz)
  }
  const n = needs.filter(c => !gone.includes(c.key))
  const g = noticed.filter(c => !gone.includes(c.key) && !fewer.includes(c.kind))
  const doneBits = [
    done.remindersSent ? `${done.remindersSent} reminder${done.remindersSent === 1 ? '' : 's'} sent on time` : '',
    done.watchHits ? `${done.watchHits} watch hit${done.watchHits === 1 ? '' : 's'}` : '',
    done.receiptsFiled ? `${done.receiptsFiled} receipt${done.receiptsFiled === 1 ? '' : 's'} filed` : '',
  ].filter(Boolean)
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2.5" aria-labelledby="today-needs">
        <h2 id="today-needs" className="text-[13px] font-semibold uppercase tracking-[0.1em] text-gogo-ink-3">Needs you</h2>
        {n.length ? n.map(c => <Card key={c.key} c={c} tz={tz} onHide={hide} />)
          : <p className="rounded-2xl border border-dashed border-gogo-ink/15 px-4 py-3.5 text-[15px] text-gogo-ink-3">Nothing needs you right now.</p>}
      </section>
      {g.length ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="today-noticed">
          <h2 id="today-noticed" className="text-[13px] font-semibold uppercase tracking-[0.1em] text-gogo-ink-3">Gogo noticed</h2>
          {g.map(c => <Card key={c.key} c={c} tz={tz} onHide={hide} />)}
        </section>
      ) : null}
      {doneBits.length ? (
        <p className="rounded-2xl bg-gogo-ink/5 px-4 py-3 text-[15px] leading-relaxed text-gogo-ink-2"><span className="font-semibold">Done for you today:</span> {doneBits.join(' · ')}</p>
      ) : null}
      <p className="text-[13px] leading-relaxed text-gogo-ink-3">WhatsApp stays quiet. Only reminders you set and urgent alerts go there. <a href="/dashboard/alerts" className="inline-flex min-h-[44px] items-center font-medium text-gogo-ink underline">Choose what can reach WhatsApp</a></p>
    </div>
  )
}
