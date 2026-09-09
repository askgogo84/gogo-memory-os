import type { AgentApproval, AgentCommandResult, AgentGoal, AgentHomeSnapshot, AgentPermission, AgentWatcher } from './types'
import { getMobileAccessToken } from '../auth/session'

const API_BASE = process.env.EXPO_PUBLIC_ASKGOGO_API_BASE_URL || 'https://app.askgogo.in'

export class AgentApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getMobileAccessToken()
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })

  if (!response.ok) {
    let message = `AskGogo request failed (${response.status})`
    try {
      const body = await response.json()
      if (body?.error) message = String(body.error)
    } catch {}
    throw new AgentApiError(message, response.status)
  }

  return response.json() as Promise<T>
}

export const agentApi = {
  snapshot: () => request<AgentHomeSnapshot>('/api/agent/snapshot'),

  run: (text: string, context?: Record<string, unknown>) =>
    request<AgentCommandResult>('/api/agent/run', {
      method: 'POST',
      body: JSON.stringify({ text, context: context || {} }),
    }),

  executeRun: (runId: string) =>
    request<AgentCommandResult>(`/api/agent/runs/${encodeURIComponent(runId)}/execute`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  createGoal: async (input: Pick<AgentGoal, 'title' | 'outcome' | 'deadline'>) => {
    const result = await request<{ goal: AgentGoal }>('/api/agent/goals', { method: 'POST', body: JSON.stringify(input) })
    return result.goal
  },

  updateGoal: async (goalId: string, patch: Partial<Pick<AgentGoal, 'title' | 'outcome' | 'status' | 'deadline'>>) => {
    const result = await request<{ goal: AgentGoal }>(`/api/agent/goals/${encodeURIComponent(goalId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return result.goal
  },

  createDeadlineWatcher: async (input: { title:string; deadline:string; notifyBeforeHours?:number; delivery?:'app'|'whatsapp'|'both'; goalId?:string }) => {
    const result = await request<{ watcher: AgentWatcher }>('/api/agent/watchers', {
      method:'POST',
      body:JSON.stringify({ type:'deadline', ...input }),
    })
    return result.watcher
  },

  stopWatcher: async (watcherId:string) => {
    const result = await request<{ watcher: AgentWatcher }>(`/api/agent/watchers/${encodeURIComponent(watcherId)}`, { method:'DELETE' })
    return result.watcher
  },

  resolveApproval: async (approvalId: string, decision: 'approve' | 'reject') => {
    const result = await request<{ approval: AgentApproval }>(`/api/agent/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    })
    return result.approval
  },

  approveAndExecute: async (approval: AgentApproval) => {
    const resolved = await agentApi.resolveApproval(approval.id, 'approve')
    const result = await agentApi.executeRun(approval.runId)
    return { approval: resolved, result }
  },

  updatePermission: async (capability: AgentPermission['capability'], level: AgentPermission['level']) => {
    const result = await request<{ permission: AgentPermission }>('/api/agent/permissions', {
      method: 'PUT',
      body: JSON.stringify({ capability, level }),
    })
    return result.permission
  },
}
