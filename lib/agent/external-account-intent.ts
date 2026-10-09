// Pure intent detection for Core v1 external-account creation. No I/O and no imports,
// so the deterministic objective flow (external-account.ts) and the shared request
// classifier (classifier.ts) apply exactly the same rules without a circular import.
// If these two drift apart, a message the objective flow declines can still be
// classified as a high-risk form submission by the generic browser path.

export type ExternalAccountRequest={
  service:string
  email:string|null
  url:string|null
}

const LOOSE_CREATE=/\b(?:create|open|make)\s+(?:me\s+)?(?:an?\s+)?(?:new\s+)?account\b/i
const LOOSE_SIGNUP=/\b(?:sign\s*up|register)\b/i
// "Sign me up on Substack" names a destination; "sign me up for the newsletter" does not, so only on/at/with count.
const SIGN_ME_UP_ON=/\bsign\s*me\s*up\s+(?:on|at|with)\s+\S/i

// Asking HOW to do something is a request for instructions, not an objective to execute.
const HOW_TO=/\bhow\s+(?:do|can|should|would|could)\s+(?:i|we|you|one)\b|\bhow\s+to\s+(?:create|make|open|register|sign\s*up|set\s*up|get)\b|\b(?:tell|show|explain\s+to)\s+me\s+how\b|\bwhat(?:'s|\s+is|\s+are)\s+the\s+(?:steps|process)\b|\bsteps\s+to\s+(?:create|make|open|register|sign\s*up)\b/i
// "Do I need to create an account?" asks about a requirement; it does not request one.
const NEED_TO=/\b(?:do|does|will|would|should)\s+(?:i|we|you|they|one)\s+(?:need|have|require)\s+to\s+(?:create|make|open|register|sign\s*up)\b|\bis\s+an?\s+account\s+(?:needed|required|necessary|mandatory)\b/i
// Regulated financial accounts need KYC and in-person/identity steps. They are never an
// autonomous browser signup, whatever the phrasing.
const FINANCE=/\b(?:bank|banking|savings|salary\s+account|current\s+account|demat|trading\s+account|brokerage|nps|ppf|fixed\s+deposit|recurring\s+deposit|loan\s+account|mutual\s+fund\s+account|kyc)\b/i
// Events, classes and memberships are registrations, not online accounts.
const ACTIVITY=/\b(?:class|classes|course|courses|workshop|webinar|event|events|marathon|race|session|seminar|conference|meetup|exam|tournament|camp|bootcamp|programme|newsletter|mailing\s*list|appointment|slot|registration|admission|membership|gym|yoga|zumba|lesson|lessons|tuition|coaching|waitlist)\b/i
// A future or someday intention ("I need to create an account later") is not a request to act now.
const DEFERRED=/\b(?:later|tomorrow|someday|eventually|sometime|one\s+day|next\s+(?:week|month|year)|when\s+(?:i|we)\s+(?:get|have)\s+(?:time|a\s+chance))\b/i
const PRONOUN_ONLY=/^(?:it|this|that|them|those|these|me|us|him|her|one)$/i

// A service ends at a purpose clause, a conjunction, or sentence punctuation. A dot ends
// the service only when it closes a sentence, so "huggingface.co" and URLs stay whole.
const TERM='(?=\\s+(?:using|with\\s+(?:my|the|this|email)|and|then|please|so|because|for\\s+(?:me|my|our|the|a|an))\\b|[!?;,]|\\.(?=\\s|$)|$)'

/** True when the text explicitly asks for an external account and is not excluded. */
export function externalAccountIntentExcluded(text:string){
  const raw=String(text||'')
  return HOW_TO.test(raw)||NEED_TO.test(raw)||FINANCE.test(raw)||DEFERRED.test(raw)
}

/**
 * Loose "create an account" phrasing minus the exclusions. Used by the shared classifier,
 * which must not label a how-to question, a bank account or an event signup as a
 * high-risk external-account form submission. When the text names targets and every one
 * is an event or a bare pronoun ("register me for the webinar and create an account for
 * it"), it is not an external account either. A vague request with no named target still
 * counts, so it stays behind the high-risk approval path.
 */
export function mentionsExternalAccountCreation(text:string){
  const raw=String(text||'').replace(/\s+/g,' ').trim()
  const phrased=LOOSE_CREATE.test(raw)||(LOOSE_SIGNUP.test(raw)&&/\baccount\b/i.test(raw))||SIGN_ME_UP_ON.test(raw)
  if(!phrased||externalAccountIntentExcluded(raw))return false
  const {named,service}=accountTarget(raw,extractAccountUrl(raw))
  return !named||Boolean(service)
}

function cleanService(value:string){
  return String(value||'')
    .replace(/\b(?:website|site|app)\b/gi,' ')
    .replace(/\s+/g,' ')
    .trim()
    .replace(/[.,!?;:]+$/,'')
    .slice(0,80)
}

export function extractAccountEmail(text:string){
  const match=String(text||'').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?match[0]:null
}

export function extractAccountUrl(text:string){
  const match=String(text||'').match(/https?:\/\/[^\s<>)\]}]+/i)
  if(!match)return null
  try{
    const url=new URL(match[0].replace(/[.,!?;:]+$/,''))
    if(url.protocol!=='https:'||url.username||url.password)return null
    return url.toString()
  }catch{return null}
}

