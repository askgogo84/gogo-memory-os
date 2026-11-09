'use client'

// Approval card v2 (approved 23 Oct mock, screen 2): the exact action, its details, what happens on yes, why Gogo is
// asking and when the card expires. Buttons: yes · Later · Change · Don't. Nothing runs without the yes.
import Link from 'next/link'
import { approvalAction, previewRows, whenLabel } from '@/lib/agent/approval-card'

export type ApprovalCardData = {
  id: string; runId?: string | null; actionType?: string | null; title: string; description?: string | null
  preview?: unknown; risk?: string | null; expiresAt?: string | null; deferredUntil?: string | null
}

export function ApprovalCard({ approval, busy, onDecide }: {
  approval: ApprovalCardData; busy?: boolean; onDecide: (decision: 'approve' | 'reject' | 'defer') => void
}) {
  const action = approvalAction(approval.actionType)
  const rows = previewRows(approval.preview)
  const expires = whenLabel(approval.expiresAt)
  const later = whenLabel(approval.deferredUntil)
  // An approval past its expiry is not actionable: the route refuses it, so the card says so instead of offering buttons.
  const expired = !!approval.expiresAt && Number.isFinite(Date.parse(approval.expiresAt)) && Date.parse(approval.expiresAt) <= Date.now()
  const change = `/dashboard/chat?prompt=${encodeURIComponent(`Before you do it, change this: ${approval.title}. `)}`
  return <article className={`rounded-[18px] border border-gogo-ink/10 bg-white p-4 text-gogo-ink${expired ? ' opacity-70' : ''}`}>
    <div className="text-[12px] font-semibold uppercase tracking-[.06em] text-gogo-ink-3">{action.label}{approval.risk === 'high' ? ' · high impact' : ''}</div>
    <h3 className="mt-1 text-[17px] font-semibold leading-snug">{approval.title}</h3>
    {later && <p className="mt-1 text-[13px] text-gogo-ink-3">You said later · Gogo asks again {later}</p>}
    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-[14px] bg-gogo-cream/40 p-3 text-[14px]">
      {rows.map(r => <div key={r.label} className="contents"><dt className="text-gogo-ink-3">{r.label}</dt><dd className="break-words">{r.value}</dd></div>)}
      <dt className="text-gogo-ink-3">What happens</dt><dd>{action.happens}</dd>
      {expires && <><dt className="text-gogo-ink-3">{expired ? 'Expired' : 'Expires'}</dt><dd>{expires}{expired ? '' : ', then Gogo asks again'}</dd></>}
    </dl>
    {approval.description && <div className="mt-3 text-[14px] leading-snug text-gogo-ink-2"><span className="font-semibold">Why Gogo is asking. </span>{approval.description}</div>}
    {expired ? <div className="mt-4 rounded-full border border-gogo-ink/12 bg-gogo-cream/40 px-4 py-3 text-center text-[14px] text-gogo-ink-2">Expired, nothing was done. Ask again and Gogo prepares a fresh request.</div>
    : <div className="mt-4 flex flex-col gap-2">
      <button type="button" disabled={busy} onClick={() => onDecide('approve')} className="min-h-12 rounded-full bg-gogo-ink px-5 text-[15px] font-semibold text-white disabled:opacity-50">{action.yes}</button>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" disabled={busy} onClick={() => onDecide('defer')} className="min-h-11 rounded-full border border-gogo-ink/12 bg-white text-[14px] font-medium disabled:opacity-50">Later</button>
        <Link href={change} className="flex min-h-11 items-center justify-center rounded-full border border-gogo-ink/12 bg-white text-[14px] font-medium">Change</Link>
        <button type="button" disabled={busy} onClick={() => onDecide('reject')} className="min-h-11 rounded-full border border-gogo-ink/12 bg-white text-[14px] font-medium text-red-700 disabled:opacity-50">Don’t</button>
      </div>
    </div>}
  </article>
}
