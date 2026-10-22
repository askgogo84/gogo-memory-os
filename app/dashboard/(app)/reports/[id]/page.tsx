import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { artifactSections } from '@/lib/agent/artifact-presentation'
import { canRole, listMyWorkspaces } from '@/lib/workspaces/access'
import { ShareToWorkspace } from '../../business/share-to-workspace'

// SecondBrain pilot: workspaces where I may share. Empty when workspaces are not enabled yet.
async function shareTargets(telegramId:string){
  try{return (await listMyWorkspaces(telegramId)).filter(w=>canRole(w.role,'share_artifact')).map(w=>({id:w.id,name:w.name}))}
  catch{return []}
}

export const dynamic='force-dynamic'

export default async function ReportPage({params}:{params:Promise<{id:string}>}) {
  const session=await getSession()
  if(!session)notFound()
  const {id}=await params
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound()
  const {data:report,error}=await supabaseAdmin.from('agent_artifacts')
    .select('title,subtitle,content_json').eq('id',id).eq('telegram_id',session.telegramId).maybeSingle()
  if(error)throw new Error('report_read_unavailable')
  if(!report)notFound()
  const sections=artifactSections(report.content_json)
  const targets=await shareTargets(String(session.telegramId))
  return <div className="mx-auto max-w-3xl pb-10">
    <Link href="/dashboard/chat" className="text-[16px] text-[#2FB8A6]">← Gogo</Link>
    <h1 className="mt-5 font-serif text-3xl text-[#F2EFEA]">{report.title}</h1>
    <p className="mt-2 text-[16px] text-[#9A9A9A]">Private report · visible only to your signed-in account{targets.length?' unless you share it':''}</p>
    <ShareToWorkspace artifactId={id} workspaces={targets}/>
    {sections.length?sections.map((section,index)=><section key={index} className="mt-6 rounded-xl border border-[#2A2A2A] p-5">
      <h2 className="text-lg font-semibold text-[#F2EFEA]">{section.title}</h2>
      <p className="mt-3 whitespace-pre-wrap break-words text-[16px] leading-6 text-[#F2EFEA]">{section.text}</p>
    </section>):<p className="mt-6 text-[#9A9A9A]">No completed source results were saved in this report.</p>}
  </div>
}
