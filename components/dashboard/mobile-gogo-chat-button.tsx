'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function MobileGogoChatButton() {
  const pathname = usePathname()
  if (pathname.startsWith('/dashboard/chat')) return null
  return (
    <Link href="/dashboard/chat" className="fixed bottom-[4.8rem] right-4 z-30 flex items-center gap-2 rounded-full border border-gogo-ink/9 bg-gogo-surface/92 py-2 pl-2 pr-3 text-[11px] font-bold text-gogo-ink shadow-[0_14px_38px_rgba(62,35,18,.15)] backdrop-blur-xl lg:hidden" aria-label="Talk to Gogo">
      <img src="/gogo-figure.png" alt="" className="h-8 w-8 rounded-full object-cover" />
      Talk to Gogo
    </Link>
  )
}
