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

/** Phone (approved 22 Oct full-screen mock): one compact pill that opens the channel list, instead of a chip row. */
export function ChannelPill({ channels, active, onPick, onCreate, disabled }: {
  channels: ChatChannel[]; active: string; onPick: (id: string) => void; onCreate: (title: string) => Promise<boolean>; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const label = active ? `# ${channels.find(c => c.id === active)?.title || 'Channel'}` : 'One thread'
  const row = (on: boolean) => `flex min-h-11 w-full items-center rounded-[10px] px-3 text-left text-[15px] ${on ? 'bg-[#132a27] font-semibold text-[#f2efea]' : 'text-[#f2efea] hover:bg-[#151515]'}`
  async function create(e: FormEvent) {
    e.preventDefault()
    const title = name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!title || busy) return
    setBusy(true)
    const ok = await onCreate(title)
    setBusy(false)
    if (ok) { setName(''); setAdding(false); setOpen(false) }
  }
  return <div className="relative">
    <button type="button" onClick={() => setOpen(o => !o)} disabled={disabled} aria-expanded={open} aria-haspopup="listbox"
      className="flex h-10 max-w-[52vw] items-center gap-1.5 rounded-full border border-[#262626] bg-[#151515] px-3.5 text-[14px] font-semibold text-[#f2efea] disabled:opacity-60">
      <span className="truncate">{label}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    {open && <>
      <button type="button" aria-label="Close channels" onClick={() => { setOpen(false); setAdding(false) }} className="fixed inset-0 z-40 cursor-default"/>
      <div role="listbox" aria-label="Channels" className="absolute left-1/2 top-12 z-50 w-[250px] -translate-x-1/2 rounded-[16px] border border-[#262626] bg-[#121212] p-1.5 shadow-[0_10px_30px_rgba(0,0,0,.25)]">
        <button type="button" role="option" aria-selected={!active} onClick={() => { onPick(''); setOpen(false) }} className={row(!active)}>One thread</button>
        {channels.map(c => <button key={c.id} type="button" role="option" aria-selected={active === c.id} onClick={() => { onPick(c.id); setOpen(false) }} className={row(active === c.id)}># {c.title}</button>)}
        {!adding && <button type="button" onClick={() => setAdding(true)} className="mt-1 flex min-h-11 w-full items-center border-t border-[#1f1f1f] px-3 text-left text-[15px] font-semibold text-[#5fd3c3]">+ New channel</button>}
        {adding && <form onSubmit={create} className="mt-1 flex gap-1.5 border-t border-[#1f1f1f] pt-1.5">
          <label htmlFor="new-channel-pill" className="sr-only">Channel name</label>
          <input id="new-channel-pill" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Saturday plan"
            className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-[#262626] bg-[#151515] px-3 text-[15px] text-[#f2efea] outline-none focus:border-[#2fb8a6]"/>
          <button type="submit" disabled={busy || !name.trim()} className="min-h-11 rounded-[10px] bg-[#2fb8a6] px-3 text-[14px] font-semibold text-[#04201c] disabled:opacity-50">{busy ? '…' : 'Add'}</button>
        </form>}
      </div>
    </>}
  </div>
}
