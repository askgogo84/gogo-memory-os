'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const LABEL: Record<string, string> = { my_day: 'My Day & Open Loops', trip_board: 'Trip Board', tipplr_exceptions: 'Tipplr Outlet Exceptions' }

// Creates a Space from a template (POST /api/dashboard/spaces) and opens it.
export function CreateSpace({ templates, workspace }: { templates: string[]; workspace?: string }) {
  const router = useRouter(); const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null)
  const make = async (t: string) => {
    setBusy(t); setErr(null)
    try {
      const r = await fetch('/api/dashboard/spaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workspace ? { template: t, workspace } : { template: t }) })
      const j = await r.json().catch(() => ({}))
      if (j.ok || j.error === 'exists') { router.push(`/dashboard/spaces/${t}${workspace ? `?workspace=${workspace}` : ''}`); return }
      setErr(j.error === 'spaces_not_enabled' ? 'Spaces is being set up. Try again shortly.' : "Couldn't create it just now.")
    } finally { setBusy(null) }
  }
  return <div className="flex flex-col gap-2 sm:flex-row">{templates.map(t => <button key={t} disabled={!!busy} onClick={() => make(t)} className="final-dark-card min-h-[48px] px-4 py-3 text-left text-[15px] font-medium text-[#ecebe8] disabled:opacity-60">{busy === t ? 'Creating…' : `+ ${LABEL[t] || t}`}</button>)}{err && <p className="final-dark-danger text-[13px]">{err}</p>}</div>
}
