'use client'

// 22 Nov (owner-approved mock, Connections · phone): a live check of what Gogo can reach. Runs once when the page
// opens and again on "Check now". Anything not working is listed first with its reason; working items follow.
// The check only reads; it never connects, sends or changes anything.
import { useCallback, useEffect, useState } from 'react'

type Status = 'operational' | 'degraded' | 'blocked' | 'unverified'
type Check = { key: string; label: string; status: Status; at: string | null; evidence: string; quiet?: boolean }

const WORD: Record<Status, string> = { operational: 'Operational', degraded: 'Degraded', blocked: 'Blocked', unverified: 'Unverified' }
const PILL: Record<Status, string> = {
  operational: 'bg-[#16302a] text-[#8fd3b6]',
  degraded: 'bg-[#33280f] text-[#e4c17b]',
  blocked: 'bg-[#3a1a18] text-[#f0a49b]',
  unverified: 'bg-[#242424] text-[#c9c5bf]',
}
// Where the owner fixes each one.
const FIX: Record<string, { href: string; label: string }> = {
  gmail: { href: '/dashboard/you', label: 'Open Gmail settings →' },
  calendar: { href: '/dashboard/calendar', label: 'Open Calendar →' },
  voice: { href: '/dashboard/activity', label: 'Open your calls →' },
  approvals: { href: '/dashboard/tasks', label: 'Open approvals →' },
  watchers: { href: '/dashboard/tasks', label: 'Open watches →' },
  scheduled: { href: '/dashboard/tasks', label: 'Open reminders →' },
}

export function whenLabel(iso: string | null | undefined): string {
  const ms = Date.parse(String(iso || ''))
  if (!Number.isFinite(ms)) return ''
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(ms)).replace(/\s?([ap])\.?m\.?/i, ' $1m').replace(/\b([ap])m\b/i, m => m.toLowerCase())
}

/** Pure: the summary line and the two groups, the same rules as the chat summary. */
export function groupChecks(checks: Check[]) {
  const ok = checks.filter(c => c.status === 'operational')
  const quiet = checks.filter(c => c.status === 'unverified' && c.quiet)
  const look = checks.filter(c => c.status !== 'operational' && !(c.status === 'unverified' && c.quiet))
  const headline = look.length ? `${ok.length} OK · ${look.length} need${look.length === 1 ? 's' : ''} a look` : ok.length ? `All ${ok.length} OK` : 'Nothing failed'
  return { ok, quiet, look, headline }
}

function Card({ c, showFix }: { c: Check; showFix: boolean }) {
  const fix = FIX[c.key]
  return <div className="final-dark-panel flex flex-col gap-2 p-4">
    <div className="flex items-center justify-between gap-2">
      <div className="text-[16px] font-semibold text-[#f2efea]">{c.label}</div>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[13px] font-semibold ${PILL[c.status]}`}>{WORD[c.status]}</span>
    </div>
    <p className="text-[14px] leading-5 text-[#a8a8a8]">{c.evidence}</p>
    {c.at && <div className="text-[13px] text-[#8a8a8a]">Evidence from {whenLabel(c.at)}</div>}
    {showFix && fix && <a href={fix.href} className="flex min-h-11 items-center text-[14px] font-semibold text-[#2fb8a6]">{fix.label}</a>}
  </div>
}

export function ConnectionsLiveCheck() {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/dashboard/connections/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: '{}' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(body?.checks)) { setError(String(body?.message || "The check couldn't finish, so nothing is marked as working. Nothing was changed.")); return }
      setChecks(body.checks); setCheckedAt(String(body.checkedAt || new Date().toISOString()))
    } catch {
      setError("Couldn't reach Gogo, so nothing is marked as working. Nothing was changed.")
    } finally { setBusy(false) }
  }, [])

  useEffect(() => { void run() }, [run])

  const g = checks ? groupChecks(checks) : null
  return <section className="mt-5 flex flex-col gap-3" aria-labelledby="live-check" aria-busy={busy}>
    <h2 id="live-check" className="final-dark-eyebrow">Live check</h2>
    <div className="final-dark-panel flex items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold text-[#f2efea]" role="status">{busy && !g ? 'Checking with each provider…' : g ? g.headline : 'Not checked yet'}</div>
        <div className="text-[13px] text-[#8a8a8a]">{busy ? 'Reading only; nothing is changed.' : checkedAt ? `Checked ${whenLabel(checkedAt)}` : 'A check only reads; it never connects, sends or changes anything.'}</div>
      </div>
      <button type="button" onClick={run} disabled={busy}
        className="min-h-11 shrink-0 rounded-full bg-[#2fb8a6] px-5 text-[15px] font-semibold text-[#04201c] disabled:opacity-60">{busy ? 'Checking…' : 'Check now'}</button>
    </div>
    {error && <p role="alert" className="rounded-[12px] border border-[#3a2a17] bg-[#1d1710] px-4 py-3 text-[14px] leading-5 text-[#e4c17b]">{error}</p>}
    {g && g.look.length > 0 && <>
      <h3 className="final-dark-eyebrow mt-1">Needs a look</h3>
      <div className="grid gap-3 md:grid-cols-2">{g.look.map(c => <Card key={c.key} c={c} showFix />)}</div>
    </>}
    {g && g.ok.length > 0 && <>
      <h3 className="final-dark-eyebrow mt-1">Working</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{g.ok.map(c => <Card key={c.key} c={c} showFix={false} />)}</div>
    </>}
    {g && g.quiet.length > 0 && <p className="text-[14px] leading-5 text-[#a8a8a8]">Nothing recent to test: {g.quiet.map(c => c.label).join(', ')}.</p>}
  </section>
}
