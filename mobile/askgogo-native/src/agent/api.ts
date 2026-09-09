import type { AgentApproval, AgentGoal, AgentHomeSnapshot, AgentPermission } from './types'

const API_BASE = process.env.EXPO_PUBLIC_ASKGOGO_API_BASE_URL || 'https://app.askgogo.in'

export class AgentApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
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

/**
 * These endpoints are the mobile contract for Sprint B.
 * Until the authenticated backend routes land, screens use explicit preview data
 * and MUST label it as preview rather than pretending it is live user state.
 */
export const agentApi = {
  snapshot: () => request<AgentHomeSnapshot>('/api/agent/snapshot'),

  createGoal: (input: Pick<AgentGoal, 'title' | 'outcome' | 'deadline'>) =>
    request<AgentGoal>('/api/agent/goals', { method: 'POST', body: JSON.stringify(input) }),

  updateGoal: (goalId: string, patch: Partial<Pick<AgentGoal, 'title' | 'outcome' | 'status' | 'deadline'>>) =>
    request<AgentGoal>(`/api/agent/goals/${encodeURIComponent(goalId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  resolveApproval: (approvalId: string, decision: 'approve' | 'reject') =>
    request<AgentApproval>(`/api/agent/approvals/${encodeURIComponent(approvalId)}`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),

  updatePermission: (capability: AgentPermission['capability'], level: AgentPermission['level']) =>
    request<AgentPermission>('/api/agent/permissions', {
      method: 'PUT',
      body: JSON.stringify({ capability, level }),
    }),
}
