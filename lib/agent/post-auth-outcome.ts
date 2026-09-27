import { readBrowserHandoffState } from './browser-handoff'
import { detectHumanAuthGate } from './browser-auth-gate'
import { redactBrowserSensitiveText } from './secure-browser-redaction'
import type { SecureBrowserResult } from './secure-computer'

/** Read the retained page only: never navigate, plan, click, or repeat a submit. */
export async function inspectPostAuthOutcome(metadata:any):Promise<SecureBrowserResult>{
  if(!metadata.handoff?.stateUrl)throw new Error('auth_reconciliation_session_unavailable')
  const page=await readBrowserHandoffState(metadata.handoff.stateUrl)
  const gate=detectHumanAuthGate(page)
  const actions=Array.isArray(metadata.auth_action_log)?metadata.auth_action_log:[]
  const base={url:page.url,originalUrl:metadata.auth_original_url||metadata.url,title:redactBrowserSensitiveText(page.title),forms:[],actions,sandboxName:String(metadata.handoff.sandboxName||'')}
  if(gate.required)return {...base,status:'blocked',blockReason:'human_auth_required',authReason:gate.reason,summary:gate.message||'Complete the human authentication step first.',pageText:''}
  const original=new URL(String(base.originalUrl||'')),current=new URL(page.url)
  if(current.hostname!==original.hostname&&!current.hostname.endsWith(`.${original.hostname}`))throw new Error('auth_reconciliation_provider_host_mismatch')
  return {...base,status:'completed',summary:'Gogo inspected the provider result after authentication without repeating the action.',pageText:redactBrowserSensitiveText(page.text).slice(0,9000)}
}
