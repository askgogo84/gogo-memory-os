'use client'

// SecondBrain for Business — client side of the pilot workspace (approved 23 Oct mock).
// Mutations go through /api/workspaces/**, which re-check membership on the server; the controls shown
// here by role are convenience only.
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { MyInvite, MyWorkspace, WorkspaceDetail, WorkspaceMember } from '@/lib/workspaces/access'
import { canRole, INVITABLE_ROLES, ROLE_LABEL, WORKSPACE_ROLES, type WorkspaceRole } from '@/lib/workspaces/rules'

const ERRORS: Record<string, string> = {
  workspaces_not_enabled: 'SecondBrain is being set up. Try again later.',
  workspace_limit: 'You can create up to 5 workspaces.',
  member_limit: 'This workspace is full.',
  invalid_name: 'Give the workspace a name of up to 80 characters.',
  invalid_number: 'Enter a WhatsApp number with country code.',
  user_not_found: 'No AskGogo user has that WhatsApp number. Ask them to message Gogo first.',
  already_member: 'They are already in this workspace.',
  already_invited: 'They already have a pending invitation.',
  invite_not_found: 'That invitation is no longer open.',
  invite_expired: 'That invitation has expired. Ask for a new one.',
  ambiguous_number: 'That number matches more than one account. Contact support.',
  last_owner: 'A workspace needs at least one owner. Make someone else owner first.',
  workspace_forbidden: 'Your role can’t do that.',
}

async function send(url: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (res.ok) return null
    const data = await res.json().catch(() => null)
    return ERRORS[data?.error] || 'Something went wrong. Try again.'
  } catch { return 'Couldn’t reach AskGogo. Check your connection.' }
}

const ACTION_LABEL: Record<string, string> = {
  'workspace.create': 'created the workspace', 'workspace.rename': 'renamed the workspace', 'member.invite': 'invited',
  'member.accept': 'joined', 'member.decline': 'declined the invitation', 'member.revoke_invite': 'revoked the invitation for',
  'member.role': 'changed the role of', 'member.remove': 'removed', 'member.leave': 'left', 'artifact.share': 'shared a report',
  'artifact.unshare': 'unshared a report', 'artifact.view': 'opened a shared report',
}

const btn = 'flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold'
const field = 'min-h-11 w-full rounded-[12px] border border-[#262626] bg-[#151515] px-3 text-[15px] text-[#f2efea]'

export function CreateWorkspaceForm({ onDone }: { onDone?: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const res = await fetch('/api/workspaces', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(ERRORS[data?.error] || 'Couldn’t create the workspace.'); return }
      setName(''); onDone?.()
      router.push(`/dashboard/business?ws=${encodeURIComponent(data.workspace.id)}`); router.refresh()
    } catch { setError('Couldn’t reach AskGogo. Check your connection.') } finally { setBusy(false) }
  }}>
    <label className="sr-only" htmlFor="ws-name">Workspace name</label>
    <input id="ws-name" className={field} maxLength={80} required placeholder="e.g. Tipplr ops" value={name} onChange={e => setName(e.target.value)} />
    <button type="submit" disabled={busy || !name.trim()} className={`${btn} shrink-0 bg-[#2fb8a6] text-[#04201c] disabled:opacity-50`}>{busy ? 'Creating…' : 'Create workspace'}</button>
    {error && <p role="alert" className="text-[14px] text-[#d9a441] sm:basis-full">{error}</p>}
  </form>
}

