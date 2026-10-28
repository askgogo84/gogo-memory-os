export type AgentCapability =
  | 'memory'
  | 'files'
  | 'reminders'
  | 'lists'
  | 'tasks'
  | 'email'
  | 'calendar'
  | 'browser'
  | 'contacts'
  | 'travel'
  | 'payments'

export type AgentPermissionLevel = 'off' | 'read' | 'draft' | 'ask' | 'auto'
export type AgentActionMode = 'read' | 'draft' | 'execute'
export type AgentRiskLevel = 'low' | 'medium' | 'high'

export interface AgentExecutionPolicyInput {
  capability: AgentCapability
  permissionLevel: AgentPermissionLevel
  mode: AgentActionMode
  risk: AgentRiskLevel
  irreversible: boolean
  approvalStatus?: 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed' | null
}

export type AgentExecutionPolicyResult =
  | { allowed: true; reason: 'read_allowed' | 'draft_allowed' | 'safe_auto_execute' | 'approved_execute' }
  | { allowed: false; reason: 'permission_off' | 'permission_insufficient' | 'approval_required' | 'approval_not_valid' | 'auto_not_allowed_for_consequential_action' }

const CONSEQUENTIAL_CAPABILITIES = new Set<AgentCapability>(['email', 'calendar', 'browser', 'travel', 'payments'])

function rank(level: AgentPermissionLevel): number {
  switch (level) {
    case 'off': return 0
    case 'read': return 1
    case 'draft': return 2
    case 'ask': return 3
    case 'auto': return 4
  }
}

/**
 * Pure deterministic policy gate used before ANY agent executor is allowed to
 * perform work. The LLM never decides whether its own action is authorized.
 *
 * Safety invariant:
 * - read requires read+
 * - draft requires draft+
 * - every irreversible action requires a one-shot approved approval record
 * - email/calendar/browser/travel/payments cannot auto-execute high/medium-risk
 *   consequential actions merely because a client asks for `auto`
 * - reminders/lists/tasks can auto-execute only when explicitly allowed and the
 *   classifier marks the operation reversible/low risk
 */
export function evaluateAgentExecutionPolicy(input: AgentExecutionPolicyInput): AgentExecutionPolicyResult {
  if (input.permissionLevel === 'off') return { allowed: false, reason: 'permission_off' }

  if (input.mode === 'read') {
    return rank(input.permissionLevel) >= rank('read')
      ? { allowed: true, reason: 'read_allowed' }
      : { allowed: false, reason: 'permission_insufficient' }
  }

  if (input.mode === 'draft') {
    return rank(input.permissionLevel) >= rank('draft')
      ? { allowed: true, reason: 'draft_allowed' }
      : { allowed: false, reason: 'permission_insufficient' }
  }

  if (rank(input.permissionLevel) < rank('ask')) {
    return { allowed: false, reason: 'permission_insufficient' }
  }

  if (input.irreversible) {
    if (input.approvalStatus !== 'approved') {
      return {
        allowed: false,
        reason: input.approvalStatus && input.approvalStatus !== 'pending' ? 'approval_not_valid' : 'approval_required',
      }
    }
    return { allowed: true, reason: 'approved_execute' }
  }

  if (input.approvalStatus === 'approved') return { allowed: true, reason: 'approved_execute' }

  if (input.permissionLevel === 'auto') {
    if (CONSEQUENTIAL_CAPABILITIES.has(input.capability) && input.risk !== 'low') {
      return { allowed: false, reason: 'auto_not_allowed_for_consequential_action' }
    }
    return { allowed: true, reason: 'safe_auto_execute' }
  }

  return { allowed: false, reason: 'approval_required' }
}

// ---- Capability kill switches (100-user launch gate) -------------------------------------------------------------
//
// Environment switches that turn a whole risky capability off for everyone, instantly, without a code change.
// Set the variable to "off" in Vercel (Production) and redeploy/refresh; unset it (or any other value) to turn the
// capability back on. Every choke point that starts, approves or executes the capability asks capabilityPaused()
// first and replies honestly that nothing was done. See docs/launch/kill-switches.md.

export type PausableCapability = 'booking' | 'voice_calls' | 'logged_in_browser'

export const CAPABILITY_KILL_SWITCHES: Record<PausableCapability, string> = {
  booking: 'GOGO_BOOKING',
  voice_calls: 'GOGO_VOICE_CALLS',
  logged_in_browser: 'GOGO_LOGGED_IN_BROWSER',
}

type SwitchEnv = Record<string, string | undefined> | null | undefined

// Route harnesses run some modules in a bare vm with no `process` global, so the env is read defensively.
const runtimeEnv = (): SwitchEnv => (globalThis as any).process?.env

/** True when the capability's kill switch is set to off (also accepts 0 / false / paused / disabled). */
export function capabilityPaused(name: PausableCapability, env: SwitchEnv = runtimeEnv()): boolean {
  const value = String(env?.[CAPABILITY_KILL_SWITCHES[name]] ?? '').trim().toLowerCase()
  return value === 'off' || value === '0' || value === 'false' || value === 'paused' || value === 'disabled'
}

/** The honest reply when a paused capability was asked for. Always says nothing was done. */
export function capabilityPausedText(name: PausableCapability, options: { searchLink?: string | null } = {}): string {
  const link = String(options.searchLink || '').trim()
  if (name === 'booking') {
    return `Booking is paused right now, so I haven't started it and nothing was booked.${link ? ` Here is the search link to book yourself: ${link}` : ''}`
  }
  if (name === 'voice_calls') return "Phone calls are paused right now, so I haven't called anyone. Nothing was called or booked."
  return `Actions that use your signed-in accounts are paused right now, so I haven't opened your account or changed anything.${link ? ` You can do it yourself here: ${link}` : ''}`
}

export type BrowserActionShape = {
  mode?: string | null
  flow?: string | null
  approvalAction?: string | null
  vaultCredentialId?: string | null
  /** The target is a site with a saved login / account (a Vault provider domain). */
  accountSite?: boolean
  /** Part of a signed-in commerce session (commerce_parent_id without a public comparison). */
  commerceSession?: boolean
  /** A dashboard "sign in to a site" session. */
  siteSession?: boolean
}

/**
 * Which paused capability, if any, blocks this secure-browser action. Pure.
 * - booking: a provider booking (flow provider_booking, or a booking approval).
 * - logged_in_browser: anything that acts in the person's own signed-in browser: execute/draft actions (cart,
 *   form submits, bookings), account creation, a saved Vault credential, an account site, a signed-in commerce
 *   session or a site sign-in. Plain public reads (Google Flights search, public pages, comparisons) are untouched.
 */
export function pausedBrowserCapability(action: BrowserActionShape, env: SwitchEnv = runtimeEnv()): PausableCapability | null {
  const booking = action.flow === 'provider_booking' || action.approvalAction === 'booking'
  if (booking && capabilityPaused('booking', env)) return 'booking'
  const loggedIn = booking
    || (action.mode != null && action.mode !== 'read')
    || action.flow === 'account_creation'
    || Boolean(String(action.vaultCredentialId || '').trim())
    || action.accountSite === true
    || action.commerceSession === true
    || action.siteSession === true
  if (loggedIn && capabilityPaused('logged_in_browser', env)) return 'logged_in_browser'
  return null
}
