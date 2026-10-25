import { isIP } from 'node:net'
import type { AgentCapability, AgentRiskLevel } from './policy'

export type SentinelInput = {
  capability: AgentCapability
  mode: 'read'|'draft'|'execute'
  risk: AgentRiskLevel
  irreversible: boolean
  approved: boolean
  instruction?: string | null
  url?: string | null
  actionCount?: number | null
}

export type SentinelResult =
  | { allowed:true; reason:'sentinel_clear' }
  | { allowed:false; reason:'unsafe_network_target'|'secret_in_instruction'|'approval_missing'|'excessive_actions'|'unsupported_scheme'|'credential_request_blocked' }

const SECRET_PATTERNS = [
  /\b(?:password|passwd|passcode|otp|one[- ]?time password|cvv|cvc|card pin|upi pin)\b\s*[:=]\s*\S+/i,
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret[_ -]?key)\b\s*[:=]\s*\S+/i,
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{16,}\b/,
]

const CREDENTIAL_REQUEST = /\b(?:tell|show|reveal|read|extract|copy|send|share)\b[\s\S]{0,40}\b(?:password|otp|cvv|cvc|pin|secret|api key|access token|refresh token)\b/i

function unsafeHost(hostname:string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'')
  // Browser targets use public DNS names, matching the managed browser policy.
  // Reject literals as a class: URL normalizes mapped IPv6 and nonstandard IPv4.
  return !host || !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') ||
    host.endsWith('.local') || host.endsWith('.internal') || !!isIP(host)
}

/** Shared admission boundary; never grant network authority to URL userinfo or literals. */
export function browserTargetUrl(raw:string):URL {
  const url=new URL(raw)
  if(!['https:','http:'].includes(url.protocol))throw new Error('browser_url_not_http')
  if(url.username||url.password||unsafeHost(url.hostname))throw new Error('browser_private_host_blocked')
  return url
}

export function evaluateAgentSentinel(input:SentinelInput):SentinelResult {
  const instruction = String(input.instruction || '')
  if (SECRET_PATTERNS.some((r)=>r.test(instruction))) return { allowed:false, reason:'secret_in_instruction' }
  if (CREDENTIAL_REQUEST.test(instruction)) return { allowed:false, reason:'credential_request_blocked' }
  if ((input.actionCount || 0) > 30) return { allowed:false, reason:'excessive_actions' }

  if (input.url) {
    let url:URL
    try { url = new URL(input.url) } catch { return { allowed:false, reason:'unsupported_scheme' } }
    if (!['https:','http:'].includes(url.protocol)) return { allowed:false, reason:'unsupported_scheme' }
    if (url.username || url.password || unsafeHost(url.hostname)) return { allowed:false, reason:'unsafe_network_target' }
  }

  const consequential = input.irreversible || input.risk === 'high' || (
    input.mode === 'execute' && ['email','calendar','browser','travel','payments'].includes(input.capability)
  )
  if (consequential && !input.approved) return { allowed:false, reason:'approval_missing' }
  return { allowed:true, reason:'sentinel_clear' }
}
