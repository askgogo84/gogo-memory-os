// PROPOSAL ONLY (research/connectors-skills, 23 Oct 2026). Nothing imports this file yet; it is not wired into the
// agent, the dashboard or any route. See docs/research/connectors-skills.md for the design and the rollout plan.
//
// One provider-neutral seam for every third-party connection AskGogo may use: the native Google OAuth already in
// production, an aggregator (Composio primary, Nango fallback), or a provider's own MCP server (Swiggy, Razorpay).
//
// Three rules this file exists to enforce, and scripts/verify-connector-adapter-policy.mts proves:
//   1. Every action that is not a classified read goes through AskGogo's existing approval binding
//      (lib/agent/approval-binding.ts) before the adapter is called, and every execution leaves a receipt.
//      An action whose risk is unknown is treated as a write (fail closed).
//   2. Credentials never reach the model. The planner sees ModelToolDescriptor and ModelToolResult only. Tokens live
//      behind CredentialHandle, which serialises to a placeholder, and every provider payload is passed through
//      toModelVisible() before it can enter a prompt.
//   3. A connection belongs to exactly one scope: one person (personal) or one SecondBrain workspace. Personal
//      connections are never usable from a workspace request, and a workspace toolkit needs admin approval.
import { createHash } from 'node:crypto'
import { assertApprovalBinding, buildApprovalBinding } from '../agent/approval-binding'

// ---------------------------------------------------------------------------------------------------------------
// Scope and identity
// ---------------------------------------------------------------------------------------------------------------

/** Who a connection belongs to. ownerId is AskGogo's internal user key (today users.telegram_id, negative for WhatsApp). */
export type ConnectorScope =
  | { kind: 'personal'; ownerId: string }
  | { kind: 'workspace'; workspaceId: string; actorId: string; actorRole: WorkspaceRoleLite }

export type WorkspaceRoleLite = 'owner' | 'admin' | 'member' | 'viewer'

/** Which backend serves a toolkit. Swapping Composio for Nango changes this value, not the agent. */
export type ConnectorBackend = 'native_google' | 'composio' | 'nango' | 'direct_mcp'

export type ActionRisk = 'read' | 'write' | 'irreversible'

/** Kinds of personal data an action can return, used to keep personal data out of workspaces by default. */
export type DataClass = 'mail' | 'calendar' | 'files' | 'contacts' | 'messages' | 'finance' | 'crm' | 'tasks' | 'public'

export type ToolkitSummary = {
  toolkit: string // stable AskGogo id, e.g. 'notion', 'zoho_books'
  name: string
  backend: ConnectorBackend
  authKind: 'oauth2' | 'api_key' | 'none'
  /** True when AskGogo's own OAuth app is used, so the consent screen says AskGogo, not the aggregator. */
  ownOAuthApp: boolean
}

export type ConnectorActionSpec = {
  id: string // '<toolkit>.<action>', e.g. 'notion.create_page'
  toolkit: string
  name: string
  description: string
  /** Absent or unrecognised means write. Only an explicit, reviewed 'read' skips approval. */
  risk?: ActionRisk
  dataClasses: DataClass[]
  /** JSON-schema-like description of the arguments the model may fill in. Never contains credentials. */
  inputSchema: Record<string, unknown>
}

/** What AskGogo stores about a connection. Opaque ids only: no token, no provider secret, no raw account id. */
export type ConnectionRef = {
  connectionId: string // AskGogo-issued id; the aggregator's connected-account id stays server-side
  toolkit: string
  backend: ConnectorBackend
  scope: ConnectorScope
  status: 'active' | 'needs_reauth' | 'revoked'
  accountHint: string // e.g. 'g…@gmail.com', shown in the UI
  grantedScopes: string[]
  createdBy: string
  createdAt: string
}

// ---------------------------------------------------------------------------------------------------------------
// Credentials: held server-side, opaque to everything above the adapter
// ---------------------------------------------------------------------------------------------------------------

const SECRET = Symbol('connector.secret')

