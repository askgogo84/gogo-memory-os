'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { postAction, errorText } from './admin-client'

export function ToolCostForm({ tools, months }: { tools: { id: string; name: string }[]; months: string[] }) {
  const router = useRouter()
  const [toolId, setToolId] = useState(tools[0]?.id || '')
  const [month, setMonth] = useState(months[0])
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  const label = (m: string) => new Date(m + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <form className="form-row" onSubmit={e => { e.preventDefault(); start(async () => { const r = await postAction('tool.cost', { toolId, month, amountInr: Number(amount), note }); setMsg(r.ok ? 'Saved.' : errorText(r.error)); if (r.ok) { setAmount(''); setNote(''); router.refresh() } }) }}>
      <div><label className="lbl" htmlFor="tc-tool">Tool</label><select id="tc-tool" className="field" style={{ width: '100%' }} value={toolId} onChange={e => setToolId(e.target.value)}>{tools.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
      <div><label className="lbl" htmlFor="tc-month">Month</label><select id="tc-month" className="field" style={{ width: '100%' }} value={month} onChange={e => setMonth(e.target.value)}>{months.map(m => <option key={m} value={m}>{label(m)}</option>)}</select></div>
      <div><label className="lbl" htmlFor="tc-amt">Amount in rupees</label><input id="tc-amt" className="field" style={{ width: '100%' }} inputMode="decimal" required value={amount} onChange={e => setAmount(e.target.value)} /></div>
      <div><label className="lbl" htmlFor="tc-note">Note (optional)</label><input id="tc-note" className="field" style={{ width: '100%' }} value={note} onChange={e => setNote(e.target.value)} placeholder="Invoice number" /></div>
      <button className="btn solid lg" type="submit" disabled={pending || !amount}>Save invoice</button>
      {msg ? <span role="status" style={{ fontSize: 13, color: 'var(--ink2)' }}>{msg}</span> : null}
    </form>
  )
}
