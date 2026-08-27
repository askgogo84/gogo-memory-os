// Zero-import core for the lists CAS logic (Phase 6). Split out of lib/data/lists.ts
// exactly the way meter-core.ts is split from meter.ts: NO imports, so Node's native
// TypeScript type-stripping can load it directly under `node --test`, and the Supabase
// client is INJECTED (as `db`) rather than imported. Tests pass a fake db; the real
// wrapper in lists.ts passes supabaseAdmin. See lists-core.test.mjs.

export interface ListItem {
  text: string
  done: boolean
  added_at: string
}

// Max optimistic-concurrency attempts: 1 initial + 2 retries, per the Phase 6 sign-off.
export const CAS_MAX_ATTEMPTS = 3

export class ListWriteConflictError extends Error {
  constructor(message = 'list_write_conflict') {
    super(message)
    this.name = 'ListWriteConflictError'
  }
}

// The shared compare-and-swap core. Items live as a JSONB array on the lists row —
// there is no per-item table — so every mutation is a read-modify-write of the whole
// array, which is NOT atomic in Postgres: two writers can both read the same array and
// the second write clobbers the first (a lost update). We re-read the row's items +
// updated_at, apply `mutate`, and write GATED on the exact updated_at just read. 0 rows
// affected ⇒ someone wrote in between ⇒ re-read and retry, up to CAS_MAX_ATTEMPTS, then
// throw ListWriteConflictError. `mutate` returns the next items array, or null to abort
// with NO write (a genuine no-op — e.g. the target item wasn't found).
//
// `db` is a Supabase-shaped client (real or fake). The two chains it must support:
//   read:  db.from('lists').select('items, updated_at').eq('id', id).single()
//   write: db.from('lists').update({...}).eq('id', id).eq|is('updated_at', tok).select('id')
export async function mutateListItems(
  db: any,
  listId: number | string,
  mutate: (items: ListItem[]) => ListItem[] | null,
): Promise<ListItem[]> {
  for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
    const { data: row, error: readErr } = await db
      .from('lists')
      .select('items, updated_at')
      .eq('id', listId)
      .single()
    if (readErr || !row) throw readErr ?? new Error('list_not_found')

    const current = (row.items as ListItem[]) ?? []
    const next = mutate(current)
    if (next === null) return current // nothing to write

    let q = db
      .from('lists')
      .update({ items: next, updated_at: new Date().toISOString() })
      .eq('id', listId)
    // CAS gate on the token we just read. Legacy rows can carry a null updated_at;
    // `.is` handles that — an `.eq(null)` would never match and would spin to a false
    // conflict.
    q = row.updated_at === null ? q.is('updated_at', null) : q.eq('updated_at', row.updated_at)

    const { data: updated, error: writeErr } = await q.select('id')
    if (writeErr) throw writeErr
    if (updated && updated.length > 0) return next // won the race
    // else 0 rows → lost the race → loop and retry from a fresh read
  }
  throw new ListWriteConflictError()
}

// ── Pure, injectable name/text helpers + set-logic (unit-testable) ─────────────
// These carry NO db and NO Date — they take their inputs — so scripts/verify-list-
// routing.mjs imports the REAL functions the bot runs, not a copy. The lists.ts
// wrappers inject supabaseAdmin + new Date().toISOString(); detect-intent.ts uses
// classifyCheckVerb.

// The single source of truth for list-name resolution. ADD, SHOW, DONE and every
// getList lookup route through this, so "groceries"/"grocery"/"grocery list" all land
// on the one canonical key. Moved here from feature-intents.ts (was ADD-only, which is
// exactly the asymmetry that lost "show groceries").
export function normalizeListName(raw: string): string {
  let n = (raw || '').toLowerCase().trim().replace(/\s+/g, ' ')
  n = n.replace(/\s+list$/, '').trim() // "weekend list" → "weekend", "grocery list" → "grocery"
  if (n === 'groceries' || n === 'grocery') return 'grocery'
  if (n === 'shopping') return 'shopping'
  if (n === 'to-do' || n === 'to do' || n === 'todo') return 'todo'
  if (n === 'note' || n === 'notes') return 'notes'
  return n || 'list'
}

// isCalendarListName moved to the zero-import lib/data/calendar-word.ts so it can be
// built from the shared CALENDAR_WORD_RE spelling set (covering calender/calandar/…)
// without duplicating the pattern. Import it from '@/lib/data/calendar-word'.