/**
 * The only way a token travels inside AskGogo. JSON.stringify, String() and util.inspect all print a placeholder,
 * so a handle accidentally placed in a prompt, a log line or an approval snapshot leaks nothing.
 * Only an adapter's execute() calls reveal(), immediately before the provider request.
 */
export class CredentialHandle {
  private readonly [SECRET]: string
  constructor(public readonly connectionId: string, secret: string) {
    this[SECRET] = secret
    Object.defineProperty(this, SECRET, { enumerable: false })
  }
  reveal(): string { return this[SECRET] }
  toJSON() { return '[credential]' }
  toString() { return '[credential]' }
  [Symbol.for('nodejs.util.inspect.custom')]() { return '[credential]' }
}

/** Resolves a handle from AskGogo's encrypted store (vault_credentials / users.gmail_* today). Server-only. */
export interface CredentialResolver {
  resolve(connection: ConnectionRef): Promise<CredentialHandle>
}

// ---------------------------------------------------------------------------------------------------------------
// The adapter every backend implements
// ---------------------------------------------------------------------------------------------------------------

export type ConnectStart = { flowId: string; redirectUrl: string; expiresAt: string }

export type ProviderCall = {
  connection: ConnectionRef
  action: ConnectorActionSpec
  args: Record<string, unknown>
  credential: CredentialHandle // aggregators that hold the token themselves receive a handle wrapping their account id
  idempotencyKey: string
}

export type ProviderResult = {
  ok: boolean
  providerReceiptId?: string | null
  data?: unknown
  error?: string | null
  /** True when the provider may have acted even though we did not get a clean answer (timeouts after send). */
  outcomeUnknown?: boolean
}

export interface ConnectorAdapter {
  readonly backend: ConnectorBackend
  listToolkits(): Promise<ToolkitSummary[]>
  listActions(toolkit: string): Promise<ConnectorActionSpec[]>
  /** Begin OAuth / API-key capture. The redirect goes to AskGogo's callback, never straight back to the model. */
  beginConnect(scope: ConnectorScope, toolkit: string): Promise<ConnectStart>
  completeConnect(flowId: string, callback: Record<string, string>): Promise<ConnectionRef>
  /** Revokes at the provider where supported, then deletes stored credentials. */
  disconnect(connection: ConnectionRef): Promise<void>
  /** Called only by executeConnectorAction() below, after policy checks. */
  execute(call: ProviderCall): Promise<ProviderResult>
}

// ---------------------------------------------------------------------------------------------------------------
// Model-visible shapes and redaction
// ---------------------------------------------------------------------------------------------------------------

/** What the planner sees for a tool. Built from the spec; no connection ids, no account ids, no credentials. */
export type ModelToolDescriptor = {
  name: string
  description: string
  needsApproval: boolean
  inputSchema: Record<string, unknown>
}

export type ModelToolResult = {
  status: ExecutionReceipt['status']
  summary: unknown
  approvalRequired?: boolean
}

export function effectiveRisk(action: Pick<ConnectorActionSpec, 'risk'>): ActionRisk {
  return action.risk === 'read' || action.risk === 'write' || action.risk === 'irreversible' ? action.risk : 'write'
}

export function toModelToolDescriptor(action: ConnectorActionSpec): ModelToolDescriptor {
  return toModelVisible({
    name: action.id,
    description: action.description,
    needsApproval: effectiveRisk(action) !== 'read',
    inputSchema: action.inputSchema,
  }) as ModelToolDescriptor
}

const SECRET_KEY_RE = /(?:^|_|-)(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|api[_-]?key|apikey|password|passwd|authorization|auth[_-]?header|cookie|set[_-]?cookie|session[_-]?id|private[_-]?key|code[_-]?verifier|bearer)(?:$|_|-)/i
const SECRET_VALUE_RES: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, // Authorization header values
  /\bya29\.[A-Za-z0-9._-]{10,}/g, // Google access tokens
  /\b1\/\/[A-Za-z0-9._-]{10,}/g, // Google refresh tokens
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWTs
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, // Stripe/Razorpay-style keys
  /\b(?:xox[abpr]|ghp|gho|github_pat|glpat)[-_][A-Za-z0-9_-]{8,}/g, // Slack / GitHub / GitLab tokens
  /\benc:v1:[A-Za-z0-9+/=:_-]{8,}/g, // AskGogo ciphertext should never surface either
]

