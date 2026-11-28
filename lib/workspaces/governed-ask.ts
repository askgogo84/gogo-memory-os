// The workspace lane retains tenant checks before and after every read.
import { requireWorkspaceRole, WorkspaceError, getWorkspaceDetail } from './access'
import { askWorkspace, type WorkspaceAnswer } from './ask'
import { openWorkspaceGovernedRuntime } from '@/lib/agent/governed-runtime'
import { skillQuery, workspaceSkillCatalog } from '@/lib/agent/governed-skill-catalog'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {workspaceIncidentCommand,governedWorkspaceIncident} from './governed-incident'
export async function governedWorkspaceAsk(owner:string,id:string,question:string):Promise<WorkspaceAnswer>{
  await requireWorkspaceRole(owner,id,'view')
  const authorize=async()=>{await requireWorkspaceRole(owner,id,'view');return true}
  const runtime=await openWorkspaceGovernedRuntime(owner,id,authorize)
  const unavailable=():WorkspaceAnswer=>({answer:'The governed workspace read is unavailable or has reached its limits. No business action was performed.',source:{label:'Governed workspace read · no result verified',checkedAt:new Date().toISOString(),firstRecordAt:null,lastRecordAt:null}})
  if(!runtime)return unavailable()
  const deadline=Date.now()+20_000
  const query=skillQuery(question)
  const incident=workspaceIncidentCommand(question)
  const readCatalog=async():Promise<WorkspaceAnswer>=>{
    await requireWorkspaceRole(owner,id,'view')
    const row=await supabaseAdmin.from('workspaces').select('id,pilot_read_only').eq('id',id).maybeSingle()
    if(row.error||row.data?.id!==id)throw new WorkspaceError('workspace_unavailable')
    const reviewed=await import('@/lib/agent/governed-review-store').then(m=>m.reviewedCatalogDefinitions(owner,{kind:'workspace',id}))
    return {answer:workspaceSkillCatalog(query||'',row.data.pilot_read_only===true,reviewed),source:{label:'Scoped skill catalog · reviewed descriptions',checkedAt:new Date().toISOString(),firstRecordAt:null,lastRecordAt:null}}
  }
  const shared=/^(?:show|list)(?: explicitly)? shared (?:reports|artifacts)[.!?]?$/i.test(question.trim())
  const readShared=async():Promise<WorkspaceAnswer>=>{
    const detail=await getWorkspaceDetail(owner,id)
    if(detail.id!==id)throw new WorkspaceError('workspace_forbidden')
    const titles=detail.artifacts.slice(0,50).map(a=>String(a.title||'Untitled').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,140))
    return {answer:titles.length?['Reports explicitly shared in this workspace (titles only; contents not read):',...titles.map(t=>'• '+t),...(detail.artifacts.length>50?['More shared reports are available on the workspace page.']:[])].join('\n'):'No currently shared reports were found in this workspace.',source:{label:'Authorized workspace share records · titles only',checkedAt:new Date().toISOString(),firstRecordAt:null,lastRecordAt:null}}
  }
  const r=await runtime.local(incident?'workspace_incident_review':query!==null?'workspace_skill_catalog':shared?'workspace_shared_reports':'workspace_recorded_ask',incident?()=>governedWorkspaceIncident(owner,id,incident):query!==null?readCatalog:shared?readShared:()=>askWorkspace(owner,id,question),()=>Date.now()<deadline)
  await requireWorkspaceRole(owner,id,'view')
  return r.state==='completed'?r.value:unavailable()
}
