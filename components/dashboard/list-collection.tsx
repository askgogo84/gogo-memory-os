'use client'

import { useState } from 'react'
import type { DashboardList } from '@/lib/dashboard/queries'
import type { ListItem } from '@/lib/data/lists'

// ── The list-of-lists, expanding inline ───────────────────────────────────────
// One row per list; tapping expands its items in place (app-flow §4) — no
// sub-route, no identifier in any URL. Interaction lives here in a client leaf;
// the read and the session scoping stay on the server (the page). Read-only:
// items don't tick and lists aren't created until a later phase.

// Sentence case for DISPLAY ONLY — capitalise the first character, leave the
// rest exactly as stored. The bot renders names lower-cased in WhatsApp
// ("📋 grocery"), so "Grocery" reads as the same object across both surfaces;
// per-word title case ("B2b Leads") would mangle arbitrary user strings and
// start to look like a different list. The stored value is never mutated.
function sentenceCase(name: string): string {
  if (!name) return name
  return name.charAt(0).toUpperCase() + name.slice(1)
}

// Undone items first, then done — a STABLE partition, so undone items keep their
// added order (the array order the bot numbers against) and done items keep the
// order they already sit in. No alphabetical or done-time sorting.
function partition(items: ListItem[]): ListItem[] {
  return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)]
}

function ListRow({ list }: { list: DashboardList }) {
  const [open, setOpen] = useState(false)
  const count = list.items.length
  const ordered = partition(list.items)

  return (
    <li className="border-b border-gogo-ink/10 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 py-3.5 text-left"
      >
        <span className="flex-1 text-[15px] font-medium text-gogo-ink">{sentenceCase(list.name)}</span>
        <span className="text-[13px] tabular-nums text-gogo-ink/55">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
        <span
          className={`text-gogo-ink/40 transition-transform duration-300 ease-calm ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ›
        </span>
      </button>

      {open && (
        <div className="pb-4">
          {ordered.length === 0 ? (
            <p className="text-[13px] text-gogo-ink/45">No items yet</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {ordered.map((item, i) => (
                <li key={i} className="flex items-baseline gap-2.5 text-[14px] leading-[1.4]">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      item.done ? 'bg-gogo-ink/20' : 'bg-gogo-plum'
                    }`}
                    aria-hidden
                  />
                  <span
                    className={
                      item.done ? 'text-gogo-ink/40 line-through decoration-gogo-ink/20' : 'text-gogo-ink'
                    }
                  >
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

export function ListCollection({ lists }: { lists: DashboardList[] }) {
  return (
    <ul className="rounded-2xl border border-gogo-ink/10 bg-gogo-surface px-4">
      {lists.map((list) => (
        <ListRow key={list.id} list={list} />
      ))}
    </ul>
  )
}
