import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { DecisionDomain } from './decision-learning'

export type CorrectionTarget={decisionId:string;handler:string;domain:DecisionDomain;text:string}
export function isExplicitRoutingCorrection(text:string){
  return /^(?:no[,!]?\s+(?:i\s+(?:meant|asked|wanted)|that(?:'s| is)\s+(?:wrong|not))|i\s+(?:meant|asked for)|(?:that(?:'s| is)|you got)\s+(?:the\s+)?wrong)\b/i.test(text.trim())
}

export function correctionTarget(params:{text:string;previous:any;previousUserText:string;now?:number}):CorrectionTarget|null{
  if(!isExplicitRoutingCorrection(params.text))return null
  const row=params.previous,m=row?.metadata_json
  const age=(params.now??Date.now())-Date.parse(String(row?.created_at||''))
  // Only bind feedback to the immediately preceding persisted user turn and a
  // recent identified decision. Never guess a target from a stale task or topic.
  if(!m?.decision_id||!Number.isFinite(age)||age<0||age>15*60_000)return null
  if(!m.user_text||m.user_text!==params.previousUserText.replace(/\s+/g,' ').trim().slice(0,800))return null
  if(!/^[a-z][a-z0-9_-]{0,99}$/.test(m.handler)||m.outcome==='corrected'||m.outcome==='replacement')return null
  if(!['email','calendar','reminders','watchers','travel','browser','other'].includes(m.domain))return null
  return {decisionId:m.decision_id,handler:m.handler,domain:m.domain,text:m.user_text}
}

export async function captureExplicitRoutingCorrection(actor:AgentActor,text:string):Promise<CorrectionTarget|null>{
  if(!isExplicitRoutingCorrection(text))return null
  const [decision,conversation]=await Promise.all([
    supabaseAdmin.from('agent_activity').select('metadata_json,created_at').eq('telegram_id',String(actor.legacyTelegramId))
      .eq('event_type','decision_learning').order('created_at',{ascending:false}).limit(1).maybeSingle(),
    supabaseAdmin.from('conversations').select('content').eq('telegram_id',actor.legacyTelegramId)
      .eq('role','user').order('created_at',{ascending:false}).limit(1).maybeSingle(),
  ])
  if(decision.error||conversation.error)return null
  const target=correctionTarget({text,previous:decision.data,previousUserText:String(conversation.data?.content||'')})
  if(!target)return null
  // This could be a correction to the answer's content rather than its route.
  // Defer negative routing evidence until a different handler actually handles it.
  return target
}
