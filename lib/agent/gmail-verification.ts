import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'

export function isGmailVerificationQuery(text:string){
  const t=text.trim()
  return /^(?:did|has|was|verify|check|confirm|show|give me)\b/i.test(t)
    && /\b(?:gmail|email|message)\b/i.test(t)
    && /\b(?:sent|send|verification|verify|proof|evidence)\b/i.test(t)
}

export async function readGmailSendVerification(params:{actor:AgentActor;text:string},verify:(messageId:string,threadId:string)=>Promise<{verified:boolean;reason?:string|null}>){
  if(!isGmailVerificationQuery(params.text))return null
  const tg=String(params.actor.legacyTelegramId)
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('id,status')
    .eq('telegram_id',tg).eq('type','gmail_send').order('started_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error('gmail_verification_run_read_failed')
  const reply=(text:string,verified=false)=>({runId:run?.id||'gmail-verification',status:'completed' as const,
    capability:'email' as const,risk:'low' as const,handledBy:'gmail-verification',text,
    verification:{verified,source:'gmail',kind:'read',objectKind:'gmail_send',objectRef:run?.id||null}})
  if(!run)return reply('I found no recorded Gmail send to verify. Nothing has been marked sent or completed.')
  const {data:receipt,error:receiptError}=await supabaseAdmin.from('agent_activity').select('metadata_json,created_at')
    .eq('telegram_id',tg).eq('run_id',run.id).in('event_type',['gmail_send_submitted','gmail_send_verified'])
    .order('created_at',{ascending:false}).limit(1).maybeSingle()
  if(receiptError)throw new Error('gmail_verification_evidence_read_failed')
  const m=receipt?.metadata_json
  if(!m?.gmail_message_id||!m?.thread_id)return reply(`The recorded send state is ${String(run.status).replaceAll('_',' ')}. I do not have an exact Gmail message receipt to verify; I cannot confirm it was sent. I have not retried the send.`)
  let result:{verified:boolean;reason?:string|null}
  try {result=await verify(String(m.gmail_message_id),String(m.thread_id))}
  catch {return reply('Gmail provider readback is unavailable. The send outcome remains unverified; I have not retried or marked anything complete.')}
  if(!result.verified)return reply('Gmail readback did not confirm both the SENT label and the expected thread. The send outcome remains unverified; I have not retried it.')
  return reply(`Gmail provider readback confirms the SENT label and the expected thread.\nMessage ID: ${m.gmail_message_id}\nThread ID: ${m.thread_id}\nThis was a read-only verification; nothing was sent again.`,true)
}
