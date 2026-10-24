import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { artifactSections, publicResearchUrl } from '@/lib/agent/artifact-presentation'
import { agentRunRefOf, artifactSourceUrls, refreshCheck, versionSummaries } from '@/lib/agent/artifact-versions'
import { ReportEditor } from '@/components/dashboard/report-editor'
import { canRole, listMyWorkspaces } from '@/lib/workspaces/access'
import { ShareToWorkspace } from '../../business/share-to-workspace'
import { MakeDocViewer } from '@/components/dashboard/make-doc-viewer'
import { linkedTelegramIds } from '@/lib/dashboard/owner-ids'

// SecondBrain pilot: workspaces where I may share. Empty when workspaces are not enabled yet.
async function shareTargets(telegramId:string){
  try{return (await listMyWorkspaces(telegramId)).filter(w=>canRole(w.role,'share_artifact')).map(w=>({id:w.id,name:w.name}))}
  catch{return []}
}

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
  const {id}=await params
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))notFound()
  // 24 Oct live: a deck link opened from WhatsApp on the phone showed a bare 404 because that browser was not
  // signed in. Sign in first, then land back on this result (the link itself is never a login credential).
  const session=await getSession()
  if(!session)redirect('/dashboard?next='+encodeURIComponent(`/dashboard/reports/${id}`))
  const telegramId=String(session.telegramId)
  let {data:report,error}=await supabaseAdmin.from('agent_artifacts')
    .select('title,subtitle,content_json,source_refs,updated_at').eq('id',id).eq('telegram_id',telegramId).maybeSingle()
  if(error)throw new Error('report_read_unavailable')
  // Made on WhatsApp: the person's linked WhatsApp row may own it (same whatsapp_id; see owner-ids).
  if(!report&&typeof linkedTelegramIds==='function'){
    const others=(await linkedTelegramIds(telegramId)).filter(v=>v!==telegramId)
    if(others.length){
      // Read by id, then authorise in code: the owner must be one of this person's linked ids (exact string match).
      const linked=await supabaseAdmin.from('agent_artifacts').select('telegram_id,title,subtitle,content_json,source_refs,updated_at').eq('id',id).maybeSingle()
      const owner=String((linked.data as any)?.telegram_id??'').trim()
      if(!linked.error&&linked.data&&others.includes(owner))report=linked.data as any
      else if(linked.data)console.error('REPORT_LINK_MISMATCH:',JSON.stringify({owner:owner.slice(-4),ownerLen:owner.length,others:others.map(v=>`${v.slice(-4)}/${v.length}`)}))
    }
  }
  if(!report){
    // Diagnose without revealing anything: does the row exist under another owner id?
    const {data:other}=await supabaseAdmin.from('agent_artifacts').select('telegram_id').eq('id',id).maybeSingle()
    console.error('REPORT_NOT_IN_ACCOUNT:',JSON.stringify({id,exists:!!other,ownerMatchesType:other?typeof other.telegram_id:null,sessionTg:String(telegramId).slice(-4),ownerTg:other?String(other.telegram_id).slice(-4):null,ownerShape:other?`${String(other.telegram_id).startsWith('-')?'neg':'pos'}${String(other.telegram_id).replace('-','').length}`:null}))
  }
  if(!report)notFound()
  // Make: a deck or a sheet has its own viewer and downloads.
  const made:any=(report.content_json as any)?.doc
  if(made&&(made.format==='deck'||made.format==='sheet')){
    const targets=await shareTargets(telegramId)
    const sources=(Array.isArray((report.content_json as any)?.sources)?(report.content_json as any).sources:[]).map(publicResearchUrl).filter(Boolean).slice(0,8)
    return <div className="mx-auto max-w-4xl px-0 pb-10">
      <Link href="/dashboard/make" className="inline-flex min-h-11 items-center text-[16px] text-[#2FB8A6]">← Make</Link>
      <ShareToWorkspace artifactId={id} workspaces={targets}/>
      <MakeDocViewer id={id} doc={made} request={String((report.content_json as any)?.request||'')} sources={sources} updatedAt={report.updated_at?String(report.updated_at):null}/>
    </div>
  }
  const runRef=agentRunRefOf(report.source_refs)
  let run:any=null
  if(runRef){
    const {data}=await supabaseAdmin.from('agent_runs').select('id,status,type,title,metadata_json').eq('id',runRef).eq('telegram_id',telegramId).maybeSingle()
    run=data
  }
  const check=refreshCheck(report,run)
  const targets=await shareTargets(telegramId)
  return <div className="mx-auto max-w-3xl px-0 pb-10">
    <Link href="/dashboard/make" className="inline-flex min-h-11 items-center text-[16px] text-[#2FB8A6]">← Make</Link>
    <ShareToWorkspace artifactId={id} workspaces={targets}/>
    <ReportEditor id={id} title={String(report.title||'Saved result')} notes={String((report.content_json as any)?.notes||'')}
      sections={artifactSections(report.content_json)} refresh={'reason' in check?{ok:false,reason:check.reason}:{ok:true,reason:''}}
      versions={versionSummaries(report.content_json)} sources={sourceList(report.content_json,report.source_refs)}/>
  </div>
}
