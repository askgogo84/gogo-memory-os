// The Activity list showed the same background check dozens of times a day ("KLM KL0879 Amsterdam → Bengaluru
// · the provider status page changed" every few minutes). Identical entries on the same day collapse into one
// row that says how many times it ran and when it first ran. Different outcomes stay separate.
export type CollapsibleRun = { id: string; title: string; status: string; category: string; summary?: string | null; error?: string | null; updatedAt: string | null; startedAt: string | null }
export type CollapsedRun<T extends CollapsibleRun> = T & { repeats: number; firstAt: string | null }

function sameEntryKey(run: CollapsibleRun) {
  const text = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  return [text(run.title), run.status, run.category, text(run.summary), text(run.error)].join('|')
}

/** Keeps the newest of each identical entry in its place, with a count and the earliest time. Input newest first. */
export function collapseRepeatedRuns<T extends CollapsibleRun>(runs: T[]): CollapsedRun<T>[] {
  const out: CollapsedRun<T>[] = []
  const byKey = new Map<string, CollapsedRun<T>>()
  for (const run of runs) {
    // Work that is still running or waiting on the person is never folded away.
    if (['running', 'queued', 'paused', 'waiting_approval'].includes(run.status)) { out.push({ ...run, repeats: 1, firstAt: run.startedAt || run.updatedAt }); continue }
    const key = sameEntryKey(run)
    const seen = byKey.get(key)
    if (seen) { seen.repeats += 1; seen.firstAt = run.startedAt || run.updatedAt || seen.firstAt; continue }
    const entry = { ...run, repeats: 1, firstAt: run.startedAt || run.updatedAt }
    byKey.set(key, entry); out.push(entry)
  }
  return out
}
