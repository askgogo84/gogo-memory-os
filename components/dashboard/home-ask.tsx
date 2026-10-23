'use client'

// Home's big chat box (Wajo layout): a roomy composer in the middle of the page. Enter sends to the Gogo chat,
// Shift+Enter adds a line; + opens the chat to attach a file, the mic opens the chat ready to talk.
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Companion } from '@/components/gogo/companion'
import { useGogoLive } from './gogo-live'

export function HomeAsk({ compact = false }: { compact?: boolean } = {}) {
  const router = useRouter()
  const [text, setText] = useState('')
  const send = () => {
    const msg = text.trim()
    router.push(msg ? `/dashboard/chat?prompt=${encodeURIComponent(msg)}` : '/dashboard/chat')
  }
  if (compact) return <form onSubmit={e => { e.preventDefault(); send() }}
    className="flex w-full items-center gap-1 rounded-[22px] border border-[#2a2a2a] bg-[#151515] py-1.5 pl-4 pr-1.5 focus-within:border-[#2fb8a6]">
    <label htmlFor="home-ask" className="sr-only">Ask Gogo anything</label>
    <input id="home-ask" value={text} onChange={e => setText(e.target.value)} placeholder="Ask Gogo anything…"
      className="min-w-0 flex-1 bg-transparent text-[16px] leading-6 text-[#f2efea] outline-none placeholder:text-[#8a8a86]"/>
    <a href="/dashboard/chat?voice=1" aria-label="Talk to Gogo" className="grid h-11 w-11 place-items-center rounded-full text-[#c4c4c0] hover:bg-[#1f1f1f]">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
    </a>
    <button type="submit" aria-label="Send to Gogo" className="grid h-11 w-11 place-items-center rounded-full bg-[#2fb8a6] text-[#04201c]">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V6M6 11l6-6 6 6"/></svg>
    </button>
  </form>
  return <form onSubmit={e => { e.preventDefault(); send() }}
    className="w-full rounded-[24px] border border-[#2a2a2a] bg-[#151515] px-4 pb-2.5 pt-3.5 text-left shadow-[0_12px_40px_rgba(0,0,0,.25)] focus-within:border-[#2fb8a6]">
    <label htmlFor="home-ask" className="sr-only">Ask Gogo anything</label>
    <textarea id="home-ask" rows={2} value={text} onChange={e => setText(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
      placeholder="Ask Gogo anything…"
      className="block w-full resize-none bg-transparent text-[16px] leading-6 text-[#f2efea] outline-none placeholder:text-[#8a8a86]"/>
    <div className="mt-1 flex items-center justify-between">
      <a href="/dashboard/chat" aria-label="Attach a file or photo" className="grid h-10 w-10 place-items-center rounded-full text-[#c4c4c0] hover:bg-[#1f1f1f]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      </a>
      <div className="flex items-center gap-1">
        <a href="/dashboard/chat?voice=1" aria-label="Talk to Gogo" className="grid h-10 w-10 place-items-center rounded-full text-[#c4c4c0] hover:bg-[#1f1f1f]">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>
        </a>
        <button type="submit" aria-label="Send to Gogo" disabled={!text.trim()}
          className="grid h-10 w-10 place-items-center rounded-full bg-[#2fb8a6] text-[#04201c] disabled:opacity-40">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V6M6 11l6-6 6 6"/></svg>
        </button>
      </div>
    </div>
  </form>
}

/** Home's centre Gogo: the current action's character with its live line; tap to see everything Gogo is doing. */
export function HomeGogo({ compact = false }: { compact?: boolean } = {}) {
  const { hero, showGogo } = useGogoLive()
  if (compact) return <button type="button" onClick={showGogo} className="shrink-0 rounded-full hover:bg-[#141414]" aria-label={`What Gogo is doing: ${hero.live}`} title={hero.state === 'idle' ? hero.live : `${hero.live} · ${hero.task}`}>
    <Companion state={hero.state} size={64}/>
  </button>
  return <button type="button" onClick={showGogo} className="group flex flex-col items-center gap-1 rounded-[20px] px-4 pt-1 pb-2 hover:bg-[#141414]" aria-label={`What Gogo is doing: ${hero.live}`}>
    <Companion state={hero.state} size={132}/>
    <span className="max-w-[86vw] truncate text-[13px] text-[#9a9a96] group-hover:text-[#f2efea] sm:max-w-[560px]" aria-live="polite">{hero.state === 'idle' ? hero.live : `${hero.live} · ${hero.task}`}</span>
  </button>
}
