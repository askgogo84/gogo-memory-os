// Exact text commands only. A quoted report, inferred intent or model-generated
// action is not authority. The RPC revalidates roles, scope and source in one transaction.
import {supabaseAdmin} from '@/lib/supabase-admin'
import {requireWorkspaceRole,WorkspaceError} from './access'
import type {WorkspaceAnswer} from './ask'
export type IncidentCommand={action:'stage'|'approve'|'list';ref:string|null}
export function workspaceIncidentCommand(text:string):IncidentCommand|null{
  const q=text.trim()
  if(/^list cancellation reviews[.!?]?$/i.test(q))return {action:'list',ref:null}
  const stage=/^stage cancellation review ([A-Za-z0-9_.:-]{1,100})$/.exec(q)
  if(stage)return {action:'stage',ref:stage[1]}
  const approve=/^approve cancellation review ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(q)
  return approve?{action:'approve',ref:approve[1]}:null
}
const source=()=>({label:'Workspace recorded incident review · no external provider action',checkedAt:new Date().toISOString(),firstRecordAt:null,lastRecordAt:null})
const bounded=(v:unknown)=>String(v??'').replace(/[\r\n\x00-\x1f\x7f]/g,' ').slice(0,160)
export function renderWorkspaceIncident(value:any):WorkspaceAnswer{
  const evidence=source(),state=value?.state
  const answer=(text:string)=>({answer:text,source:evidence})
  if(state==='listed'&&Array.isArray(value.items)){
    const lines=value.items.slice(0,50).map((i:any)=>bounded(i.orderId)+' · '+bounded(i.state)+' · '+bounded(i.reason)+' · review '+bounded(i.id))
    return answer(lines.length?['Workspace cancellation reviews (recorded tasks only):',...lines,...(value.items.length>50?['Showing the newest 50; this is a partial list.']:[])].join('\n'):'No eligible cancellation reviews were found.')
  }
  if(state==='proposed')return answer(['Cancellation review proposed — not yet an open task.',
    'Recorded order: '+bounded(value.orderId),'Outlet: '+bounded(value.outletId),'Recorded reason: '+bounded(value.reason),
    'Order record version observed at: '+bounded(value.observedAt),'Recorded cancellations for this outlet in the last 7 days at proposal time: '+bounded(value.recentCancellations),
    'A different current owner/admin must approve by '+bounded(value.expiresAt)+':',
    'approve cancellation review '+bounded(value.id),'No order, refund, stock or external provider was changed.'].join('\n'))
  if(state==='open')return answer('Internal workspace review task '+bounded(value.id)+' is open for order '+bounded(value.orderId)+'. No external provider was changed.')
  if(state==='stale'||state==='expired')return answer('The proposal is stale or expired. Stage a fresh review of the current record; no task was opened.')
  return answer('This review is unavailable or not authorized for your current role, workspace or recorded order. No external action was performed.')
}
export async function governedWorkspaceIncident(owner:string,id:string,command:IncidentCommand):Promise<WorkspaceAnswer>{
  const before=await requireWorkspaceRole(owner,id,'view')
  if(command.action==='stage'&&before.role==='viewer'||command.action==='approve'&&!['owner','admin'].includes(before.role))throw new WorkspaceError('workspace_forbidden')
  const result=await supabaseAdmin.rpc('gogo_workspace_incident_action',{p_scope_id:id,p_actor_id:owner,p_action:command.action,p_ref:command.ref})
  if(result.error)throw new WorkspaceError('workspace_unavailable')
  const after=await requireWorkspaceRole(owner,id,'view')
  if(command.action==='stage'&&after.role==='viewer'||command.action==='approve'&&!['owner','admin'].includes(after.role))throw new WorkspaceError('workspace_forbidden')
  return renderWorkspaceIncident(result.data)
}
