import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { artifactSections, publicResearchUrl } from '@/lib/agent/artifact-presentation'
import { agentRunRefOf, artifactSourceUrls, refreshCheck, versionSummaries } from '@/lib/agent/artifact-versions'
import { ReportEditor } from '@/components/dashboard/report-editor'

export const dynamic='force-dynamic'

function sourceList(content:unknown,refs:unknown):{label:string;href?:string}[] {
  const out:{label:string;href?:string}[]=artifactSourceUrls(content).map(publicResearchUrl).filter(Boolean).map(url=>({label:url,href:url}))
  for(const ref of Array.isArray(refs)?refs:[]){
    const r:any=ref||{}
    if(r.type==='agent_run'&&/^[0-9a-f-]{36}$/i.test(String(r.id||'')))out.push({label:'The Gogo task that made this',href:`/dashboard/activity/${encodeURIComponent(String(r.id))}`})
    else if(r.type==='google_drive_file')out.push({label:`Google Drive: ${String(r.name||'file').slice(0,180)}`})
    else if(r.type==='goal')out.push({label:'Your goal',href:'/dashboard/agent?section=goals'})
  }
  return out
}

export default async function ReportPage({params}:{params:Promise<{id:string}>}) {
  const session=await getSession()
  if(!session)notFound()
  const {id}=await params
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound()
  const telegramId=String(session.telegramId)
  const {data:report,error}=await supabaseAdmin.from('agent_artifacts')
    .select('title,subtitle,content_json,source_refs,updated_at').eq('id',id).eq('telegram_id',telegramId).maybeSingle()
  if(error)throw new Error('report_read_unavailable')
  if(!report)notFound()
  const runRef=agentRunRefOf(report.source_refs)
  let run:any=null
  if(runRef){
    const {data}=await supabaseAdmin.from('agent_runs').select('id,status,type,title,metadata_json').eq('id',runRef).eq('telegram_id',telegramId).maybeSingle()
    run=data
  }
  const check=refreshCheck(report,run)
  return <div className="mx-auto max-w-3xl px-0 pb-10">
    <Link href="/dashboard/make" className="inline-flex min-h-11 items-center text-[16px] text-[#2FB8A6]">← Make</Link>
    <ReportEditor id={id} title={String(report.title||'Saved result')} notes={String((report.content_json as any)?.notes||'')}
      sections={artifactSections(report.content_json)} refresh={'reason' in check?{ok:false,reason:check.reason}:{ok:true,reason:''}}
      versions={versionSummaries(report.content_json)} sources={sourceList(report.content_json,report.source_refs)}/>
  </div>
}
