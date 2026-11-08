import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { spacesEnabledFor, liveSourceDeps, permissionReader } from '@/lib/spaces/sources-live'
import { getSpace } from '@/lib/spaces/store'
import { requireWorkspaceRole } from '@/lib/workspaces/access'
import { resolveSpace } from '@/lib/spaces/sources'
import { SpaceBlocks } from '@/components/dashboard/spaces/space-blocks'

export const dynamic = 'force-dynamic'

export default async function SpacePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ workspace?: string }> }) {
  const session = await getSession()
  const owner = session ? String(session.telegramId) : ''
  if (!owner || !spacesEnabledFor(owner)) notFound()
  const { slug } = await params
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(slug)) notFound()
  const ws = String((await searchParams).workspace || '').toLowerCase()
  let scope: { kind: 'user'; telegramId: string } | { kind: 'workspace'; workspaceId: string } = { kind: 'user', telegramId: owner }
  if (ws) {
    if (!/^[0-9a-f-]{36}$/.test(ws)) notFound()
    // Membership is checked before anything of the workspace is read.
    const ok = await requireWorkspaceRole(owner, ws, 'view').then(() => true, () => false)
    if (!ok) notFound()
    scope = { kind: 'workspace', workspaceId: ws }
  }
  const space = await getSpace(supabaseAdmin, scope, slug).catch(() => null)
  if (!space) notFound()
  const { rowId: _r, ...doc } = space
  const data = await resolveSpace(doc, { owner, now: Date.now(), tz: 'Asia/Kolkata', deps: liveSourceDeps() }, scope.kind === 'workspace' ? () => 'read' as const : await permissionReader(owner))
  return <div className="mx-auto w-full max-w-[880px] pb-10">
    <header className="pb-4 lg:pt-4">
      <Link href="/dashboard/spaces" className="final-dark-muted text-[13px]">← Spaces</Link>
      <h1 className="final-dark-title mt-1.5 text-[26px] sm:text-[30px]">{doc.title}</h1>
      <p className="final-dark-muted mt-1 text-[13px]">{scope.kind === 'workspace' ? 'Team Space · ' : ''}Version {doc.version} · refreshes every {doc.refreshMinutes} min · reload to update</p>
    </header>
    <SpaceBlocks space={doc} data={data}/>
  </div>
}
