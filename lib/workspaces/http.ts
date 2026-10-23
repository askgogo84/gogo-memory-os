// Maps workspace errors to HTTP answers for app/api/workspaces/**. Error codes only, never row data.
import { NextResponse } from 'next/server'
import { WorkspaceError } from './access'

const STATUS: Record<string, number> = {
  workspaces_not_enabled: 503,
  workspace_unavailable: 500,
  invalid_session: 400,
  invalid_name: 400,
  invalid_role: 400,
  invalid_number: 400,
  invalid_artifact: 400,
  workspace_forbidden: 403,
  workspace_not_found: 404,
  member_not_found: 404,
  user_not_found: 404,
  artifact_not_found: 404,
  already_member: 409,
  already_invited: 409,
  invite_not_found: 404,
  invite_expired: 410,
  invalid_decision: 400,
  ambiguous_number: 409,
  last_owner: 409,
  workspace_limit: 409,
  member_limit: 409,
}

export function workspaceErrorResponse(err: unknown, context: string): NextResponse {
  const code = err instanceof WorkspaceError ? err.code : 'workspace_unavailable'
  const status = STATUS[code] ?? 500
  if (status >= 500 && code !== 'workspaces_not_enabled') console.error('WORKSPACE_API_FAILED:', context, String(err instanceof Error ? err.message : err).slice(0, 200))
  return NextResponse.json({ error: code }, { status })
}
