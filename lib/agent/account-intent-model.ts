// Model-read account intent. The regex rules in external-account-intent.ts are a fast path, but
// people phrase the same request many ways ("create the account", "get me on manus", "join
// huggingface for me"), so a message that MAY be an account request and that the rules missed is
// read by the model once. The model only extracts; it never authorises anything: the result goes
// through the same flow, which asks for missing details and requires an explicit APPROVE.
//
// Guard rails: values must appear verbatim in the message (an invented email or link is dropped),
// and how-to questions, bank/financial accounts and deferred intentions stay excluded.
import { completeAgentPlanPrompt } from './planner-provider'
import { externalAccountIntentExcluded, extractAccountEmail, extractAccountUrl, mayBeAccountRequest, parseAccountProfile, type ExternalAccountRequest } from './external-account-intent'

export { mayBeAccountRequest }

type Complete = (prompt: string, onUsage?: undefined, system?: string) => Promise<string>

const SYSTEM = [
  'You read one chat message sent to a personal assistant and return JSON only, no prose.',
  'Schema: {"intent":"create_account"|"other","service":string|null,"url":string|null,"email":string|null,"username":string|null,"fullName":string|null}.',
  'intent is create_account ONLY when the person asks the assistant to create, open, register or sign up a NEW account for them on a website or app now.',
  'Use other for: questions about how to do it, whether an account is needed, bank/financial/demat accounts, events/classes/webinars, saving or sharing a link, logging in to an existing account, or anything else.',
  'Copy service, url, email, username and fullName exactly as written in the message. Use null when a value is not in the message. Never invent or complete a value.',
].join(' ')

function lowerIncludes(haystack: string, needle: string) {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

function parseJson(text: string): any {
  const clean = String(text || '').replace(/```json|```/g, '').trim()
  try { return JSON.parse(clean) } catch {}
  const m = clean.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export async function readAccountRequestWithModel(text: string, complete: Complete = completeAgentPlanPrompt as Complete, timeoutMs = 6000): Promise<ExternalAccountRequest | null> {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!mayBeAccountRequest(raw) || externalAccountIntentExcluded(raw)) return null
  // No model configured (for example in tests): the rules alone decide.
  if (complete === (completeAgentPlanPrompt as Complete) && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) return null
  let out = ''
  try {
    out = await Promise.race([
      complete(`MESSAGE: ${JSON.stringify(raw.slice(0, 600))}`, undefined, SYSTEM),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('account_intent_timeout')), timeoutMs)),
    ])
  } catch (error: any) {
    console.error('ACCOUNT_INTENT_MODEL_FAILED:', String(error?.message || error).slice(0, 120))
    return null
  }
  const parsed = parseJson(out)
  if (!parsed || parsed.intent !== 'create_account') return null

  // Only values literally present in the message survive.
  const email = extractAccountEmail(raw)
  const url = extractAccountUrl(raw)
  const modelEmail = typeof parsed.email === 'string' && lowerIncludes(raw, parsed.email) ? parsed.email : null
  const modelUrl = typeof parsed.url === 'string' && raw.includes(parsed.url) ? parsed.url : null
  let service = typeof parsed.service === 'string' && parsed.service.trim() && lowerIncludes(raw, parsed.service.trim()) ? parsed.service.trim().slice(0, 80) : ''
  const finalUrl = url || (modelUrl ? extractAccountUrl(modelUrl) : null)
  if (!service && finalUrl) { try { service = new URL(finalUrl).hostname.replace(/^www\./, '') } catch {} }
  if (!service) return null
  const profile = parseAccountProfile(raw)
  const username = profile?.username || (typeof parsed.username === 'string' && lowerIncludes(raw, parsed.username) ? parsed.username : null)
  const fullName = profile?.fullName || (typeof parsed.fullName === 'string' && lowerIncludes(raw, parsed.fullName) ? parsed.fullName : null)
  console.log('ACCOUNT_INTENT_MODEL:', JSON.stringify({ service, hasUrl: Boolean(finalUrl), hasEmail: Boolean(email || modelEmail) }))
  return { service, email: email || modelEmail, url: finalUrl, username, fullName }
}
