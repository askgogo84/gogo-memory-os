'use client'

import { useState } from 'react'
import type { DashboardList } from '@/lib/dashboard/queries'
import type { ListItem } from '@/lib/data/lists'
import { WhatsAppChip } from './whatsapp-chip'

// ── The list-of-lists, expanding inline ───────────────────────────────────────
// One row per list; tapping expands its items in place (app-flow §4) — no
// sub-route, no identifier in any URL. Interaction lives here in a client leaf;
// the read and the session scoping stay on the server (the page). Read-only:
// items don't tick and lists aren't created until a later phase.

// Sentence case for DISPLAY ONLY — swap underscores for spaces so "Meeting_notes"
// reads as "Meeting notes", then capitalise the first character; leave the rest
// exactly as stored. The bot renders names lower-cased in WhatsApp ("📋 grocery"),
// so "Grocery" reads as the same object across both surfaces; per-word title case
// ("B2b Leads") would mangle arbitrary user strings and start to look like a
// different list. The stored value (the key the bot matches on) is never mutated.
function sentenceCase(name: string): string {
  if (!name) return name
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

// How many items to show before the "Show all" affordance. Counted against the
// partitioned (undone-first) order, so the first PREVIEW_COUNT are the ones that
// still matter — not a slice of completed items.
const PREVIEW_COUNT = 10

// Undone items first, then done — a STABLE partition, so undone items keep their
// added order (the array order the bot numbers against) and done items keep the
// order they already sit in. No alphabetical or done-time sorting.
function partition(items: ListItem[]): ListItem[] {
  return [...items.filter((i) => !i.done), ...items.filter((i) => i.done)]
}

// The done-item tick, drawn to sit inside the 18px filled square. currentColor so
// the square controls the stroke (white on sand).
function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="block h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

// `accent` marks the top (most-recently-touched) list: it opens by default and
// wears the orange count circle, exactly as the first list reads in mockup 1d.
// Every other list is plum and starts collapsed.
function ListRow({ list, accent }: { list: DashboardList; accent: boolean }) {
  const [open, setOpen] = useState(accent)
  const [showAll, setShowAll] = useState(false)
  const total = list.items.length
  const openCount = list.items.filter((i) => !i.done).length
  const ordered = partition(list.items)
  // Cap the expanded view at PREVIEW_COUNT until "Show all" is tapped. No nested
  // scroll region — on mobile a scroll box inside a scrolling page is worse than a
  // plain long list; we reveal in place instead. Collapsing resets back to capped.
  const capped = showAll ? ordered : ordered.slice(0, PREVIEW_COUNT)
  const hidden = ordered.length - capped.length

  const toggleOpen = () =>
    setOpen((o) => {
      if (o) setShowAll(false) // collapsing resets the cap
      return !o
    })

  return (
    <div className="overflow-hidden rounded-[18px] border border-gogo-ink/10 bg-gogo-surface">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center gap-3 p-[14px] text-left"
      >
        <span className="flex-1">
          <span className="block text-[15px] font-semibold text-gogo-ink">{sentenceCase(list.name)}</span>
          <span className="mt-0.5 block text-[12.5px] text-gogo-ink-3">
            {openCount} left of {total}
          </span>
        </span>
        {/* The count circle: open-item count, tinted by accent (orange) vs plum. */}
        <span
          className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums ${
            accent ? 'bg-gogo-orange-tint text-gogo-orange-deep' : 'bg-gogo-plum-tint text-gogo-plum'
          }`}
          aria-hidden
        >
          {openCount}
        </span>
      </button>

      {open && (
        <div className="border-t border-gogo-ink/[0.07] px-[14px] pb-3 pt-1">
          {ordered.length === 0 ? (
            <p className="py-2 text-[13px] text-gogo-ink-3">No items yet</p>
          ) : (
            <>
              <ul>
                {capped.map((item, i) => (
                  <li
                    key={i}
                    className={`flex items-center gap-2.5 border-b border-gogo-ink/[0.05] py-2 last:border-b-0 ${
                      item.done ? 'opacity-45' : ''
                    }`}
                  >
                    {/* A square, not a bullet — reads as a checklist. Read-only this
                        phase: it shows done/undone, it doesn't tick. */}
                    <span
                      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] ${
                        item.done ? 'bg-gogo-sand text-white' : 'border-[1.6px] border-gogo-ink/20'
                      }`}
                      aria-hidden
                    >
                      {item.done && <CheckMark />}
                    </span>
                    <span
                      className={`flex-1 text-[14px] font-medium text-gogo-ink ${item.done ? 'line-through' : ''}`}
                    >
                      {item.text}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {/* Contextual hand-back: adds to THIS list. Green lives only here.
                    Uses the sentence-cased display name so the chip reads "…add to
                    Goa", matching the card header (not the raw stored "goa"). */}
                <WhatsAppChip message={`Gogo, add to ${sentenceCase(list.name)}`} />
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="text-[12px] font-semibold text-gogo-orange-deep"
                  >
                    Show all {total}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function ListCollection({ lists }: { lists: DashboardList[] }) {
  return (
    <div className="flex flex-col gap-[10px]">
      {lists.map((list, i) => (
        <ListRow key={list.id} list={list} accent={i === 0} />
      ))}
    </div>
  )
}
