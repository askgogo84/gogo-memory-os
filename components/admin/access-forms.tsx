'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { postAction, errorText } from './admin-client'

export function AddAdminForm() {
  const router = useRouter()
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [role, setRole] = useState('viewer'), [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  return (
    <form className="card form-row" onSubmit={e => { e.preventDefault(); start(async () => { const r = await postAction('admin.add', { name, phone, role }); setMsg(r.ok ? r.message || 'Added.' : errorText(r.error)); if (r.ok) { setName(''); setPhone(''); router.refresh() } }) }}>
      <div><label className="lbl" htmlFor="a-name">Name</label><input id="a-name" className="field" style={{ width: '100%', background: '#fff' }} value={name} onChange={e => setName(e.target.value)} placeholder="Nithin" required /></div>
      <div><label className="lbl" htmlFor="a-phone">WhatsApp number</label><input id="a-phone" className="field" style={{ width: '100%', background: '#fff' }} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91" required /></div>
      <div><label className="lbl" htmlFor="a-role">Role</label><select id="a-role" className="field" style={{ width: '100%', background: '#fff' }} value={role} onChange={e => setRole(e.target.value)}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="owner">Owner</option></select></div>
      <button className="btn solid lg" type="submit" disabled={pending}>Add admin</button>
      {msg ? <span role="status" style={{ fontSize: 13, color: 'var(--ink2)', flexBasis: '100%' }}>{msg}</span> : null}
    </form>
  )
}

export function PasswordForm() {
  const router = useRouter()
  const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [msg, setMsg] = useState('')
  const [pending, start] = useTransition()
  return (
    <form className="form-row" onSubmit={e => { e.preventDefault(); if (pw !== pw2) { setMsg("The two passwords don't match."); return } start(async () => { const r = await postAction('password.change', { password: pw }); setMsg(r.ok ? r.message || 'Changed.' : errorText(r.error)); if (r.ok) router.push('/admin/unlock') }) }}>
      <div><label className="lbl" htmlFor="np">New password</label><input id="np" className="field" style={{ width: '100%' }} type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required /></div>
      <div><label className="lbl" htmlFor="np2">Type it again</label><input id="np2" className="field" style={{ width: '100%' }} type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required /></div>
      <button className="btn lg" type="submit" disabled={pending || !pw}>Change password</button>
      {msg ? <span role="status" style={{ fontSize: 13, color: 'var(--ink2)', flexBasis: '100%' }}>{msg}</span> : null}
    </form>
  )
}
