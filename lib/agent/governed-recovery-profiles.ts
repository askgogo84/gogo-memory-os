// Only these code-owned, read-only profiles may be selected by a reviewed
// immutable revision. A database row cannot define a handler or instructions.
export const RECOVERY_PROFILES={
  'calendar.exact.read':'calendar_exact_v1',
  'email.exact.verify':'gmail_verify_v1',
  'reminder.exact.read':'reminder_exact_v1',
  'watcher.exact.status':'watcher_status_v1'
} as const
export type RecoverySkillId=keyof typeof RECOVERY_PROFILES
export type RecoveryProfile=(typeof RECOVERY_PROFILES)[RecoverySkillId]
export function profileForSkill(skill:string):RecoveryProfile|null{
  return Object.prototype.hasOwnProperty.call(RECOVERY_PROFILES,skill)?RECOVERY_PROFILES[skill as RecoverySkillId]:null
}
export type RecoveryRequest={skill:RecoverySkillId;target:string|null}
export function parseRecoveryRequest(raw:string):RecoveryRequest|null{
  if(typeof raw!=='string'||raw.length>320||/[\r\n\x00-\x1f\x7f]/.test(raw))return null
  const text=raw.trim().replace(/[?.!]$/,'').replace(/^please\s+/i,'')
  if(/^(?:show|list)\s+(?:my\s+)?(?:active\s+)?(?:watches|watchers|monitors)$/i.test(text)||/^what are you (?:watching|monitoring|tracking)(?: for me)?(?: and why)?$/i.test(text))return {skill:'watcher.exact.status',target:null}
  if(/^(?:verify|check|confirm)\s+(?:my|the)\s+(?:last|latest)\s+(?:gmail|email)\s+send$/i.test(text)||/^did you send my (?:last|latest) (?:gmail|email|message)$/i.test(text))return {skill:'email.exact.verify',target:null}
  // Restrict the new execution lane to a single named object and explicit
  // domain. No relative references, corrections, ordinals, compound actions,
  // arbitrary date filters, forwarded text or LLM rewrites.
  const m=/^(?:what time is|when is)\s+(?:my |the )?(?:(calendar event|calendar meeting|meeting|event|appointment|reminder)(?:\s+(?:for|called|named))?\s+(.+)|(.+?)\s+(calendar event|calendar meeting|meeting|event|appointment|reminder))$/i.exec(text)
  if(!m)return null
  const label=(m[1]||m[4]).toLowerCase(),target=(m[2]||m[3]).trim().replace(/^["“](.+)["”]$/,'$1')
  if(!target||target.length>120||!/^[\p{L}\p{N}][\p{L}\p{N} ._'’()&-]*$/u.test(target)||/^(?:it|that|this|selected|one|first|second|third|last|latest|next|\d+)$/i.test(target)||/\b(?:and then|then|also|or|and|today|tomorrow|yesterday|next|last|at|send|delete|cancel|move|book|reschedule|stop|update|ignore|approve|reject)\b/i.test(target))return null
  return {skill:label==='reminder'?'reminder.exact.read':'calendar.exact.read',target}
}
export function exactRecoveryTitle(value:unknown):string{return typeof value==='string'?value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase():''}