// Item-text normalisation for dedupe + match: lowercase + trim + collapse whitespace.
// Deliberately NOT fuzzy — "milk" and "almond milk" stay distinct.
export function normItemText(s: string): string {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

// Classify a check/uncheck command. uncheck is tested FIRST and is ^un-anchored;
// check stays PREFIX-anchored (startsWith), never /\bcheck\b/ — because "uncheck"
// CONTAINS "check", a loosened boundary would let the check branch steal it (the same
// class as the rice⊂price outage). Both guards independently reject the wrong verb.
export function classifyCheckVerb(lower: string): 'list_check' | 'list_uncheck' | null {
  if (/^un(check|tick|mark|done)\b/.test(lower)) return 'list_uncheck'
  if (lower.startsWith('check ') || lower.startsWith('tick ') || lower.startsWith('mark ')) return 'list_check'
  return null
}

// Canonical, append-only buckets whose "items" are timestamped ARTIFACTS (saved reels,
// PDFs, skin-check reports, platform saves) that legitimately repeat the same label on
// different days — NOT shopping-style list items. Dedupe is skipped for these: collapsing
// 29 "skin check report" scans into one, or telling the user a genuinely new save is
// "already on your list", would be wrong. Explicit list, not a heuristic, by request.
// Compared against the normalised name (see isDedupeExemptBucket).
export const DEDUPE_EXEMPT_BUCKETS = new Set<string>([
  'notes',
  'meeting_notes',
  'instagram_saves',
  'facebook_saves',
  'youtube_saves',
  'linkedin_saves',
  'twitter_saves',
  'tiktok_saves',
  'social_saves',
])

export function isDedupeExemptBucket(name: string): boolean {
  return DEDUPE_EXEMPT_BUCKETS.has(normalizeListName(name))
}

// Pure add. With dedupe (the default, for user-facing lists): appends only genuinely new
// items; an existing PENDING match is skipped (already there); an existing DONE match is
// flipped back to pending instead of adding a second copy; dedupes within the incoming
// batch too. With dedupe=false (the exempt artifact buckets): plain append, every item
// kept, matching the pre-dedupe behaviour. `now` is injected so tests are deterministic.
export function applyAdd(
  cur: ListItem[],
  rawItems: string[],
  now: string,
  dedupe = true,
): { next: ListItem[]; added: string[]; alreadyPending: string[]; reactivated: string[]; changed: boolean } {
  const next = cur.map(i => ({ ...i }))
  const added: string[] = []
  const alreadyPending: string[] = []
  const reactivated: string[] = []
  let changed = false
  for (const raw of rawItems) {
    const text = (raw ?? '').trim()
    if (!text) continue
    const found = dedupe ? next.find(i => normItemText(i.text) === normItemText(text)) : undefined
    if (found) {
      if (found.done) {
        found.done = false
        reactivated.push(found.text)
        changed = true
      } else {
        alreadyPending.push(found.text)
      }
    } else {
      next.push({ text, done: false, added_at: now })
      added.push(text)
      changed = true
    }
  }
  return { next, added, alreadyPending, reactivated, changed }
}

// Pure set-done (SET the desired state, never flip). Exact normalised match first;
// substring only as a fallback when nothing matches exactly. Among candidates it targets
// the FIRST one not already in the desired state (so "done milk" twice is a no-op on the
// already-done row, not a second toggle), and never touches more than one row. Returns
// the matched item's stored text so callers can name it — never the raw query.
export function applySetDone(
  items: ListItem[],
  itemText: string,
  done: boolean,
): { next: ListItem[]; matched: string | null; changed: boolean } {
  const q = normItemText(itemText)
  let cand = items.map((i, k) => ({ i, k })).filter(x => normItemText(x.i.text) === q)
  if (cand.length === 0) cand = items.map((i, k) => ({ i, k })).filter(x => normItemText(x.i.text).includes(q))
  if (cand.length === 0) return { next: items, matched: null, changed: false }
  const target = cand.find(x => x.i.done !== done) ?? cand[0]
  const matched = target.i.text
  if (target.i.done === done) return { next: items, matched, changed: false }
  const next = items.map((it, k) => (k === target.k ? { ...it, done } : it))
  return { next, matched, changed: true }
}

// Pure cross-list lookup for the "done <text>" divert: PENDING items whose normalised
// text EXACTLY equals the query, one hit per list. Exact-only + pending-only by design —
// so "done buy stamps" with no such list item stays empty and the caller falls through
// to the existing /api/todos handler, and a substring can never silently divert it.
export function findPendingExactMatches(
  lists: { list_name: string; items: ListItem[] }[],
  itemText: string,
): { list_name: string; matched: string }[] {
  const q = normItemText(itemText)
  const hits: { list_name: string; matched: string }[] = []
  for (const l of lists) {
    const it = (l.items ?? []).find(i => !i.done && normItemText(i.text) === q)
    if (it) hits.push({ list_name: l.list_name, matched: it.text })
  }
  return hits
}
