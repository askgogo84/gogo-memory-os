'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { postAction, errorText } from './admin-client'

type Row = { id: string; phone: string; email: string | null; country: string | null; source: string | null; optin: boolean; created: string; status: string; invite: string | null; name: string | null }
const STATUS: Record<string, [string, string]> = { waiting: ['Waiting', ''], invited: ['Approved', 'warn'], joined: ['Joined', 'ok'], blocked: ['Blocked', 'bad'] }
const FILTERS: [string, string][] = [['waiting', 'Waiting'], ['invited', 'Approved'], ['joined', 'Joined'], ['blocked', 'Blocked'], ['all', 'All']]

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

export function WaitlistTable({ rows, canAct }: { rows: Row[]; canAct: boolean }) {
  const router = useRouter()
  const [filter, setFilter] = useState('waiting')
  const [country, setCountry] = useState('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  const [armedBlock, setArmedBlock] = useState(false)

  const counts = useMemo(() => { const c: Record<string, number> = { all: rows.length }; for (const r of rows) c[r.status] = (c[r.status] || 0) + 1; return c }, [rows])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => (filter === 'all' || r.status === filter) && (country === 'all' || r.country === country) && (!needle || [r.phone, r.email, r.source, r.name].some(v => String(v || '').toLowerCase().includes(needle))))
  }, [rows, filter, country, q])
  const ids = Object.keys(sel).filter(k => sel[k])
  const allShownSelected = shown.length > 0 && shown.slice(0, 200).every(r => sel[r.id])

  function run(action: string, list: string[]) {
    setMsg('')
    start(async () => {
      const r = await postAction(action, { ids: list })
      setMsg(r.ok ? r.message || 'Done.' : errorText(r.error))
      if (r.ok) { setSel({}); router.refresh() }
    })
  }
  function exportCsv() {
    const head = ['phone', 'email', 'country', 'source', 'whatsapp_opt_in', 'joined', 'status']
    const lines = [head.join(',')].concat(shown.map(r => [r.phone, r.email || '', r.country || '', r.source || '', r.optin ? 'yes' : 'no', r.created, r.status].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `askgogo-waitlist-${filter}.csv`; a.click()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="chips">
        {FILTERS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={filter === k} onClick={() => { setFilter(k); setSel({}) }}>{l} <span style={{ opacity: .7 }}>{counts[k] || 0}</span></button>)}
      </div>
      <div className="chips">
        <label className="sr" htmlFor="wl-country">Country</label>
        <select id="wl-country" className="field" value={country} onChange={e => setCountry(e.target.value)}><option value="all">All countries</option><option value="IN">India</option><option value="AE">UAE</option></select>
        <label className="sr" htmlFor="wl-q">Search phone, email, source or name</label>
        <input id="wl-q" className="field" type="search" placeholder="Search phone, email, source" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 200px' }} />
        <button type="button" className="btn lg" onClick={exportCsv}>Export CSV</button>
      </div>
      {canAct && ids.length ? (
        <div className="banner" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: '1 1 auto' }}>{ids.length} selected</span>
          <button type="button" className="btn solid" disabled={pending} onClick={() => run('waitlist.approve', ids)}>Approve and invite</button>
          <button type="button" className="btn" disabled={pending} onClick={() => { if (!armedBlock) { setArmedBlock(true); return } setArmedBlock(false); run('waitlist.block', ids) }}>{armedBlock ? 'Tap again to block' : 'Block'}</button>
          <button type="button" className="btn" style={{ border: 0 }} onClick={() => setSel({})}>Clear</button>
        </div>
      ) : null}
      {msg ? <div role="status" className="banner">{msg}</div> : null}
      <div className="adm-table">
        <table>
          <thead><tr>
            {canAct ? <th scope="col"><input type="checkbox" aria-label="Select all shown" checked={allShownSelected} onChange={e => { const next: Record<string, boolean> = {}; if (e.target.checked) shown.slice(0, 200).forEach(r => { next[r.id] = true }); setSel(next) }} style={{ width: 18, height: 18 }} /></th> : null}
            <th scope="col">Phone</th><th scope="col">Name or email</th><th scope="col">Country</th><th scope="col">Source</th><th scope="col">Opt-in</th><th scope="col">Joined</th><th scope="col">Status</th>{canAct ? <th scope="col">Actions</th> : null}
          </tr></thead>
          <tbody>
            {shown.slice(0, 300).map(r => {
              const [label, tone] = STATUS[r.status] || [r.status, '']
              return (
                <tr key={r.id}>
                  {canAct ? <td><input type="checkbox" aria-label={`Select ${r.phone}`} checked={!!sel[r.id]} onChange={e => setSel(s => ({ ...s, [r.id]: e.target.checked }))} style={{ width: 18, height: 18 }} /></td> : null}
                  <td>{r.phone}</td>
                  <td style={{ color: 'var(--ink2)' }}>{r.name || r.email || '—'}</td>
                  <td>{r.country || '—'}</td>
                  <td style={{ color: 'var(--ink2)' }}>{r.source || '—'}</td>
                  <td style={{ color: 'var(--ink2)' }}>{r.optin ? 'Yes' : 'No'}</td>
                  <td style={{ color: 'var(--ink3)' }}>{fmt(r.created)}</td>
                  <td><span className={`pill ${tone}`} title={r.invite || undefined}>{label}</span></td>
                  {canAct ? (
                    <td><div style={{ display: 'flex', gap: 6 }}>
                      {r.status === 'waiting' ? <button type="button" className="btn sm solid" disabled={pending} onClick={() => run('waitlist.approve', [r.id])}>Approve</button> : null}
                      {r.status === 'invited' ? <button type="button" className="btn sm" disabled={pending} onClick={() => run('waitlist.approve', [r.id])}>Resend invite</button> : null}
                      {r.status !== 'blocked' ? <button type="button" className="btn sm" disabled={pending} onClick={() => run('waitlist.block', [r.id])}>Block</button> : <button type="button" className="btn sm" disabled={pending} onClick={() => run('waitlist.unblock', [r.id])}>Unblock</button>}
                    </div></td>
                  ) : null}
                </tr>
              )
            })}
            {!shown.length ? <tr><td colSpan={9} style={{ color: 'var(--ink3)' }}>No one here.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {shown.length > 300 ? <p className="note">Showing the newest 300 of {shown.length}. Search or filter to narrow it.</p> : null}
    </div>
  )
}
