import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { spacesEnabledFor } from '@/lib/spaces/sources-live'
import { listSpaces } from '@/lib/spaces/store'
import { CreateSpace } from '@/components/dashboard/spaces/create-space'

export const dynamic = 'force-dynamic'

// Gogo Spaces (approved mock, 8 Nov): living pages Gogo keeps current. Behind GOGO_SPACES / GOGO_SPACES_OWNERS.
export default async function SpacesPage() {
  const session = await getSession()
  const owner = session ? String(session.telegramId) : ''
  if (!owner || !spacesEnabledFor(owner)) notFound()
  let spaces: Awaited<ReturnType<typeof listSpaces>> = []; let setup = false
  try { spaces = await listSpaces(supabaseAdmin, { kind: 'user', telegramId: owner }) } catch (e: any) { setup = e?.code === 'spaces_not_enabled' }
  const have = new Set(spaces.map(s => s.slug))
  const templates = ['my_day', 'trip_board'].filter(t => !have.has(t))
  return <div className="mx-auto w-full max-w-[880px] pb-10">
    <header className="pb-5 lg:pt-4">
      <div className="final-dark-eyebrow">Spaces</div>
      <h1 className="final-dark-title mt-1.5 text-[28px] sm:text-[32px]">Pages Gogo keeps current</h1>
      <p className="mt-1.5 text-[15px] text-[#a8a8a4]">Each block reads one thing you already connected. Nothing here sends or buys anything.</p>
    </header>
    {setup && <p className="final-dark-card final-dark-amber mb-4 p-4 text-[14px]">Spaces storage isn't set up yet.</p>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{spaces.map(s => <Link key={s.slug} href={`/dashboard/spaces/${s.slug}`} className="final-dark-card block p-4"><div className="text-[16px] font-medium text-[#f2efea]">{s.title}</div><div className="final-dark-muted mt-1 text-[13px]">Version {s.version} · updated {new Date(s.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })}</div></Link>)}</div>
    {templates.length > 0 && <div className="mt-5"><div className="final-dark-eyebrow mb-2">Start from a template</div><CreateSpace templates={templates}/></div>}
  </div>
}
