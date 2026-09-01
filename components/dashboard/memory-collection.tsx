'use client'

import { useMemo, useState } from 'react'
import type { DashboardMemoryItem } from '@/lib/dashboard/memory'

type Filter = 'all' | DashboardMemoryItem['kind']

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'document', label: 'Documents' },
  { key: 'image', label: 'Images' },
  { key: 'payment', label: 'Payments' },
  { key: 'travel', label: 'Travel' },
  { key: 'identity', label: 'Identity' },
]

const ICONS: Record<DashboardMemoryItem['kind'], string> = {
  document: '📄',
  image: '🖼️',
  payment: '💳',
  travel: '✈️',
  identity: '🪪',
}

function relativeDate(iso: string | null): string {
  if (!iso) return 'Saved'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Saved'
  return `Saved ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d)}`
}

export function MemoryCollection({ items }: { items: DashboardMemoryItem[] }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false
      if (!q) return true
      return `${item.title} ${item.subtitle}`.toLowerCase().includes(q)
    })
  }, [items, query, filter])

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[20px] border border-gogo-ink/10 bg-gogo-surface p-2 shadow-[0_8px_28px_rgba(62,35,18,0.05)]">
        <div className="flex items-center gap-3 rounded-[15px] px-3 py-2.5">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-gogo-ink-3" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anything you've saved…"
            aria-label="Search your memory"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-gogo-ink outline-none placeholder:text-gogo-ink-4 lg:text-[16px]"
          />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(({ key, label }) => {
          const active = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`shrink-0 rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition-colors ${active ? 'border-gogo-plum bg-gogo-plum text-white' : 'border-gogo-ink/10 bg-gogo-surface text-gogo-ink-2 hover:bg-gogo-ink/5'}`}
            >
              {label}
            </button>
          )
        })}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-[22px] border border-dashed border-gogo-ink/15 bg-gogo-surface/70 px-5 py-12 text-center">
          <div className="text-3xl">🧠</div>
          <h2 className="mt-3 font-serif text-[20px] font-semibold text-gogo-ink">Nothing matching that yet.</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-6 text-gogo-ink-3">Send AskGogo a note, screenshot, photo or PDF on WhatsApp and it will appear here when saved.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => (
            <article key={item.id} className="group flex min-h-[172px] flex-col rounded-[22px] border border-gogo-ink/10 bg-gogo-surface p-4 shadow-[0_5px_20px_rgba(62,35,18,0.035)] transition-transform duration-300 hover:-translate-y-0.5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gogo-orange-tint text-xl" aria-hidden="true">{ICONS[item.kind]}</div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[15px] font-bold text-gogo-ink">{item.title}</h2>
                  <p className="mt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-gogo-ink-3">{relativeDate(item.savedAt)}</p>
                </div>
                {item.sensitive && <span className="rounded-full bg-gogo-plum-tint px-2 py-1 text-[10.5px] font-bold text-gogo-plum">Private</span>}
              </div>

              <p className="mt-4 line-clamp-3 flex-1 text-[13px] leading-[1.55] text-gogo-ink-2">{item.subtitle}</p>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-gogo-ink/[0.06] pt-3">
                <span className="text-[11.5px] font-medium capitalize text-gogo-ink-3">{item.kind}</span>
                {item.openUrl ? (
                  <a href={item.openUrl} target="_blank" rel="noreferrer" className="text-[12.5px] font-bold text-gogo-orange hover:text-gogo-orange-deep">Open original →</a>
                ) : (
                  <span className="text-[11.5px] text-gogo-ink-4">No file attached</span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
