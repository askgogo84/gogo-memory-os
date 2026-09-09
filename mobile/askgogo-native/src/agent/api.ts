import type { AgentApproval, AgentArtifactDetail, AgentCommandResult, AgentGoal, AgentHomeSnapshot, AgentPermission, AgentThread, AgentWatcher } from './types'
import { getMobileAccessToken } from '../auth/session'

const API_BASE = process.env.EXPO_PUBLIC_ASKGOGO_API_BASE_URL || 'https://app.askgogo.in'

export class AgentApiError extends Error { constructor(message:string,public status?:number){super(message)} }

async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const token=await getMobileAccessToken()
  const response=await fetch(`${API_BASE}${path}`,{...init,headers:{Accept:'application/json','Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(init.headers||{})}})
  if(!response.ok){let message=`AskGogo request failed (${response.status})`;try{const body=await response.json();if(body?.error)message=String(body.error)}catch{};throw new AgentApiError(message,response.status)}
  return response.json() as Promise<T>
}

export const agentApi={
  snapshot:()=>request<AgentHomeSnapshot>('/api/agent/snapshot'),
  artifact:async(id:string)=>(await request<{artifact:AgentArtifactDetail}>(`/api/agent/artifacts/${encodeURIComponent(id)}`)).artifact,
  threads:async()=>(await request<{threads:AgentThread[]}>('/api/agent/threads')).threads,
  createThread:async(title:string,context:Record<string,unknown>={})=>(await request<{thread:AgentThread}>('/api/agent/threads',{method:'POST',body:JSON.stringify({title,context})})).thread,
  updateThread:async(id:string,patch:Partial<Pick<AgentThread,'title'|'status'|'context'>>)=>(await request<{thread:AgentThread}>(`/api/agent/threads/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)})).thread,

  run:(text:string,context?:Record<string,unknown>)=>request<AgentCommandResult>('/api/agent/run',{method:'POST',body:JSON.stringify({text,context:context||{}})}),
  executeRun:(runId:string)=>request<AgentCommandResult>(`/api/agent/runs/${encodeURIComponent(runId)}/execute`,{method:'POST',body:JSON.stringify({})}),
  createGoal:async(input:Pick<AgentGoal,'title'|'outcome'|'deadline'>)=>(await request<{goal:AgentGoal}>('/api/agent/goals',{method:'POST',body:JSON.stringify(input)})).goal,
  updateGoal:async(goalId:string,patch:Partial<Pick<AgentGoal,'title'|'outcome'|'status'|'deadline'>>)=>(await request<{goal:AgentGoal}>(`/api/agent/goals/${encodeURIComponent(goalId)}`,{method:'PATCH',body:JSON.stringify(patch)})).goal,
  createDeadlineWatcher:async(input:{title:string;deadline:string;notifyBeforeHours?:number;delivery?:'app'|'whatsapp'|'both';goalId?:string})=>(await request<{watcher:AgentWatcher}>('/api/agent/watchers',{method:'POST',body:JSON.stringify({type:'deadline',...input})})).watcher,
  stopWatcher:async(id:string)=>(await request<{watcher:AgentWatcher}>(`/api/agent/watchers/${encodeURIComponent(id)}`,{method:'DELETE'})).watcher,
  resolveApproval:async(id:string,decision:'approve'|'reject')=>(await request<{approval:AgentApproval}>(`/api/agent/approvals/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({decision})})).approval,
  approveAndExecute:async(approval:AgentApproval)=>{const resolved=await agentApi.resolveApproval(approval.id,'approve');const result=await agentApi.executeRun(approval.runId);return{approval:resolved,result}},
  updatePermission:async(capability:AgentPermission['capability'],level:AgentPermission['level'])=>(await request<{permission:AgentPermission}>('/api/agent/permissions',{method:'PUT',body:JSON.stringify({capability,level})})).permission,
}