export function InviteBanner({ invites }: { invites: MyInvite[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const answer = async (inv: MyInvite, decision: 'accept' | 'decline') => {
    setBusy(inv.id); setError(null)
    const problem = await send(`/api/workspaces/invites/${inv.id}`, 'POST', { decision })
    setBusy(null)
    if (problem) { setError(problem); return }
    if (decision === 'accept') router.push(`/dashboard/business?ws=${encodeURIComponent(inv.workspaceId)}`)
    router.refresh()
  }
  return <section aria-label="Invitations" className="mb-4 flex flex-col gap-2">
    {error && <p role="alert" className="text-[14px] text-[#d9a441]">{error}</p>}
    {invites.map(inv => <div key={inv.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[#2fb8a6]/40 bg-[#121212] p-4">
      <p className="min-w-0 flex-1 text-[15px] text-[#f2efea]"><b>{inv.invitedByName}</b> invited you to <b>{inv.workspaceName}</b> as {ROLE_LABEL[inv.role]}.</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy === inv.id} onClick={() => answer(inv, 'decline')} className="min-h-11 rounded-full border border-[#262626] px-4 text-[14px] text-[#9a9a96]">Decline</button>
        <button type="button" disabled={busy === inv.id} onClick={() => answer(inv, 'accept')} className={`${btn} bg-[#2fb8a6] text-[#04201c] disabled:opacity-50`}>Join</button>
      </div>
    </div>)}
    <p className="text-[13px] text-[#8a8a86]">Joining shares your name with the workspace. Your personal Gogo stays private.</p>
  </section>
}

type Tab = 'brief' | 'approvals' | 'channels' | 'people'
const TABS: { key: Tab; label: string }[] = [
  { key: 'brief', label: 'Brief' }, { key: 'approvals', label: 'Approvals' }, { key: 'channels', label: 'Channels' }, { key: 'people', label: 'People' },
]

export function BusinessWorkspace({ workspaces, detail }: { workspaces: MyWorkspace[]; detail: WorkspaceDetail }) {
  const [tab, setTab] = useState<Tab>('brief')
  const [creating, setCreating] = useState(false)
  return <>
    <header className="pb-3 lg:pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="final-dark-title text-[28px] sm:text-[32px]">SecondBrain</h1>
        {detail.pilotReadOnly && <span className="rounded-full bg-[#132a27] px-2.5 py-0.5 text-[12px] font-medium text-[#5fd3c3]">Pilot · read-only</span>}
      </div>
      <p className="mt-1.5 text-[15px] text-[#a8a8a4]">{detail.name} workspace · you are {ROLE_LABEL[detail.myRole]}</p>
    </header>

    <nav aria-label="Your workspaces" className="flex gap-2 overflow-x-auto pb-3">
      {workspaces.map(w => {
        const on = w.id === detail.id
        return <Link key={w.id} href={`/dashboard/business?ws=${encodeURIComponent(w.id)}`} scroll={false} aria-current={on ? 'page' : undefined}
          className={`flex min-h-11 shrink-0 items-center rounded-full border px-4 text-[14px] font-medium ${on ? 'border-[#2fb8a6] bg-[#132a27] text-[#f2efea]' : 'border-[#262626] bg-[#151515] text-[#9a9a96] hover:text-[#f2efea]'}`}>{w.name}</Link>
      })}
      <button type="button" onClick={() => setCreating(c => !c)} aria-expanded={creating}
        className="flex min-h-11 shrink-0 items-center rounded-full border border-[#262626] bg-[#151515] px-4 text-[14px] font-medium text-[#77d2c4]">+ New</button>
    </nav>
    {creating && <section className="mb-4 rounded-[16px] border border-[#222] bg-[#121212] p-4"><CreateWorkspaceForm onDone={() => setCreating(false)} /></section>}

    <div role="tablist" aria-label="Workspace sections" className="grid grid-cols-4 gap-1 rounded-full border border-[#262626] bg-[#151515] p-1">
      {TABS.map(t => <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
        className={`min-h-11 rounded-full text-[14px] font-medium ${tab === t.key ? 'bg-[#132a27] text-[#f2efea]' : 'text-[#9a9a96] hover:text-[#f2efea]'}`}>{t.label}</button>)}
    </div>

    <section role="tabpanel" className="mt-4">
      {tab === 'brief' && <Brief detail={detail} />}
      {tab === 'approvals' && <Placeholder text="No team approvals yet." note="This is a read-only pilot: Gogo won’t act for the team from here." />}
      {tab === 'channels' && <Placeholder text="Team channels are coming next." />}
      {tab === 'people' && <People detail={detail} />}
    </section>

    <form className="mt-6 flex gap-2" onSubmit={e => e.preventDefault()}>
      <label className="sr-only" htmlFor="ws-ask">Ask about {detail.name}</label>
      <input id="ws-ask" disabled className={`${field} disabled:opacity-70`} placeholder={`Ask about ${detail.name}…`} />
      <button type="submit" disabled className={`${btn} shrink-0 bg-[#2fb8a6] text-[#04201c] disabled:opacity-50`}>Ask</button>
    </form>
    <p className="mt-2 text-[13px] text-[#8a8a86]">Asking about the workspace arrives when workspace sources are connected.</p>
  </>
}

function Placeholder({ text, note }: { text: string; note?: string }) {
  return <div className="rounded-[16px] border border-[#222] bg-[#121212] p-5">
    <p className="text-[15px] font-medium text-[#f2efea]">{text}</p>
    {note && <p className="mt-1.5 text-[14px] text-[#9a9a96]">{note}</p>}
  </div>
}

function Brief({ detail }: { detail: WorkspaceDetail }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const admin = canRole(detail.myRole, 'remove_member')
  return <div className="flex flex-col gap-3">
    <div className="rounded-[16px] border border-[#222] bg-[#121212] p-5">
      <p className="text-[15px] leading-[1.5] text-[#a8a8a4]">Executive brief arrives when workspace sources are connected. Nothing here reads anyone’s personal data.</p>
    </div>
    <h2 className="mt-2 text-[16px] font-semibold text-[#f2efea]">Shared with the team</h2>
    {!detail.artifacts.length && <p className="text-[15px] text-[#9a9a96]">Nothing shared yet. Open a report in <Link href="/dashboard/make" className="text-[#77d2c4] underline">Make</Link> and choose Share to workspace.</p>}
    {error && <p role="alert" className="text-[14px] text-[#d9a441]">{error}</p>}
    <ul className="flex flex-col gap-2">
      {detail.artifacts.map(a => <li key={a.artifactId} className="flex items-center gap-3 rounded-[14px] border border-[#222] bg-[#121212] p-4">
        <span className="flex min-w-0 flex-1 flex-col">
          <Link href={a.sharedByYou ? `/dashboard/reports/${a.artifactId}` : `/dashboard/business/${detail.id}/shared/${a.artifactId}`} className="truncate text-[16px] font-medium text-[#f2efea] underline-offset-2 hover:underline">{a.title}</Link>
          <span className="text-[13px] text-[#8a8a86]">Shared by {a.sharedByYou ? 'you' : a.sharedByName}</span>
        </span>
        {(a.sharedByYou || admin) && <button type="button" className="min-h-11 shrink-0 rounded-full border border-[#262626] px-4 text-[14px] text-[#9a9a96]" onClick={async () => {
          setError(null)
          const problem = await send(`/api/workspaces/${detail.id}/artifacts`, 'DELETE', { artifactId: a.artifactId })
          if (problem) setError(problem); else router.refresh()
        }}>Unshare</button>}
      </li>)}
    </ul>
  </div>
}

function People({ detail }: { detail: WorkspaceDetail }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [number, setNumber] = useState('')
  const [role, setRole] = useState<WorkspaceRole>('member')
  const [busy, setBusy] = useState(false)
  const canInvite = canRole(detail.myRole, 'invite')
  const act = async (url: string, method: string, body?: unknown) => {
    setBusy(true); setError(null)
    const problem = await send(url, method, body)
    setBusy(false)
    if (problem) setError(problem); else router.refresh()
    return !problem
  }
  const rolesFor = (m: WorkspaceMember): WorkspaceRole[] => detail.myRole === 'owner' ? [...WORKSPACE_ROLES] : m.role === 'owner' || m.role === 'admin' ? [] : [...INVITABLE_ROLES]
  return <div className="flex flex-col gap-3">
    {error && <p role="alert" className="text-[14px] text-[#d9a441]">{error}</p>}
    <ul className="flex flex-col gap-2">
      {detail.members.map(m => {
        const options = canRole(detail.myRole, 'change_role') && !m.isYou ? rolesFor(m) : []
        return <li key={m.telegramId} className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[#222] bg-[#121212] p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1d1d1d] text-[14px] font-semibold text-[#f2efea]">{m.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1 truncate text-[16px] text-[#f2efea]">{m.name}{m.isYou && <span className="text-[#8a8a86]"> (you)</span>}</span>
          {options.length
            ? <select aria-label={`Role for ${m.name}`} disabled={busy} value={m.role} className="min-h-11 rounded-[12px] border border-[#262626] bg-[#151515] px-2 text-[14px] text-[#f2efea]"
                onChange={e => act(`/api/workspaces/${detail.id}/members/${encodeURIComponent(m.telegramId)}`, 'PATCH', { role: e.target.value })}>
                {options.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            : <span className="rounded-full bg-[#132a27] px-2.5 py-0.5 text-[12px] font-medium text-[#5fd3c3]">{ROLE_LABEL[m.role]}</span>}
          {(m.isYou || options.length > 0) && <button type="button" disabled={busy} className="min-h-11 rounded-full border border-[#262626] px-4 text-[14px] text-[#9a9a96]"
            onClick={async () => {
              if (!window.confirm(m.isYou ? `Leave ${detail.name}?` : `Remove ${m.name} from ${detail.name}?`)) return
              const ok = await act(`/api/workspaces/${detail.id}/members/${encodeURIComponent(m.telegramId)}`, 'DELETE')
              if (ok && m.isYou) router.push('/dashboard/business')
            }}>{m.isYou ? 'Leave' : 'Remove'}</button>}
        </li>
      })}
    </ul>
    {canInvite && detail.pendingInvites.length > 0 && <div className="mt-2 flex flex-col gap-2">
      <h2 className="text-[16px] font-semibold text-[#f2efea]">Waiting to accept</h2>
      {detail.pendingInvites.map(inv => <div key={inv.id} className="flex items-center gap-3 rounded-[14px] border border-dashed border-[#2a2a2a] p-4">
        <span className="min-w-0 flex-1 truncate text-[15px] text-[#f2efea]">{inv.name} <span className="text-[#8a8a86]">· {ROLE_LABEL[inv.role]}</span></span>
        <button type="button" disabled={busy} className="min-h-11 rounded-full border border-[#262626] px-4 text-[14px] text-[#9a9a96]"
          onClick={() => act(`/api/workspaces/${detail.id}/invites/${inv.id}`, 'DELETE')}>Revoke</button>
      </div>)}
    </div>}
    {canInvite && <form className="mt-2 flex flex-col gap-3 rounded-[16px] border border-[#222] bg-[#121212] p-4" onSubmit={async e => {
      e.preventDefault()
      if (await act(`/api/workspaces/${detail.id}/members`, 'POST', { whatsapp: number, role })) setNumber('')
    }}>
      <h2 className="text-[16px] font-semibold text-[#f2efea]">Invite someone who uses AskGogo</h2>
      <label className="sr-only" htmlFor="ws-invite">WhatsApp number</label>
      <input id="ws-invite" inputMode="tel" required className={field} placeholder="WhatsApp number, e.g. +91 98765 43210" value={number} onChange={e => setNumber(e.target.value)} />
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="ws-invite-role">Role</label>
        <select id="ws-invite-role" value={role} onChange={e => setRole(e.target.value as WorkspaceRole)} className="min-h-11 flex-1 rounded-[12px] border border-[#262626] bg-[#151515] px-2 text-[15px] text-[#f2efea]">
          {INVITABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button type="submit" disabled={busy || !number.trim()} className={`${btn} bg-[#2fb8a6] text-[#04201c] disabled:opacity-50`}>Invite</button>
      </div>
      <p className="text-[13px] text-[#8a8a86]">They join only after accepting. They see only what members share here, never your personal Gogo.</p>
    </form>}
    {detail.audit.length > 0 && <details className="mt-2 rounded-[16px] border border-[#222] bg-[#121212] p-4">
      <summary className="min-h-11 cursor-pointer text-[15px] font-semibold text-[#f2efea]">Activity</summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {detail.audit.map((r, i) => <li key={i} className="text-[14px] text-[#a8a8a4]">{r.actorName} · {ACTION_LABEL[r.action] || r.action}{r.targetName && r.targetName !== r.actorName ? ` · ${r.targetName}` : ''} <span className="text-[#8a8a86]">· {new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></li>)}
      </ul>
    </details>}
  </div>
}
