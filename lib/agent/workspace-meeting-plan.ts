import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { buildCalendarConnectUrl } from '@/lib/google-calendar'
import { buildGmailConnectUrl } from '@/lib/google-gmail'
import { executeReadOnlyCalendarStep } from './calendar-read'
import { readWorkspaceEmailBrief, searchWorkspaceContacts, searchWorkspaceEmails } from './google-workspace-read'
import type { AgentActor } from './actor'

function safe(value:unknown,max=3000){return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim().slice(0,max))}

export function isWorkspaceMeetingPrep(text:string){
  const t=String(text||'')
  const email=/\b(email|gmail|mail|inbox)\b/i.test(t)
  const meeting=/\b(meeting|calendar|slot|availability|available|invite)\b/i.test(t)
  const prep=/\b(draft|reply|brief|attached|attachment|proposed|prepare)\b/i.test(t)
  return email&&meeting&&prep
}

function requestedPerson(text:string){
  const patterns=[
    /(?:find|show|read|check)\s+([A-Z][A-Za-z.'-]{1,40})(?:['’]s)\s+(?:latest\s+|recent\s+)?(?:email|mail)/,
    /(?:email|mail)\s+from\s+([A-Z][A-Za-z.'-]{1,40})/i,
    /(?:with|for)\s+([A-Z][A-Za-z.'-]{1,40})\s+(?:about|regarding|meeting)/,
  ]
  for(const pattern of patterns){const match=String(text||'').match(pattern);if(match?.[1])return safe(match[1],80)}
  return ''
}

function addressFromHeader(header:string){
  const bracket=String(header||'').match(/<([^<>\s]+@[^<>\s]+)>/)
  if(bracket?.[1])return safe(bracket[1],220)
  const plain=String(header||'').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)
  return plain?.[0]?safe(plain[0],220):''
}

function firstUsefulBriefLine(text:string){
  const normalized=safe(text,1200)
  const sentence=normalized.split(/(?<=[.!?])\s+/).find(x=>x.length>=35&&x.length<=360)
  return safe(sentence||normalized.slice(0,300),320)
}

function replyDraft(params:{person:string;subject:string;briefText:string;slotLabel:string;userName:string}){
  const firstName=params.person||'there'
  const briefLine=firstUsefulBriefLine(params.briefText)
  return [
    `Subject: Re: ${safe(params.subject||'Meeting',180)}`,
    '',
    `Hi ${firstName},`,
    '',
    `Thanks for the note. I’ve reviewed the attached brief and the meeting context.${briefLine?` One point I noted from the brief is: ${briefLine}`:''}`,
    '',
    `Would ${params.slotLabel} work for a 30-minute discussion? If that works for you, I’ll confirm the invite.`,
    '',
    'Best,',
    safe(params.userName||'Gogo',100),
  ].join('\n')
}

async function createRun(actor:AgentActor,text:string){
  const now=new Date().toISOString()
  const {data,error}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(actor.legacyTelegramId),type:'workspace_meeting_prep',capability:'email',risk_level:'low',status:'running',
    title:'Prepare meeting reply + invite',summary:'Gogo is gathering private Workspace context without sending or scheduling anything.',
    why:'User asked Gogo to prepare a cross-app meeting response.',source:'workspace',started_at:now,updated_at:now,
    metadata_json:{plan_type:'workspace_meeting_prep',input_text:String(text||'').slice(0,1800),mutationsAllowed:false},
  }).select('id').single()
  if(error||!data?.id)throw new Error(`workspace_meeting_run_create_failed:${error?.message||'unknown'}`)
  return String(data.id)
}

async function finishRun(actor:AgentActor,runId:string,params:{status:'completed'|'paused'|'failed';summary:string;metadata?:Record<string,unknown>;error?:string}){
  const now=new Date().toISOString()
  const {error}=await supabaseAdmin.from('agent_runs').update({
    status:params.status,summary:safe(params.summary,900),updated_at:now,
    ...(params.status==='completed'||params.status==='failed'?{completed_at:now}:{}),
    ...(params.error?{error:safe(params.error,400)}:{}),
    ...(params.metadata?{metadata_json:params.metadata}:{}),
  }).eq('id',runId).eq('telegram_id',String(actor.legacyTelegramId))
  if(error)console.error('WORKSPACE_MEETING_RUN_FINISH_FAILED:',error.message)
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(actor.legacyTelegramId),run_id:runId,event_type:`workspace_meeting_${params.status}`,
    message:safe(params.summary,900),metadata_json:{mutated:false,...(params.metadata||{})},
  }).then(({error})=>{if(error)console.error('WORKSPACE_MEETING_ACTIVITY_FAILED:',error.message)})
}

