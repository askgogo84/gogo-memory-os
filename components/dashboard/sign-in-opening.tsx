'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/** Shown while a Settings sign-in browser starts (~50s). Refreshes the page until the browser is ready. */
export function SignInOpening({ siteName }: { siteName: string }) {
  const router = useRouter()
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const tick = setInterval(() => setSeconds(s => s + 1), 1000)
    const refresh = setInterval(() => router.refresh(), 3000)
    return () => { clearInterval(tick); clearInterval(refresh) }
  }, [router])
  return <div className="grid min-h-[430px] place-items-center px-7 py-10 text-center">
    <div className="max-w-md">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#2A2A2A] border-t-[#2FB8A6]" aria-hidden="true"/>
      <h2 className="mt-4 font-serif text-[24px] font-semibold text-[#F2EFEA]">Opening {siteName}…</h2>
      <p className="mt-2 text-[16px] leading-6 text-[#9A9A9A]" aria-live="polite">Starting your secure browser. This usually takes under a minute{seconds ? ` (${seconds}s)` : ''}. Keep this page open; the sign-in page appears here by itself.</p>
    </div>
  </div>
}
