import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { spacesEnabledFor, liveSourceDeps, permissionReader } from '@/lib/spaces/sources-live'
import { getSpace } from '@/lib/spaces/store'
import { resolveSpace } from '@/lib/spaces/sources'
import { SpaceBlocks } from '@/components/dashboard/spaces/space-blocks'

export const dynamic = 'force-dynamic'

export default async function SpacePage({ params }: { params: Promise<{ slug: string }> }) {
  const session = await getSession()
  const owner = session ? String(session.telegramId) : ''
  if (!owner || !spacesEnabledFor(owner)) notFound()
  const { slug } = await params
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(slug)) notFound()
  const space = await getSpace(supabaseAdmin, { kind: 'user', telegramId: owner }, slug).catch(() => null)
  if (!space) notFound()
  const { rowId: _r, ...doc } = space
  const data = await resolveSpace(doc, { owner, now: Date.now(), tz: 'Asia/Kolkata', deps: liveSourceDeps() }, await permissionReader(owner))
  return <div className="mx-auto w-full max-w-[880px] pb-10">
    <header className="pb-4 lg:pt-4">
      <Link href="/dashboard/spaces" className="final-dark-muted text-[13px]">← Spaces</Link>
      <h1 className="final-dark-title mt-1.5 text-[26px] sm:text-[30px]">{doc.title}</h1>
      <p className="final-dark-muted mt-1 text-[13px]">Version {doc.version} · refreshes every {doc.refreshMinutes} min · reload to update</p>
    </header>
    <SpaceBlocks space={doc} data={data}/>
  </div>
}
