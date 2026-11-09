import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { listTaste, tasteFrom } from '@/lib/agent/taste'
import { TasteList } from '@/components/dashboard/taste-list'
import { CardError } from '@/components/dashboard/card-error'

export const dynamic = 'force-dynamic'

// Remember and suggest, Phase 1 (approved mockup "Your taste, as Gogo knows it").
export default async function TastePage() {
  const session = await getSession()
  const facts = session?.telegramId ? await listTaste(String(session.telegramId)) : null
  return <div className="mx-auto w-full max-w-[760px] pb-10">
    <header className="border-b border-[#1f1f1f] pb-5">
      <div className="final-dark-eyebrow">Your taste, as Gogo knows it</div>
      <h1 className="final-dark-title mt-2 text-[34px]">Food</h1>
      <p className="mt-2 max-w-2xl text-[16px] leading-6 text-[#9a9a9a]">Gogo uses this to suggest, never to order on its own. Forget anything.</p>
    </header>
    <section className="mt-5 final-dark-panel p-3 sm:p-4">
      {facts === null
        ? <CardError message="Food taste isn’t switched on yet. Anything you tell Gogo is still kept in Memory." />
        : <TasteList initial={facts.map(f => ({ id: f.id, text: f.value, from: tasteFrom(f) }))} />}
    </section>
    <p className="mt-4 text-[14px] leading-6 text-[#9a9a9a]">Tell Gogo anything new in chat, like “I’m veg on Tuesdays”, “no mushrooms please” or “keep lunch under ₹300”. <Link href="/dashboard/memory" className="underline">All memory</Link></p>
  </div>
}