function redactString(value: string): string {
  let out = value
  for (const re of SECRET_VALUE_RES) out = out.replace(re, '[redacted]')
  return out
}

/**
 * Deep copy that drops secret-named keys, replaces secret-shaped strings and CredentialHandles, and caps size.
 * Every provider payload passes through this before it can enter a prompt, a chat reply, a receipt summary or a log.
 */
export function toModelVisible(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[truncated]'
  if (value instanceof CredentialHandle) return '[credential]'
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') return redactString(value).slice(0, 8000)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 200).map(v => toModelVisible(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue
      out[k] = toModelVisible(v, depth + 1)
    }
    return out
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Scope policy (individual vs SecondBrain workspace)
// ---------------------------------------------------------------------------------------------------------------

export type WorkspaceConnectorPolicy = {
  workspaceId: string
  /** Toolkits a workspace admin has approved for this workspace. Empty means none. */
  approvedToolkits: string[]
  /** Data classes the workspace may receive. Personal-only classes stay out unless an admin adds them. */
  allowedDataClasses: DataClass[]
  /** Whether members (not only admins) may request write actions. Viewers never can. */
  membersMayWrite: boolean
}

export function scopeKey(scope: ConnectorScope): string {
  return scope.kind === 'personal' ? `personal:${scope.ownerId}` : `workspace:${scope.workspaceId}`
}

