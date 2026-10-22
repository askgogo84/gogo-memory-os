'use client'

// Duet parity step 4 (approved 22 Oct mock, screen 1): one ongoing thread plus optional channels (#Saturday plan,
// #Tipplr). Channels keep their own transcript; memory, tasks and approvals stay shared across all of them.
import { FormEvent, useState } from 'react'

export type ChatChannel = { id: string; title: string }

export function ChatChannels({ channels, active, onPick, onCreate, disabled }: {
  channels: ChatChannel[]; active: string; onPick: (id: string) => void; onCreate: (title: string) => Promise<boolean>; disabled?: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const chip = (on: boolean) => `flex min-h-10 shrink-0 items-center rounded-full border px-4 text-[14px] font-medium ${on ? 'border-[#2fb8a6] bg-[#132a27] text-[#f2efea]' : 'border-[#262626] bg-[#151515] text-[#9a9a96] hover:text-[#f2efea]'}`

  async function create(e: FormEvent) {
    e.preventDefault()
    const title = name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!title || busy) return
    setBusy(true); setError('')
    const ok = await onCreate(title)
    setBusy(false)
    if (ok) { setName(''); setAdding(false) } else setError('Could not add that channel.')
  }

  return <div className="flex flex-col gap-1.5">
    <div role="tablist" aria-label="Channels" className="flex gap-2 overflow-x-auto pb-1">
      <button type="button" role="tab" aria-selected={!active} disabled={disabled} onClick={() => onPick('')} className={chip(!active)}>One thread</button>
      {channels.map(c => <button key={c.id} type="button" role="tab" aria-selected={active === c.id} disabled={disabled} onClick={() => onPick(c.id)} className={chip(active === c.id)}># {c.title}</button>)}
      {!adding && <button type="button" onClick={() => setAdding(true)} aria-label="Add a channel" className="flex min-h-10 shrink-0 items-center rounded-full border border-dashed border-[#2f2f2f] px-4 text-[14px] text-[#9a9a96] hover:text-[#f2efea]">+ Channel</button>}
    </div>
    {adding && <form onSubmit={create} className="flex flex-wrap items-center gap-2">
      <label htmlFor="new-channel" className="sr-only">Channel name</label>
      <input id="new-channel" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Saturday plan"
        className="min-h-10 min-w-0 flex-1 rounded-full border border-[#262626] bg-[#151515] px-4 text-[15px] text-[#f2efea] outline-none focus:border-[#2fb8a6]"/>
      <button type="submit" disabled={busy || !name.trim()} className="min-h-10 rounded-full bg-[#2fb8a6] px-4 text-[14px] font-semibold text-[#04201c] disabled:opacity-50">{busy ? 'Adding…' : 'Add'}</button>
      <button type="button" onClick={() => { setAdding(false); setName(''); setError('') }} className="min-h-10 rounded-full px-3 text-[14px] text-[#9a9a96] hover:text-[#f2efea]">Cancel</button>
      {error && <span role="alert" className="w-full text-[13px] text-[#d9a441]">{error}</span>}
    </form>}
  </div>
}
