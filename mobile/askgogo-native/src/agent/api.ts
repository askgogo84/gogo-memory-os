import type { AgentApproval, AgentArtifactDetail, AgentCommandResult, AgentGoal, AgentHomeSnapshot, AgentPermission, AgentThread, AgentWatcher } from './types'
import { getMobileAccessToken } from '../auth/session'

const API_BASE = process.env.EXPO_PUBLIC_ASKGOGO_API_BASE_URL || 'https://app.askgogo.in'

export class AgentApiError extends Error { constructor(message:string,public status?:number){super(message)} }

async function readError(response:Response){let message=`AskGogo request failed (${response.status})`;try{const body=await response.json();if(body?.error)message=String(body.error)}catch{};return message}

async function request<T>(path:string,init:RequestInit={}):Promise<T>{
  const token=await getMobileAccessToken()
  const response=await fetch(`${API_BASE}${path}`,{...init,headers:{Accept:'application/json','Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(init.headers||{})}})
  if(!response.ok)throw new AgentApiError(await readError(response),response.status)
  return response.json() as Promise<T>
}

export type NativeCaptureInput={uri:string;name:string;type:string;caption?:string}
export type NativeCaptureResult=
  | {kind:'voice';transcript:string}
  | {kind:'document';documentId:string|null;title:string;summary:string;docType:string;expiresOn:string|null}

async function uploadCapture(input:NativeCaptureInput):Promise<NativeCaptureResult>{
  const token=await getMobileAccessToken();if(!token)throw new AgentApiError('mobile_session_required',401)
  const form=new FormData()
  form.append('file',{uri:input.uri,name:input.name||'capture.bin',type:input.type||'application/octet-stream'} as any)
  if(input.caption)form.append('caption',input.caption)
  const response=await fetch(`${API_BASE}/api/agent/capture`,{method:'POST',headers:{Accept:'application/json',Authorization:`Bearer ${token}`},body:form})
  if(!response.ok)throw new AgentApiError(await readError(response),response.status)
  const body=await response.json() as {result:NativeCaptureResult}
  return body.result
}

export const agentApi={
  snapshot:()=>request<AgentHomeSnapshot>('/api/agent/snapshot'),
  artifact:async(id:string)=>(await request<{artifact:AgentArtifactDetail}>(`/api/agent/artifacts/${encodeURIComponent(id)}`)).artifact,
  threads:async()=>(await request<{threads:AgentThread[]}>('/api/agent/threads')).threads,
  createThread:async(title:string,context:Record<string,unknown>={})=>(await request<{thread:AgentThread}>('/api/agent/threads',{method:'POST',body:JSON.stringify({title,context})})).thread,
  updateThread:async(id:string,patch:Partial<Pick<AgentThread,'title'|'status'|'context'>>)=>(await request<{thread:AgentThread}>(`/api/agent/threads/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)})).thread,

  run:(text:string,context?:Record<string,unknown>)=>request<AgentCommandResult>('/api/agent/run',{method:'POST',body:JSON.stringify({text,context:context||{}})}),
  executeRun:(runId:string)=>request<AgentCommandResult>(`/api/agent/runs/${encodeURIComponent(runId)}/execute`,{method:'POST',body:JSON.stringify({})}),
  capture:(input:NativeCaptureInput)=>uploadCapture(input),
  registerDevice:(input:{installationId:string;expoPushToken?:string|null;nativePushToken?:string|null;permissionStatus:string})=>request<{ok:true;device:{id:string;platform:string;permissionStatus:string;enabled:boolean;lastSeenAt:string}}>('/api/agent/devices',{method:'POST',body:JSON.stringify(input)}),
  disableDevice:(installationId:string)=>request<{ok:true}>('/api/agent/devices',{method:'DELETE',body:JSON.stringify({installationId})}),
  createGoal:async(input:Pick<AgentGoal,'title'|'outcome'|'deadline'>)=>(await request<{goal:AgentGoal}>('/api/agent/goals',{method:'POST',body:JSON.stringify(input)})).goal,
  updateGoal:async(goalId:string,patch:Partial<Pick<AgentGoal,'title'|'outcome'|'status'|'deadline'>>)=>(await request<{goal:AgentGoal}>(`/api/agent/goals/${encodeURIComponent(goalId)}`,{method:'PATCH',body:JSON.stringify(patch)})).goal,
  createDeadlineWatcher:async(input:{title:string;deadline:string;notifyBeforeHours?:number;delivery?:'app'|'whatsapp'|'both';goalId?:string})=>(await request<{watcher:AgentWatcher}>('/api/agent/watchers',{method:'POST',body:JSON.stringify({type:'deadline',...input})})).watcher,
  stopWatcher:async(id:string)=>(await request<{watcher:AgentWatcher}>(`/api/agent/watchers/${encodeURIComponent(id)}`,{method:'DELETE'})).watcher,
  resolveApproval:async(id:string,decision:'approve'|'reject')=>(await request<{approval:AgentApproval}>(`/api/agent/approvals/${encodeURIComponent(id)}`,{method:'POST',body:JSON.stringify({decision})})).approval,
  approveAndExecute:async(approval:AgentApproval)=>{const resolved=await agentApi.resolveApproval(approval.id,'approve');const result=await agentApi.executeRun(approval.runId);return{approval:resolved,result}},
  updatePermission:async(capability:AgentPermission['capability'],level:AgentPermission['level'])=>(await request<{permission:AgentPermission}>('/api/agent/permissions',{method:'PUT',body:JSON.stringify({capability,level})})).permission,
}
