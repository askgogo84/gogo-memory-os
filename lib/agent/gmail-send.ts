import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import { recordDecisionLearning } from './decision-learning'
import { buildApprovalBinding, assertApprovalBinding } from './approval-binding'
import { buildGmailSendConnectUrl, fetchGmailAttentionThreads, searchGmailThreads, refreshGmailAccessToken, sendGmailReply, verifyGmailSentMessage } from '@/lib/services/google-gmail'
import { decryptGoogleToken } from '@/lib/security/google-token-crypto'
import { clearFollowupState, getLatestFollowupState, isStrictlyFreshFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'

function clean(value:unknown,max=1200){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function emailFromHeader(value:unknown){
  const raw=clean(value,240)
  const angle=raw.match(/<([^>]+@[^>]+)>/)
  if(angle?.[1])return angle[1].trim().toLowerCase()
  return raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase()||''
}
function norm(value:unknown){return clean(value,300).toLowerCase().replace(/[^a-z0-9@.]+/g,' ').replace(/\s+/g,' ').trim()}

export function isGmailReplyCommand(text:string){
  const raw=clean(text,1200)
  return /^(?:draft\s+(?:a\s+)?reply|reply|respond)\s+to\s+(?:the\s+)?(?:latest\s+)?(?:email|mail|message)(?:\s+from)?\s+.+?\s+(?:saying|with|:)/i.test(raw)
    || /^(?:draft\s+(?:a\s+)?reply|reply|respond)\s+to\s+(?:the\s+)?(.+?)\s+(?:email|mail|message)\s+(?:saying|with|:)/i.test(raw)
    || /^(?:send\s+it|send\s+this\s+reply)$/i.test(raw)
}

export function isGmailSendStatusQuery(text:string){
  const raw=clean(text,900)
  return /^(?:is\s+gmail\s+send\s+(?:connected|authori[sz]ed)(?:\s+and\s+(?:connected|authori[sz]ed))?\s+for\s+me|can\s+you\s+actually\s+send\s+gmail\s+from\s+my\s+account\s+right\s+now.*|check\s+my\s+gmail\s+send\s+connection(?:\s+again)?)\??$/i.test(raw)
}

export function parseGmailReplyCommand(text:string){
  const raw=clean(text,2000)
  const draftOnly=/^draft\b/i.test(raw)
  const m=raw.match(/^(?:draft\s+(?:a\s+)?reply|reply|respond)\s+to\s+(?:the\s+)?(?:latest\s+)?(?:email|mail|message)(?:\s+from)?\s+(.+?)\s+(?:saying|with|:)\s*(.+)$/i)
    || raw.match(/^(?:draft\s+(?:a\s+)?reply|reply|respond)\s+to\s+(?:the\s+)?(.+?)\s+(?:email|mail|message)\s+(?:saying|with|:)\s*(.+)$/i)
  if(!m)return null
  const target=clean(m[1],180)
  const body=String(m[2]||'').trim().slice(0,6000)
  if(!target||!body)return null
  return {target,body,draftOnly}
}

async function gmailAccess(actor:AgentActor,{requireSend=false}:{requireSend?:boolean}={}){
  const {data:user,error}=await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_send_connected,gmail_email,gmail_access_token,gmail_refresh_token')
    .eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  if(error)throw new Error(`gmail_send_user_read_failed:${error.message}`)
  if(!user?.gmail_connected)return {ok:false as const,reason:'gmail_not_connected',user:null,accessToken:''}
  if(requireSend&&!user?.gmail_send_connected)return {ok:false as const,reason:'gmail_send_not_connected',user,accessToken:''}
  let accessToken=''
  const refresh=decryptGoogleToken(user.gmail_refresh_token)
  if(refresh)accessToken=String(await refreshGmailAccessToken(refresh)||'')
  if(!accessToken)accessToken=decryptGoogleToken(user.gmail_access_token)
  if(!accessToken)return {ok:false as const,reason:'gmail_token_unavailable',user,accessToken:''}
  return {ok:true as const,reason:null,user,accessToken}
}

async function resolveThread(actor:AgentActor,target:string){
  const access=await gmailAccess(actor)
  if(!access.ok)return {access,match:null as any,ambiguous:false}
  let threads=await searchGmailThreads(access.accessToken,target,30)
  if(!threads.length)threads=await fetchGmailAttentionThreads(access.accessToken,20)
  const q=norm(target)
  const candidates=threads.map(thread=>{
    const messages=thread.messages||[]
    const last=messages[messages.length-1]
    const incoming=[...messages].reverse().find((m:any)=>emailFromHeader(m.from)!==String(access.user?.gmail_email||'').toLowerCase())||last
    const hay=norm(`${incoming?.from||''} ${thread.subject||''}`)
    let score=0
    for(const token of q.split(' ').filter(x=>x.length>2))if(hay.includes(token))score++
    if(hay.includes(q)&&q.length>2)score+=4
    return {thread,incoming,score}
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score)
  if(!candidates.length)return {access,match:null as any,ambiguous:false}
  if(candidates[1]&&candidates[0].score===candidates[1].score)return {access,match:null as any,ambiguous:true}
  return {access,match:candidates[0],ambiguous:false}
}

function preview(draft:any){
  return `To: ${draft.to}\nSubject: ${/^re:/i.test(draft.subject)?draft.subject:`Re: ${draft.subject}`}\n\n${draft.body}`
}

async function stageApproval(actor:AgentActor,draft:any){
  const now=new Date().toISOString()
  const {data:run,error:runError}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(actor.legacyTelegramId),type:'gmail_send',capability:'email',status:'waiting_approval',
    title:`Send reply: ${clean(draft.subject,140)}`,summary:'Waiting for approval before sending Gmail.',progress:25,
    why:'Sending email creates an external communication.',source:'whatsapp',
    metadata_json:{plan_type:'gmail_send',draft},started_at:now,updated_at:now,
  }).select('id').single()
  if(runError||!run?.id)throw new Error(`gmail_send_run_create_failed:${runError?.message||'unknown'}`)
  const runId=String(run.id)
  const binding=buildApprovalBinding({
    missionId:runId,stepId:'send',capability:'email',actionType:'send_email',
    target:`gmail_thread:${draft.threadId}`,
    payload:{threadId:draft.threadId,to:draft.to,subject:draft.subject,body:draft.body},
  })
  const {data:approval,error}=await supabaseAdmin.from('agent_approvals').insert({
    telegram_id:String(actor.legacyTelegramId),run_id:runId,action_type:'send_email',
    title:`Send email reply to ${draft.to}`,description:'This will send an external Gmail reply.',
    payload_preview:[
      {label:'To',value:draft.to},{label:'Subject',value:draft.subject},{label:'Message',value:clean(draft.body,700)},{label:'Risk',value:'high'},
    ],
    execution_payload:{plan_type:'gmail_send',capability:'email',threadId:draft.threadId},
    risk_level:'high',status:'pending',...binding,
  }).select('id').single()
  if(error||!approval?.id)throw new Error(`gmail_send_approval_create_failed:${error?.message||'unknown'}`)
  return {runId,approvalId:String(approval.id)}
}

export async function tryRunGmailContextCommand(params:{actor:AgentActor;text:string}){
  const raw=clean(params.text,1400)
  const ordinal=raw.match(/^(?:open|show|read|summari[sz]e)\s+(?:the\s+)?(first|second|third|1st|2nd|3rd)\s+one\b/i)
  if(ordinal){
    const state=await getLatestFollowupState(params.actor.legacyTelegramId,'gmail_search_results')
    if(!state||!isStrictlyFreshFollowupState(state,30)||!Array.isArray(state.payload?.messages))return null
    const map:any={first:0,'1st':0,second:1,'2nd':1,third:2,'3rd':2}
    const message=state.payload.messages[map[String(ordinal[1]).toLowerCase()]]
    if(!message)return {runId:'gmail-context-ordinal-missing',status:'paused' as const,capability:'email' as const,risk:'low' as const,text:'That Gmail result number is not in the current search set.',handledBy:'gmail-context'}
    await clearFollowupState(params.actor.legacyTelegramId,'gmail_selected_message')
    await saveFollowupState(params.actor.legacyTelegramId,'gmail_selected_message',{message,created_at:new Date().toISOString()})
    return {runId:'gmail-context-selected',status:'completed' as const,capability:'email' as const,risk:'low' as const,
      text:`From: ${message.from||'Unknown sender'}\nDate: ${message.date||'Unknown date'}\nSubject: ${message.subject||'(No subject)'}\n\nSummary:\n${clean(message.snippet||'No preview available.',900)}`,handledBy:'gmail-context'}
  }
  if(/^(?:who sent (?:that|it)|when did i receive (?:that|it)|what does (?:that|it) say|tell me about (?:that|it))\b/i.test(raw)){
    const state=await getLatestFollowupState(params.actor.legacyTelegramId,'gmail_selected_message')
    if(!state||!isStrictlyFreshFollowupState(state,30)||!state.payload?.message)return null
    const m=state.payload.message
    return {runId:'gmail-context-read',status:'completed' as const,capability:'email' as const,risk:'low' as const,
      text:`From: ${m.from||'Unknown sender'}\nDate: ${m.date||'Unknown date'}\nSubject: ${m.subject||'(No subject)'}\n\n${clean(m.snippet||'No preview available.',900)}`,handledBy:'gmail-context'}
  }
  return null
}

export async function tryRunGmailSendCommand(params:{actor:AgentActor;text:string}){
  const raw=clean(params.text,2200)

  if(isGmailSendStatusQuery(raw)){
    const {data:user,error}=await supabaseAdmin.from('users')
      .select('gmail_connected,gmail_send_connected,gmail_email')
      .eq('telegram_id',params.actor.legacyTelegramId).maybeSingle()
    if(error)throw new Error(`gmail_send_status_read_failed:${error.message}`)
    if(!user?.gmail_connected){
      return {runId:'gmail-send-status',status:'completed' as const,capability:'email' as const,risk:'low' as const,text:'Gmail is not connected for this account yet. Connect Gmail first; Send cannot be enabled until the base Gmail connection exists.',handledBy:'gmail-send'}
    }
    if(user.gmail_send_connected){
      return {runId:'gmail-send-status',status:'completed' as const,capability:'email' as const,risk:'low' as const,text:`✅ Gmail Send is connected and authorised${user.gmail_email?` for ${user.gmail_email}`:''}. Sending is still approval-gated; I will not send an email without the required explicit approval.`,handledBy:'gmail-send'}
    }
    const url=buildGmailSendConnectUrl(params.actor.legacyTelegramId)
    return {runId:'gmail-send-status',status:'paused' as const,capability:'email' as const,risk:'low' as const,text:url?`Gmail read access is connected, but Gmail Send is not authorised yet. Use this one-time upgrade:\n${url}\n\nThis only grants the Send scope; individual sends still require approval.`:'Gmail read access is connected, but Gmail Send is not authorised yet.',handledBy:'gmail-send'}
  }

  if(/^(?:send\s+it|send\s+this\s+reply)$/i.test(raw)){
    const state=await getLatestFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft')
    if(!state||!isStrictlyFreshFollowupState(state,30)||!state.payload?.draft)return null
    const sendAccess=await gmailAccess(params.actor,{requireSend:true})
    if(!sendAccess.ok){
      if(sendAccess.reason==='gmail_send_not_connected'){
        const url=buildGmailSendConnectUrl(params.actor.legacyTelegramId)
        return {runId:'gmail-send-upgrade',status:'paused' as const,capability:'email' as const,risk:'high' as const,text:url?`Gmail Send is not enabled yet. Approve the one-time Gmail Send upgrade here:\n${url}\n\nThis does not make email sending automatic; sends still require AskGogo approval.`:'Gmail Send is not enabled yet.',handledBy:'gmail-send'}
      }
      return {runId:'gmail-send-unavailable',status:'paused' as const,capability:'email' as const,risk:'high' as const,text:'Your Gmail connection needs to be reconnected before I can send.',handledBy:'gmail-send'}
    }
    const staged=await stageApproval(params.actor,state.payload.draft)
    await clearFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft')
    return {runId:staged.runId,status:'waiting_approval' as const,capability:'email' as const,risk:'high' as const,approvalId:staged.approvalId,approvalRequired:true,text:`📧 Ready to send — approval required\n\n${preview(state.payload.draft)}\n\nNothing has been sent yet. Reply *APPROVE* to send or *REJECT* to stop.`,handledBy:'gmail-send'}
  }

  const parsed=parseGmailReplyCommand(raw)
  if(!parsed)return null
  // Natural reply commands include nouns after the referent ("that exact email").
  // Treat the full phrase as selected-object context; never fuzzy-search it again.
  const contextual=/^(?:that|this|it)(?:\s+exact)?(?:\s+(?:email|mail|message|one))?$/i.test(parsed.target.trim())
    || /^(?:the\s+)?(?:selected|first|second|third)(?:\s+(?:email|mail|message|one))?$/i.test(parsed.target.trim())
  let selected:any=null
  if(contextual){
    const state=await getLatestFollowupState(params.actor.legacyTelegramId,'gmail_selected_message')
    if(state&&isStrictlyFreshFollowupState(state,30)&&state.payload?.message)selected=state.payload.message
  }
  const resolved=selected?{access:await gmailAccess(params.actor),match:{thread:{id:selected.threadId,subject:selected.subject},incoming:selected},ambiguous:false}:await resolveThread(params.actor,parsed.target)
  if(!resolved.access.ok){
    return {runId:'gmail-reply-needs-google',status:'paused' as const,capability:'email' as const,risk:'low' as const,text:'Connect Google Workspace first so I can find the email thread.',handledBy:'gmail-send'}
  }
  if(resolved.ambiguous){
    return {runId:'gmail-reply-ambiguous',status:'paused' as const,capability:'email' as const,risk:'low' as const,text:'I found more than one matching email thread. Tell me the sender email address or a few words from the subject.',handledBy:'gmail-send'}
  }
  if(!resolved.match?.thread||!resolved.match?.incoming){
    return {runId:'gmail-reply-not-found',status:'paused' as const,capability:'email' as const,risk:'low' as const,text:`I couldn't find a recent Gmail thread matching “${clean(parsed.target,120)}”. Give me the sender email or subject.`,handledBy:'gmail-send'}
  }
  const message=resolved.match.incoming
  const draft={
    threadId:String(resolved.match.thread.id),
    to:emailFromHeader(message.from),
    subject:String(message.subject||resolved.match.thread.subject||'(No subject)'),
    body:parsed.body,
    inReplyTo:String(message.messageId||'')||null,
  }
  if(!draft.to)return {runId:'gmail-reply-recipient-missing',status:'paused' as const,capability:'email' as const,risk:'low' as const,text:'I found the thread, but I could not safely resolve the recipient address. Give me the email address explicitly.',handledBy:'gmail-send'}

  await clearFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft')
  await saveFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft',{draft,created_at:new Date().toISOString()})

  if(parsed.draftOnly){
    return {runId:'gmail-reply-draft',status:'completed' as const,capability:'email' as const,risk:'low' as const,text:`📧 Draft reply\n\n${preview(draft)}\n\nNothing has been sent. Say *send it* when you want me to stage approval.`,handledBy:'gmail-send'}
  }

  const sendAccess=await gmailAccess(params.actor,{requireSend:true})
  if(!sendAccess.ok){
    const url=buildGmailSendConnectUrl(params.actor.legacyTelegramId)
    return {runId:'gmail-send-upgrade',status:'paused' as const,capability:'email' as const,risk:'high' as const,text:url?`I drafted the reply, but Gmail Send is not enabled yet. Approve the one-time upgrade here:\n${url}\n\nThen say *send it*. Nothing has been sent.`:'Gmail Send is not enabled yet.',handledBy:'gmail-send'}
  }
  const staged=await stageApproval(params.actor,draft)
  await clearFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft')
  return {runId:staged.runId,status:'waiting_approval' as const,capability:'email' as const,risk:'high' as const,approvalId:staged.approvalId,approvalRequired:true,text:`📧 Ready to send — approval required\n\n${preview(draft)}\n\nNothing has been sent yet. Reply *APPROVE* to send or *REJECT* to stop.`,handledBy:'gmail-send'}
}

export async function executeApprovedGmailSend(params:{actor:AgentActor;runId:string}){
  const tg=String(params.actor.legacyTelegramId)
  const [{data:run,error:runError},{data:approval,error:approvalError}]=await Promise.all([
    supabaseAdmin.from('agent_runs').select('id,status,metadata_json').eq('id',params.runId).eq('telegram_id',tg).maybeSingle(),
    supabaseAdmin.from('agent_approvals').select('id,status,action_hash,policy_version').eq('run_id',params.runId).eq('telegram_id',tg).order('resolved_at',{ascending:false}).limit(1).maybeSingle(),
  ])
  if(runError||!run)throw new Error(`gmail_send_run_missing:${runError?.message||'not_found'}`)
  if(approvalError||!approval||approval.status!=='approved')throw new Error('gmail_send_approval_missing')
  const draft:any=(run.metadata_json as any)?.draft
  if(!draft?.threadId||!draft?.to||!draft?.subject||!draft?.body)throw new Error('gmail_send_draft_missing')
  assertApprovalBinding({
    missionId:params.runId,stepId:'send',capability:'email',actionType:'send_email',
    target:`gmail_thread:${draft.threadId}`,
    payload:{threadId:draft.threadId,to:draft.to,subject:draft.subject,body:draft.body},
  },approval)

  const access=await gmailAccess(params.actor,{requireSend:true})
  if(!access.ok)throw new Error(access.reason||'gmail_send_unavailable')

  await supabaseAdmin.from('agent_runs').update({status:'running',summary:'Sending approved Gmail reply.',progress:60,updated_at:new Date().toISOString()}).eq('id',params.runId).eq('telegram_id',tg)
  let mutationStarted=false
  try{
    mutationStarted=true
    const sent=await sendGmailReply(access.accessToken,draft)
    const evidence=await verifyGmailSentMessage(access.accessToken,sent.id,draft.threadId)
    if(!evidence.verified){
      const now=new Date().toISOString()
      await supabaseAdmin.from('agent_runs').update({status:'outcome_unknown',summary:'Gmail accepted the send, but provider verification is incomplete.',progress:100,error:evidence.reason,updated_at:now}).eq('id',params.runId).eq('telegram_id',tg)
      await supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:now}).eq('id',approval.id).eq('telegram_id',tg)
      await clearFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft')
      await recordDecisionLearning({actor:params.actor,decisionId:params.runId,text:'approved gmail send',domain:'email',handler:'gmail-send',objectKind:'gmail_thread',objectRef:draft.threadId,outcome:'unknown',verified:false}).catch(()=>{})
      return {runId:params.runId,status:'paused' as const,capability:'email' as const,risk:'high' as const,text:'Gmail accepted the approved send, but I could not verify the final SENT/thread state. I will not retry automatically because that could duplicate the email.',handledBy:'gmail-send'}
    }
    const now=new Date().toISOString()
    await supabaseAdmin.from('agent_runs').update({status:'completed',summary:`Sent and verified Gmail reply to ${draft.to}.`,progress:100,completed_at:now,updated_at:now}).eq('id',params.runId).eq('telegram_id',tg)
    await supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:now}).eq('id',approval.id).eq('telegram_id',tg)
    await supabaseAdmin.from('agent_activity').insert({telegram_id:tg,run_id:params.runId,event_type:'gmail_send_verified',message:`Gmail reply sent and provider-verified: ${clean(draft.subject,180)}`,metadata_json:{gmail_message_id:sent.id,thread_id:sent.threadId,to:draft.to}})
    await recordDecisionLearning({actor:params.actor,decisionId:params.runId,text:'approved gmail send',domain:'email',handler:'gmail-send',objectKind:'gmail_thread',objectRef:String(sent.threadId||draft.threadId),outcome:'verified_success',verified:true}).catch(()=>{})
    await clearFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft')
    return {runId:params.runId,status:'completed' as const,capability:'email' as const,risk:'high' as const,text:`✅ Sent and verified\n\nTo: ${draft.to}\nSubject: ${/^re:/i.test(draft.subject)?draft.subject:`Re: ${draft.subject}`}`,handledBy:'gmail-send'}
  }catch(err:any){
    const now=new Date().toISOString()
    const reason=clean(err?.message||err,300)
    const definitiveNoSend=/^gmail_send_(?:scope_required|failed_(?:400|401|403|404|422))$/.test(reason)
    if(mutationStarted&&!definitiveNoSend){
      await supabaseAdmin.from('agent_runs').update({status:'outcome_unknown',summary:'Gmail send outcome is unknown after the provider request started.',progress:100,error:reason,updated_at:now}).eq('id',params.runId).eq('telegram_id',tg)
      await supabaseAdmin.from('agent_approvals').update({status:'executed',executed_at:now}).eq('id',approval.id).eq('telegram_id',tg)
      await clearFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft')
      await recordDecisionLearning({actor:params.actor,decisionId:params.runId,text:'approved gmail send',domain:'email',handler:'gmail-send',objectKind:'gmail_thread',objectRef:draft.threadId,outcome:'unknown',verified:false}).catch(()=>{})
      return {runId:params.runId,status:'paused' as const,capability:'email' as const,risk:'high' as const,text:'The approved Gmail send started, but I cannot prove whether Gmail completed it. I will not retry automatically because that could send a duplicate. Please check the thread before trying anything else.',handledBy:'gmail-send'}
    }
    await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gmail rejected the send before provider acceptance.',progress:100,error:reason,completed_at:now,updated_at:now}).eq('id',params.runId).eq('telegram_id',tg)
    await supabaseAdmin.from('agent_approvals').update({status:'failed',resolved_at:now}).eq('id',approval.id).eq('telegram_id',tg)
    await recordDecisionLearning({actor:params.actor,decisionId:params.runId,text:'approved gmail send',domain:'email',handler:'gmail-send',objectKind:'gmail_thread',objectRef:draft.threadId,outcome:'failed',verified:false}).catch(()=>{})
    return {runId:params.runId,status:'failed' as const,capability:'email' as const,risk:'high' as const,text:'Gmail rejected the send before acceptance. Nothing is marked sent. Please review the Gmail Send connection before trying again.',handledBy:'gmail-send'}
  }
}

