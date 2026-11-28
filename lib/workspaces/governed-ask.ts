// The workspace lane retains tenant checks before and after every read.
import { requireWorkspaceRole, WorkspaceError } from './access'
import { askWorkspace, type WorkspaceAnswer } from './ask'
import { openWorkspaceGovernedRuntime } from '@/lib/agent/governed-runtime'
export async function governedWorkspaceAsk(owner:string,id:string,question:string):Promise<WorkspaceAnswer>{
  await requireWorkspaceRole(owner,id,'view')
  const authorize=async()=>{await requireWorkspaceRole(owner,id,'view');return true}
  const runtime=await openWorkspaceGovernedRuntime(owner,id,authorize)
  const unavailable=():WorkspaceAnswer=>({answer:'The governed workspace read is unavailable or has reached its limits. No business action was performed.',source:{label:'Governed workspace read · no result verified',checkedAt:new Date().toISOString(),firstRecordAt:null,lastRecordAt:null}})
  if(!runtime)return unavailable()
  const deadline=Date.now()+20_000
  const r=await runtime.local('workspace_recorded_ask',()=>askWorkspace(owner,id,question),()=>Date.now()<deadline)
  await requireWorkspaceRole(owner,id,'view')
  return r.state==='completed'?r.value:unavailable()
}
