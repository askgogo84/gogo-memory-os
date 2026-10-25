import Link from 'next/link'
import { SwitchNumberButton } from '@/components/dashboard/switch-number-button'

// 24 Oct live: a deck made from one WhatsApp number was opened on a phone signed in with the owner's second number,
// and the bare 404 gave no way forward. Same privacy (nothing about the result is shown), with the way out.
export default function ReportNotFound() {
  return <div className="mx-auto max-w-3xl px-0 pb-10">
    <Link href="/dashboard/make" className="inline-flex min-h-11 items-center text-[16px] text-[#2FB8A6]">← Make</Link>
    <h1 className="mt-5 font-serif text-3xl text-[#F2EFEA]">This isn&apos;t in the account you&apos;re signed in with</h1>
    <p className="mt-3 text-[16px] leading-6 text-[#9A9A9A]">It may have been made from a different WhatsApp number, or removed. Sign in with the number you messaged Gogo from and the link will open.</p>
    <SwitchNumberButton />
  </div>
}
