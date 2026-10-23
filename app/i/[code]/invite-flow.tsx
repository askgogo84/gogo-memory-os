'use client'
import { useState } from 'react'

const Arrow = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
const Chat = ({ size = 24, color = '#0f6f64' }: { size?: number; color?: string }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="shrink-0"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>
const Shield = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0f6f64" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="shrink-0"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>
const Gift = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0f6f64" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" className="shrink-0"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1.5S9 8 12 8zm0 0c2-4 6-4 6-1.5S15 8 12 8z"/></svg>

const primary = 'flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl text-[18px] font-semibold text-white'

export function InviteFlow(p: { inviterFirstName: string | null; code: string; remaining: number; joinHref: string; joinText: string }) {
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const who = p.inviterFirstName || 'A friend'
  const shell = 'mx-auto flex min-h-dvh w-full max-w-[440px] flex-col px-7 py-10'

  if (step === 0) return (
    <div className={`${shell} items-center justify-center gap-6 text-center`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/gogo-figure.png" alt="" width={120} height={120} className="h-[120px] w-[120px] object-contain" />
      <div className="text-[40px] font-semibold tracking-tight">AskGogo</div>
      <p className="text-[18px] leading-relaxed text-[#4a4650]">Welcome, <b className="text-[#1d1b20]">{who}</b> invited you to AskGogo, the assistant that remembers and gets things done on WhatsApp.</p>
      <button type="button" onClick={() => setStep(1)} className={`${primary} bg-[#1d1b20]`}>Get started <Arrow /></button>
    </div>
  )

  if (step === 1) return (
    <div className={`${shell} gap-7 pt-16`}>
      <div className="text-center text-[36px] font-semibold tracking-tight">AskGogo</div>
      <ul className="flex flex-1 flex-col gap-6">
        <li className="flex gap-3.5"><Chat /><div><div className="text-[17px] font-semibold">Lives in your WhatsApp</div><p className="mt-1 text-[15px] leading-normal text-[#5f5b66]">Reminders, flights, bills, lists and research. Same Gogo on the web dashboard.</p></div></li>
        <li className="flex gap-3.5"><Shield /><div><div className="text-[17px] font-semibold">You&apos;re in control</div><p className="mt-1 text-[15px] leading-normal text-[#5f5b66]">Gogo asks before it books, pays or sends anything. Connect only what you want; delete your data any time.</p></div></li>
        <li className="flex gap-3.5"><Gift /><div><div className="text-[17px] font-semibold">You get 10 invites too</div><p className="mt-1 text-[15px] leading-normal text-[#5f5b66]">Ask Gogo for your private link any time to bring friends or your team.</p></div></li>
      </ul>
      <button type="button" onClick={() => setStep(2)} className={`${primary} bg-[#1d1b20]`}>Continue <Arrow /></button>
    </div>
  )

  return (
    <div className={`${shell} justify-center gap-5`}>
      <h1 className="text-[34px] font-semibold leading-tight tracking-tight">Start on WhatsApp</h1>
      <p className="text-[17px] leading-relaxed text-[#4a4650]">Tap below and send the message that opens. Gogo replies in a few seconds; no app to install, no password.</p>
      <div className="rounded-2xl border border-[#e6dfd4] bg-white px-4 py-3.5 text-[16px] text-[#4a4650]">{p.joinText}</div>
      <a href={p.joinHref} className={`${primary} bg-[#1f8f5f]`}><Chat size={20} color="currentColor" />Open WhatsApp</a>
      <a href="/dashboard" className="flex min-h-12 items-center justify-center rounded-2xl border border-[#d9d2c7] text-[16px] font-medium text-[#1d1b20]">Already on AskGogo? Open your dashboard</a>
      <p className="text-[13px] leading-normal text-[#5f5b66]">By continuing you agree to AskGogo&apos;s <a href="https://askgogo.in/terms" className="underline">Terms</a> and <a href="https://askgogo.in/privacy" className="underline">Privacy Policy</a>. {p.inviterFirstName || 'Your friend'} only sees that you joined, nothing else.</p>
    </div>
  )
}
