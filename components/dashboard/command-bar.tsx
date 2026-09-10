'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function CommandBar() {
  const router = useRouter()
  const [text, setText] = useState('')

  const openGogo = () => {
    const msg = text.trim()
    router.push(msg ? `/dashboard/chat?prompt=${encodeURIComponent(msg)}` : '/dashboard/chat')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        openGogo()
      }}
      className="group flex items-center gap-3 rounded-full border border-gogo-orange/16 bg-gogo-surface/92 px-[18px] py-[14px] shadow-[0_14px_42px_rgba(62,35,18,.09),0_2px_8px_rgba(241,130,25,.05)] backdrop-blur-xl transition duration-300 focus-within:border-gogo-orange/35 focus-within:shadow-[0_18px_48px_rgba(62,35,18,.11),0_0_0_4px_rgba(241,130,25,.06)]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gogo-orange-tint text-gogo-orange transition group-focus-within:bg-gogo-orange group-focus-within:text-white">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
      </span>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ask Gogo anything — stay right here in your dashboard…"
        aria-label="Ask Gogo anything"
        className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-gogo-ink outline-none placeholder:font-normal placeholder:text-gogo-ink-4"
      />
      <button
        type="submit"
        aria-label="Talk to Gogo"
        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-gogo-orange text-white shadow-[0_10px_24px_rgba(241,130,25,.28)] transition duration-200 hover:-translate-y-0.5 hover:bg-gogo-orange-deep hover:shadow-[0_14px_30px_rgba(241,130,25,.32)]"
      >
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 4v11" />
          <path d="M8 8.5l4-4 4 4" />
        </svg>
      </button>
    </form>
  )
}
