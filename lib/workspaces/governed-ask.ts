// The workspace lane retains tenant checks before and after every read.
import { requireWorkspaceRole, WorkspaceError } from './access'
import { askWorkspace, type WorkspaceAnswer } from './ask'
import { openWorkspaceGovernedRuntime } from '@/lib/agent/governed-runtime'
import { skillQuery, workspaceSkillCatalog } from '@/lib/agent/governed-skill-catalog'
import { supabaseAdmin } from '@/lib/supabase-admin'
export async function governedWorkspaceAsk(owner:string,id:string,question:string):Promise<WorkspaceAnswer>{
  await requireWorkspaceRole(owner,id,'view')
  const authorize=async()=>{await requireWorkspaceRole(owner,id,'view');return true}
  const runtime=await openWorkspaceGovernedRuntime(owner,id,authorize)
  const unavailable=():WorkspaceAnswer=>({answer:'The governed workspace read is unavailable or has reached its limits. No business action was performed.',source:{label:'Governed workspace read · no result verified',checkedAt:new Date().toISOString(),firstRecordAt:null,lastRecordAt:null}})
  if(!runtime)return unavailable()
  const deadline=Date.now()+20_000
  const query=skillQuery(question)
  const readCatalog=async():Promise<WorkspaceAnswer>=>{
    await requireWorkspaceRole(owner,id,'view')
    const row=await supabaseAdmin.from('workspaces').select('id,pilot_read_only').eq('id',id).maybeSingle()
    if(row.error||row.data?.id!==id)throw new WorkspaceError('workspace_unavailable')
    const reviewed=await import('@/lib/agent/governed-review-store').then(m=>m.reviewedCatalogDefinitions(owner,{kind:'workspace',id}))
    return {answer:workspaceSkillCatalog(query||'',row.data.pilot_read_only===true,reviewed),source:{label:'Scoped skill catalog · reviewed descriptions',checkedAt:new Date().toISOString(),firstRecordAt:null,lastRecordAt:null}}
  }
  const r=await runtime.local(query!==null?'workspace_skill_catalog':'workspace_recorded_ask',query!==null?readCatalog:()=>askWorkspace(owner,id,question),()=>Date.now()<deadline)
  await requireWorkspaceRole(owner,id,'view')
  return r.state==='completed'?r.value:unavailable()
}