export function scopeProblem(input: {
  scope: ConnectorScope
  connection: ConnectionRef
  action: ConnectorActionSpec
  workspacePolicy?: WorkspaceConnectorPolicy | null
}): string | null {
  const { scope, connection, action, workspacePolicy } = input
  if (connection.status !== 'active') return 'connector_connection_inactive'
  if (connection.toolkit !== action.toolkit) return 'connector_toolkit_mismatch'
  if (scopeKey(connection.scope) !== scopeKey(scope)) {
    // The usual case this catches: a workspace request reaching for someone's personal Gmail.
    return 'connector_scope_mismatch'
  }
  if (scope.kind === 'personal') return null
  if (!workspacePolicy || workspacePolicy.workspaceId !== scope.workspaceId) return 'connector_workspace_policy_missing'
  if (!workspacePolicy.approvedToolkits.includes(action.toolkit)) return 'connector_toolkit_not_admin_approved'
  if (action.dataClasses.some(c => !workspacePolicy.allowedDataClasses.includes(c))) return 'connector_data_class_not_allowed'
  if (effectiveRisk(action) !== 'read') {
    if (scope.actorRole === 'viewer') return 'connector_role_forbidden'
    if (scope.actorRole === 'member' && !workspacePolicy.membersMayWrite) return 'connector_role_forbidden'
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Approval and execution
// ---------------------------------------------------------------------------------------------------------------

/** The subset of an agent_approvals row this layer needs. */
export type ApprovalRecord = {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed'
  action_hash: string | null
  policy_version: string | null
  expires_at?: string | null
  scope_key?: string | null
}

export type ExecutionReceipt = {
  runId: string
  stepId: string
  approvalId: string | null
  backend: ConnectorBackend
  toolkit: string
  action: string
  connectionId: string
  scopeKey: string
  argsHash: string
  status: 'succeeded' | 'failed' | 'outcome_unknown' | 'refused'
  providerReceiptId: string | null
  summary: unknown // already model-visible (redacted)
  startedAt: string
  finishedAt: string
}

export class ConnectorPolicyError extends Error {
  constructor(public code: string) { super(code) }
}

function stableArgsHash(args: unknown) {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
      : v
  return createHash('sha256').update(JSON.stringify(canon(args ?? null))).digest('hex')
}

/** The exact fingerprint input staged with the approval card and re-checked before execution. */
export function connectorApprovalInput(p: { runId: string; stepId: string; connection: ConnectionRef; action: ConnectorActionSpec; args: Record<string, unknown> }) {
  return {
    missionId: p.runId,
    stepId: p.stepId,
    capability: `connector:${p.action.toolkit}`,
    actionType: p.action.id,
    target: `${scopeKey(p.connection.scope)}|${p.connection.connectionId}`,
    payload: p.args,
  }
}

/** Builds the binding columns for a new agent_approvals row (action_hash, policy_version, action_snapshot_json). */
export function stageConnectorApproval(p: Parameters<typeof connectorApprovalInput>[0]) {
  if (effectiveRisk(p.action) === 'read') throw new ConnectorPolicyError('connector_read_needs_no_approval')
  return buildApprovalBinding(connectorApprovalInput(p))
}

/**
 * The single execution path. Order: scope policy, approval (for anything not a classified read), credential
 * resolution, provider call, receipt. The adapter is never called if any check fails.
 */
export async function executeConnectorAction(p: {
  adapter: ConnectorAdapter
  resolver: CredentialResolver
  scope: ConnectorScope
  connection: ConnectionRef
  action: ConnectorActionSpec
  args: Record<string, unknown>
  runId: string
  stepId: string
  approval?: ApprovalRecord | null
  workspacePolicy?: WorkspaceConnectorPolicy | null
  now?: Date
}): Promise<ExecutionReceipt> {
  const now = p.now || new Date()
  const startedAt = now.toISOString()
  if (p.adapter.backend !== p.connection.backend) throw new ConnectorPolicyError('connector_backend_mismatch')
  const problem = scopeProblem({ scope: p.scope, connection: p.connection, action: p.action, workspacePolicy: p.workspacePolicy })
  if (problem) throw new ConnectorPolicyError(problem)

  const risk = effectiveRisk(p.action)
  let approvalId: string | null = null
  if (risk !== 'read') {
    const a = p.approval
    if (!a) throw new ConnectorPolicyError('connector_approval_required')
    if (a.status !== 'approved') throw new ConnectorPolicyError(`connector_approval_${a.status}`)
    if (a.expires_at && Date.parse(a.expires_at) <= now.getTime()) throw new ConnectorPolicyError('connector_approval_expired')
    if (a.scope_key && a.scope_key !== scopeKey(p.scope)) throw new ConnectorPolicyError('connector_approval_scope_mismatch')
    assertApprovalBinding(connectorApprovalInput(p), a) // throws approval_binding_missing / approval_action_changed
    approvalId = a.id
  }

  const credential = await p.resolver.resolve(p.connection)
  const idempotencyKey = `${p.runId}:${p.stepId}:${stableArgsHash(p.args)}`
  let result: ProviderResult
  try {
    result = await p.adapter.execute({ connection: p.connection, action: p.action, args: p.args, credential, idempotencyKey })
  } catch {
    // A thrown provider call after a write began is an unknown outcome, never a silent failure.
    result = { ok: false, error: 'provider_exception', outcomeUnknown: risk !== 'read' }
  }
  return {
    runId: p.runId,
    stepId: p.stepId,
    approvalId,
    backend: p.adapter.backend,
    toolkit: p.action.toolkit,
    action: p.action.id,
    connectionId: p.connection.connectionId,
    scopeKey: scopeKey(p.scope),
    argsHash: stableArgsHash(p.args),
    status: result.ok ? 'succeeded' : result.outcomeUnknown ? 'outcome_unknown' : 'failed',
    providerReceiptId: result.providerReceiptId ?? null,
    summary: toModelVisible(result.ok ? result.data : { error: result.error ?? 'failed' }),
    startedAt,
    finishedAt: new Date().toISOString(),
  }
}

/** What goes back to the planner after a call. Built from the receipt, so it is redacted by construction. */
export function toModelToolResult(receipt: ExecutionReceipt): ModelToolResult {
  return toModelVisible({ status: receipt.status, summary: receipt.summary }) as ModelToolResult
}