// A captured target is a usable service, a beneficiary ("me", "my mom": who the account
// is for, not where), or an excluded destination (an event or class). Beneficiaries do
// not name a destination, so "create an account for me" is still a vague request.
function classifyTarget(value:string,explicitUrl:string|null):{kind:'service'|'beneficiary'|'excluded';service:string}{
  let service=cleanService(value)
  // A captured URL is not a service name. Use its host so replies read "huggingface.co",
  // never a fragment such as "https://huggingface".
  if(/:\/\//.test(service)){
    if(!explicitUrl)return {kind:'excluded',service:''}
    try{service=new URL(explicitUrl).hostname.replace(/^www\./,'')}catch{return {kind:'excluded',service:''}}
  }
  if(!service||PRONOUN_ONLY.test(service))return {kind:'beneficiary',service:''}
  if(/^(?:my|our|his|her|their|your)\b/i.test(service))return {kind:'beneficiary',service:''}
  if(ACTIVITY.test(service))return {kind:'excluded',service:''}
  return {kind:'service',service}
}

// Every clause that names a target, in preference order. "Sign up for the newsletter and
// create an account on Substack" names Substack as the service, not the newsletter.
function accountTarget(raw:string,explicitUrl:string|null){
  const byLogin=raw.match(new RegExp('\\b(?:log\\s*in|login|go)\\s+to\\s+(.+?)(?=\\s+(?:and|then)\\s+(?:create|open|make|sign\\s*up|register)\\b|[!?;,]|\\.(?=\\s|$)|$)','i'))
  const byCreate=raw.match(new RegExp('\\b(?:create|open|make)\\s+(?:me\\s+)?(?:an?\\s+)?(?:new\\s+)?account\\s+(?:for\\s+me\\s+)?(?:on|at|with|for|in)\\s+(.+?)'+TERM,'i'))
  const bySignup=raw.match(new RegExp('\\b(?:sign\\s*up|register)\\s+(?:me\\s+)?(?:for\\s+an?\\s+account\\s+)?(?:on|at|with|for)\\s+(.+?)'+TERM,'i'))
  const bySignMeUp=raw.match(new RegExp('\\bsign\\s*me\\s*up\\s+(?:on|at|with)\\s+(.+?)'+TERM,'i'))
  const targets=([byLogin?.[1],byCreate?.[1],bySignup?.[1],bySignMeUp?.[1]].filter(Boolean) as string[]).map(value=>classifyTarget(value,explicitUrl))
  const usable=targets.find(target=>target.kind==='service')
  if(usable)return {named:true,service:usable.service}
  return {named:targets.some(target=>target.kind==='excluded'),service:''}
}

export function parseExternalAccountRequest(text:string):ExternalAccountRequest|null{
  const raw=String(text||'').replace(/\s+/g,' ').trim()
  if(!raw)return null
  const lower=raw.toLowerCase()
  const createAccount=LOOSE_CREATE.test(raw)
  const signupAccount=LOOSE_SIGNUP.test(raw)&&/\baccount\b/i.test(raw)
  const signMeUp=SIGN_ME_UP_ON.test(raw)
  if(!createAccount&&!signupAccount&&!signMeUp)return null
  if(/\b(?:buy|purchase|checkout|pay|payment|subscribe\s+to\s+(?:a\s+)?paid)\b/i.test(lower))return null
  if(externalAccountIntentExcluded(raw))return null

  const explicitUrl=extractAccountUrl(raw)
  let service=accountTarget(raw,explicitUrl).service
  if(!service&&explicitUrl){
    try{service=new URL(explicitUrl).hostname.replace(/^www\./,'')}catch{}
  }
  if(!service)return null
  return {service,email:extractAccountEmail(raw),url:explicitUrl}
}