async function createArtifact(actor:AgentActor,runId:string,data:Record<string,unknown>){
  const {data:artifact,error}=await supabaseAdmin.from('agent_artifacts').insert({
    telegram_id:String(actor.legacyTelegramId),type:'meeting_prep',title:'Meeting reply + proposed invite',
    subtitle:'Prepared by Gogo · nothing sent or scheduled',schema_version:1,content_json:data,
    source_refs:[{type:'agent_run',id:runId}],
  }).select('id').single()
  if(error||!artifact?.id)throw new Error(`workspace_meeting_artifact_failed:${error?.message||'unknown'}`)
  return String(artifact.id)
}

function gmailConnect(actor:AgentActor){
  const url=buildGmailConnectUrl(actor.legacyTelegramId)
  return url?`Connect or refresh Google Workspace first:\n${url}`:'Google Workspace connection is temporarily unavailable.'
}
function calendarConnect(actor:AgentActor){
  const url=buildCalendarConnectUrl(actor.legacyTelegramId)
  return url?`Connect Google Calendar first:\n${url}`:'Google Calendar connection is temporarily unavailable.'
}

export async function tryPrepareWorkspaceMeetingPlan(params:{actor:AgentActor;surface:string;text:string}){
  if(!isWorkspaceMeetingPrep(params.text))return null
  const {actor,text}=params
  const runId=await createRun(actor,text)
  try{
    const person=requestedPerson(text)
    const emailQuery=person?`find latest email from ${person}`:`find latest email about meeting`
    let emailSearch:any
    try{emailSearch=await searchWorkspaceEmails(actor,emailQuery)}catch(err:any){
      const code=String(err?.message||'')
      if(['workspace_not_connected','workspace_reconnect_required','workspace_scope_required'].includes(code)){
        const summary='Google Workspace needs to be connected or refreshed before Gogo can prepare this meeting response.'
        await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_meeting_prep',input_text:text,mutationsAllowed:false}})
        return {runId,status:'paused',capability:'email',risk:'low',text:`${summary}\n\n${gmailConnect(actor)}`,handledBy:'workspace-meeting-prep'}
      }
      throw err
    }
    const messages=emailSearch?.messages||[]
    if(!messages.length){
      const summary=person?`I couldn't find a recent email from ${person}. I did not guess or use a different sender.`:'I could not find a matching recent meeting email.'
      await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_meeting_prep',input_text:text,mutationsAllowed:false}})
      return {runId,status:'paused',capability:'email',risk:'low',text:summary,handledBy:'workspace-meeting-prep'}
    }
    const email=messages[0]

    let briefText=''
    let briefFilename=''
    if(/\b(attached|attachment|brief|document|deck|proposal|pdf)\b/i.test(text)){
      const brief=await readWorkspaceEmailBrief(actor,messages,text)
      if(brief.status==='ambiguous'){
        const choices=brief.attachments.map((a:any,i:number)=>`${i+1}. ${a.filename} — ${a.subject}`).join('\n')
        const summary='I found more than one equally plausible attachment, so I stopped instead of choosing the wrong brief.'
        await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_meeting_prep',input_text:text,mutationsAllowed:false}})
        return {runId,status:'paused',capability:'email',risk:'low',text:`${summary}\n\n${choices}`,handledBy:'workspace-meeting-prep'}
      }
      if(brief.status!=='found'){
        const summary=brief.status==='too_large'?`I found ${brief.filename}, but it exceeds the safe attachment read limit.`:brief.status==='unreadable'?`I found ${brief.filename}, but I couldn't extract reliable text from it.`:'I found the email, but no readable attachment matched the brief request.'
        await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_meeting_prep',input_text:text,mutationsAllowed:false}})
        return {runId,status:'paused',capability:'email',risk:'low',text:`${summary} I did not substitute the email snippet for the brief.`,handledBy:'workspace-meeting-prep'}
      }
      briefText=brief.text
      briefFilename=brief.filename
    }

    let availability:any
    try{
      availability=await executeReadOnlyCalendarStep({actor,instruction:text,missionText:text})
    }catch(err:any){
      if(String(err?.message||'')==='calendar_not_connected'){
        const summary='I found the email and brief, but Calendar is not connected, so I cannot verify a free slot yet.'
        await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_meeting_prep',input_text:text,mutationsAllowed:false}})
        return {runId,status:'paused',capability:'calendar',risk:'low',text:`${summary}\n\n${calendarConnect(actor)}`,handledBy:'workspace-meeting-prep'}
      }
      throw err
    }
    const slots=availability?.output?.availableSlots||[]
    if(!slots.length){
      const summary='I found the email and brief, but no free slot matched the requested window.'
      await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_meeting_prep',input_text:text,mutationsAllowed:false}})
      return {runId,status:'paused',capability:'calendar',risk:'low',text:`${summary}\n\n${availability?.text||''}`,handledBy:'workspace-meeting-prep'}
    }
    const slot=slots[0]

    let contact:any=null
    if(person){
      try{const result=await searchWorkspaceContacts(actor,`find contact ${person}`);if(result.status==='resolved')contact=result.contacts[0]}catch{}
    }
    const recipient=addressFromHeader(email.from)||(contact?.emails?.[0]||'')
    const displayPerson=person||safe(String(email.from||'').replace(/<[^>]+>/g,'').replace(/["']/g,'').trim(),80)||'there'
    const draft=replyDraft({person:displayPerson,subject:email.subject,briefText:briefText||email.snippet||'',slotLabel:slot.label,userName:actor.name})
    const proposedInvite={
      title:safe(String(email.subject||'Meeting').replace(/^re:\s*/i,''),180),
      start:slot.start,end:slot.end,timezone:availability.output.timezone,
      attendee:recipient||null,status:'proposed_not_scheduled',
    }
    const artifactData={
      sourceEmail:{messageId:String(email.id||''),threadId:String(email.threadId||''),subject:safe(email.subject,240),from:safe(email.from,240),date:safe(email.date,120)},
      attachment:briefFilename?{filename:briefFilename,used:true}:{used:false},
      contact:contact?{name:safe(contact.name,160),email:safe(contact.emails?.[0]||'',220),source:'google-contacts'}:null,
      proposedInvite,draftReply:draft,safety:{emailSent:false,calendarScheduled:false,approvalRequiredForExecution:true},
    }
    const artifactId=await createArtifact(actor,runId,artifactData)
    const summary=`Prepared a reply and proposed ${availability.output.durationMinutes||30}-minute meeting slot. Nothing was sent or scheduled.`
    await finishRun(actor,runId,{status:'completed',summary,metadata:{plan_type:'workspace_meeting_prep',input_text:text,artifactId,mutationsAllowed:false,proposedInvite}})
    return {
      runId,status:'completed',capability:'email',risk:'low',handledBy:'workspace-meeting-prep',
      text:`${summary}\n\nProposed slot: ${slot.label}${recipient?`\nTo: ${recipient}`:''}\n\n${draft}\n\nSaved as a private Gogo artifact. Sending the email or creating the calendar invite remains locked behind a separate approval-gated action.`,
      artifactId,
    }
  }catch(err:any){
    const summary='Gogo could not safely finish the meeting preparation. No email was sent and no calendar event was created.'
    await finishRun(actor,runId,{status:'failed',summary,error:String(err?.message||'workspace_meeting_failed'),metadata:{plan_type:'workspace_meeting_prep',input_text:text,mutationsAllowed:false}})
    console.error('WORKSPACE_MEETING_PLAN_FAILED:',String(err?.message||err).slice(0,160))
    return {runId,status:'failed',capability:'email',risk:'low',text:summary,handledBy:'workspace-meeting-prep'}
  }
}
