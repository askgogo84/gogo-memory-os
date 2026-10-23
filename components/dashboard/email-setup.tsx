'use client'
// Settings › Email (approved mock, 23 Oct): forward new mail to a personal Gogo address (recommended), or sign in
// with Google through Composio. Copy states only; nothing here sends or changes mail.
import { useState } from 'react'
import Link from 'next/link'

export function EmailSetup(props: { address: string | null; forwardingOn: boolean; confirmationCode: string | null; googleConnected: boolean; googleEmail: string | null; notice: string | null }) {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (value: string, what: string) => {
    try { await navigator.clipboard.writeText(value); setCopied(what); setTimeout(() => setCopied(null), 1800) } catch {}
  }
  const pill = 'inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold'
  return <div className="mx-auto max-w-[640px] pb-10">
    <div className="flex items-center gap-2">
      <Link href="/dashboard/settings?section=connections" aria-label="Back to settings" className="grid h-11 w-11 place-items-center rounded-full text-[#ecebe8]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      </Link>
      <h1 className="text-[17px] font-semibold text-[#ecebe8]">Connect email</h1>
    </div>
    <h2 className="mt-5 text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#f2efea]">Let Gogo watch your inbox</h2>
    <p className="mt-2 text-[15px] leading-[1.5] text-[#a8a8a4]">Gogo reads new mail and tells you only what needs you. It never sends anything without asking.</p>
    {props.notice && <p role="status" className="mt-4 rounded-[12px] bg-[#141414] p-3 text-[14px] text-[#dcdad5]">{props.notice}</p>}

    <section className="mt-6 rounded-[16px] border border-[#ecebe8] p-4" aria-labelledby="fwd-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="fwd-title" className="text-[16px] font-semibold text-[#f2efea]">Forward new mail</h3>
        {props.forwardingOn
          ? <span className="rounded-full bg-[#123d38] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8be6d8]">On</span>
          : <span className="rounded-full bg-[#123d38] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8be6d8]">Recommended</span>}
      </div>
      <p className="mt-2 text-[14px] leading-[1.5] text-[#a8a8a4]">Works with any Gmail, Outlook or work mail. No Google warning screens. New mail only.</p>
      <div className="mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-[#8a8a86]">Your Gogo address</div>
      {props.address
        ? <div className="mt-2 flex items-center gap-2 rounded-[10px] bg-[#1c1c1c] py-1 pl-3 pr-1">
            <div className="min-w-0 flex-1 break-all font-mono text-[15px] font-medium text-[#f2efea]">{props.address}</div>
            <button type="button" onClick={() => copy(props.address!, 'address')} className="min-h-10 shrink-0 rounded-full bg-[#4cd0bd] px-4 text-[14px] font-semibold text-[#0b0b0b]">{copied === 'address' ? 'Copied' : 'Copy'}</button>
          </div>
        : <p className="mt-2 text-[14px] text-[#a8a8a4]">Your address isn't ready yet. Refresh in a minute.</p>}

      {props.confirmationCode && <div className="mt-4 rounded-[12px] border border-[#2f2f2f] p-3">
        <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#8a8a86]">Gmail confirmation code</div>
        <div className="mt-1 font-mono text-[28px] font-semibold tracking-[0.12em] text-[#f2efea]">{props.confirmationCode}</div>
        <button type="button" onClick={() => copy(props.confirmationCode!, 'code')} className={`${pill} mt-2 border border-[#2f2f2f] text-[#f2efea]`}>{copied === 'code' ? 'Copied' : 'Copy code'}</button>
      </div>}

      {!props.forwardingOn && <ol className="mt-4 list-decimal space-y-1 pl-5 text-[14px] leading-[1.6] text-[#dcdad5]">
        <li>Open Gmail on a computer › Settings › See all settings › Forwarding and POP/IMAP.</li>
        <li>Add a forwarding address and paste the address above.</li>
        <li>Gogo sends you the confirmation code in chat. Paste it in Gmail and choose "Forward a copy".</li>
      </ol>}
      {props.forwardingOn && <p className="mt-4 text-[14px] leading-[1.5] text-[#dcdad5]">Forwarding is on. Ask Gogo "emails that need me" any time.</p>}
      <a href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noreferrer" className={`${pill} mt-4 w-full bg-[#4cd0bd] text-[#0b0b0b]`}>Open Gmail forwarding settings</a>
    </section>

    <section className="mt-3 rounded-[16px] border border-[#2f2f2f] p-4" aria-labelledby="google-title">
      <h3 id="google-title" className="text-[16px] font-semibold text-[#f2efea]">Sign in with Google</h3>
      {props.googleConnected
        ? <p className="mt-2 text-[14px] leading-[1.5] text-[#dcdad5]">Connected{props.googleEmail ? ` as ${props.googleEmail}` : ''}. Gogo can read older mail too.</p>
        : <>
            <p className="mt-2 text-[14px] leading-[1.5] text-[#a8a8a4]">Gogo can also read older mail. Google's sign-in will show "Composio" as the app until AskGogo's own verification is approved.</p>
            <a href="/api/email/google/connect" className={`${pill} mt-4 w-full gap-2 border border-[#2f2f2f] text-[#f2efea]`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
              Continue with Google
            </a>
          </>}
    </section>
    <p className="mt-5 text-[13px] leading-[1.5] text-[#8a8a86]">You can stop forwarding any time in Gmail. Gogo deletes forwarded mail after 30 days.</p>
  </div>
}
