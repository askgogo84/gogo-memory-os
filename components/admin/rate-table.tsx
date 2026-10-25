'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { postAction, errorText } from './admin-client'

type Rate = { key: string; label: string; unit: string; usd: string; inr: string; note: string }
export function RateTable({ rows, canEdit }: { rows: Rate[]; canEdit: boolean }) {
  const router = useRouter()
  const [vals, setVals] = useState<Record<string, Rate>>(Object.fromEntries(rows.map(r => [r.key, r])))
  const [msg, setMsg] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()
  if (!rows.length) return <p className="note">The rate card appears once the admin console migration is applied.</p>
  return (
    <div className="adm-table">
      <table>
        <thead><tr><th scope="col">Item</th><th scope="col">Unit</th><th scope="col">US dollars</th><th scope="col">Rupees</th><th scope="col">Note</th>{canEdit ? <th scope="col"><span className="sr">Save</span></th> : null}</tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td style={{ fontWeight: 500 }}>{r.label}</td><td style={{ color: 'var(--ink2)' }}>{r.unit}</td>
              <td>{canEdit ? <input aria-label={`${r.label} in dollars`} className="field" style={{ width: 110 }} inputMode="decimal" value={vals[r.key].usd} onChange={e => setVals(v => ({ ...v, [r.key]: { ...v[r.key], usd: e.target.value } }))} /> : r.usd || '—'}</td>
              <td>{canEdit ? <input aria-label={`${r.label} in rupees`} className="field" style={{ width: 110 }} inputMode="decimal" value={vals[r.key].inr} onChange={e => setVals(v => ({ ...v, [r.key]: { ...v[r.key], inr: e.target.value } }))} /> : r.inr || '—'}</td>
              <td style={{ color: 'var(--ink3)' }}>{msg[r.key] || r.note}</td>
              {canEdit ? <td><button type="button" className="btn sm" disabled={pending || (vals[r.key].usd === r.usd && vals[r.key].inr === r.inr)} onClick={() => start(async () => { const x = await postAction('rate.update', { key: r.key, usd: vals[r.key].usd, inr: vals[r.key].inr }); setMsg(m => ({ ...m, [r.key]: x.ok ? 'Saved' : errorText(x.error) })); if (x.ok) router.refresh() })}>Save</button></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
