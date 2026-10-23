'use client'

// "Share to workspace" on a Make report. The server re-checks that the report is yours and that your role can share.
import { useState } from 'react'

export function ShareToWorkspace({ artifactId, workspaces }: { artifactId: string; workspaces: { id: string; name: string }[] }) {
  const [target, setTarget] = useState(workspaces[0]?.id || '')
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!workspaces.length) return null
  return <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={async e => {
    e.preventDefault(); setBusy(true); setStatus(null)
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(target)}/artifacts`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artifactId }) })
      setStatus(res.ok ? 'Shared. Workspace members can now see its title.' : 'Couldn’t share this report.')
    } catch { setStatus('Couldn’t reach AskGogo. Check your connection.') } finally { setBusy(false) }
  }}>
    <label className="sr-only" htmlFor="share-ws">Workspace</label>
    <select id="share-ws" value={target} onChange={e => setTarget(e.target.value)} className="min-h-11 rounded-[12px] border border-[#262626] bg-[#151515] px-2 text-[15px] text-[#f2efea]">
      {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
    <button type="submit" disabled={busy || !target} className="flex min-h-11 items-center rounded-full border border-[#2fb8a6] px-4 text-[15px] font-medium text-[#77d2c4] disabled:opacity-50">Share to workspace</button>
    {status && <p role="status" className="basis-full text-[14px] text-[#9a9a96]">{status}</p>}
  </form>
}
