import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { artifactSections } from '@/lib/agent/artifact-presentation'
import { getSharedArtifact, WorkspaceError } from '@/lib/workspaces/access'

export const dynamic = 'force-dynamic'

// SecondBrain: a report shared into a workspace, read-only for members. getSharedArtifact checks membership,
// that the share exists and that the sharer still owns the report; every open is written to the audit trail.
export default async function SharedArtifactPage({ params }: { params: Promise<{ ws: string; id: string }> }) {
  const session = await getSession()
  if (!session) notFound()
  const { ws, id } = await params
  let view
  try { view = await getSharedArtifact(String(session.telegramId), ws, id) }
  catch (err) { if (err instanceof WorkspaceError) notFound(); throw err }
  const sections = artifactSections(view.contentJson)
  return <div className="mx-auto max-w-3xl pb-10">
    <Link href={`/dashboard/business?ws=${encodeURIComponent(ws)}`} className="inline-flex min-h-11 items-center text-[16px] text-[#2FB8A6]">← SecondBrain</Link>
    <h1 className="mt-3 text-[26px] font-semibold text-[#F2EFEA]">{view.title}</h1>
    <p className="mt-1 text-[14px] text-[#9A9A9A]">Shared by {view.sharedByYou ? 'you' : view.sharedByName} · read-only</p>
    {sections.length ? sections.map((section, index) => <section key={index} className="mt-5 rounded-xl border border-[#2A2A2A] p-5">
      <h2 className="text-lg font-semibold text-[#F2EFEA]">{section.title}</h2>
      <p className="mt-3 whitespace-pre-wrap break-words text-[16px] leading-6 text-[#F2EFEA]">{section.text}</p>
    </section>) : <p className="mt-6 text-[#9A9A9A]">This report has no saved sections.</p>}
  </div>
}
