import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { getUserLearningReport } from '@/lib/agent/learning-report'
import { BrainReport } from '@/components/dashboard/brain-report'

export const dynamic='force-dynamic'
export default async function BrainPage({searchParams}:{searchParams:Promise<{hours?:string}>}){
  const session=await getSession()
  if(!session)redirect('/dashboard')
  const params=await searchParams
  const hours=[24,168,720].includes(Number(params.hours))?Number(params.hours):168
  let report
  try{report=await getUserLearningReport(session.telegramId,{hours,limit:1000})}catch{}
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs uppercase tracking-widest text-[#2fb8a6]">Same Brain v2</p><h1 className="mt-2 text-3xl font-semibold">Brain &amp; Autonomy</h1><p className="mt-2 text-sm text-[#aaa]">Measured learning and efficiency from your production outcomes.</p></div>
      <nav aria-label="Evidence window" className="flex gap-2">{[[24,'24 hours'],[168,'7 days'],[720,'30 days']].map(([h,label])=><Link key={h} href={`/dashboard/brain?hours=${h}`} aria-current={hours===h?'page':undefined} className={`rounded-lg border px-3 py-2 text-sm ${hours===h?'border-[#2fb8a6] text-[#2fb8a6]':'border-[#333] text-[#aaa]'}`}>{label}</Link>)}</nav>
    </header>
    {report?<BrainReport report={report}/>:<div role="alert" className="rounded-xl border border-[#665230] p-6"><h2 className="font-medium">Evidence is temporarily unavailable</h2><p className="mt-2 text-sm text-[#bbb]">We could not read the measurements. Counts and confidence will appear when the evidence store is available.</p><Link href={`/dashboard/brain?hours=${hours}`} className="mt-4 inline-block underline">Try again</Link></div>}
  </div>
}
