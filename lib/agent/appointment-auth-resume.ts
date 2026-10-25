import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshGmailAccessToken } from '@/lib/google-gmail'
import { decryptGoogleToken, encryptGoogleToken } from '@/lib/security/google-token-crypto'
import { registerLifeEvent } from './life-event-engine'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

type ResumeIntent = 'auth_done' | 'booking_done' | 'check_confirmation'

function safe(value: unknown, max = 800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function appointmentAuthResumeIntent(text: string): ResumeIntent | null {
  const t = safe(text, 500).toLowerCase()
  if (/^(?:otp|authentication|auth|login)\s+(?:is\s+)?(?:done|completed|complete|finished)$/i.test(t)
    || /^(?:i\s+)?(?:completed|finished|did)\s+(?:the\s+)?(?:otp|authentication|auth|login)$/i.test(t)) return 'auth_done'
  if (/^(?:appointment|booking)\s+(?:is\s+)?(?:booked|confirmed|done|complete|completed)$/i.test(t)
    || /^(?:i\s+)?(?:booked|confirmed|completed)\s+(?:the\s+)?(?:appointment|booking)$/i.test(t)) return 'booking_done'
  if (/^(?:check|verify)\s+(?:the\s+)?(?:appointment|booking)\s+(?:confirmation|email)$/i.test(t)
    || /^(?:check|verify)\s+(?:my\s+)?(?:appointment|booking)$/i.test(t)) return 'check_confirmation'
  return null
}

async function latestHandoff(tg: number) {
  const { data, error } = await supabaseAdmin.from('agent_runs')
    .select('id,status,error,metadata_json,started_at,updated_at')
    .eq('telegram_id', String(tg))
    .eq('type', 'secure_browser')
    .in('status', ['paused','completed'])
    .order('started_at', { ascending: false })
    .limit(30)
  if (error) throw new Error(`appointment_auth_context_read_failed:${error.message}`)
  return (data || []).find((row:any) => {
    const meta = row?.metadata_json || {}
    const selection = meta?.appointment_selection || {}
    return meta?.appointment_prepared === true
      && selection?.providerLocked === true
      && selection?.locationLocked === true
      && Boolean(selection?.provider || selection?.title)
      && Boolean(selection?.location)
      && (['human_auth_required','provider_access_limited','whatsapp_browser_response_timeout'].includes(String(row?.error || ''))
        || ['waiting_human_auth','waiting_external_provider','waiting_provider_confirmation'].includes(String(meta?.appointment_auth_resume?.state || '')))
  }) || null
}

async function saveResumeState(tg:number, run:any, patch:Record<string,unknown>) {
  const meta = run?.metadata_json || {}
  const next = {
    ...meta,
    appointment_auth_resume: {
      ...(meta?.appointment_auth_resume || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  }
  const { error } = await supabaseAdmin.from('agent_runs').update({ metadata_json: next, updated_at: new Date().toISOString() })
    .eq('id', String(run.id)).eq('telegram_id', String(tg))
  if (error) throw new Error(`appointment_auth_context_update_failed:${error.message}`)
  return next
}

async function gmailToken(actor: AgentActor) {
  const { data, error } = await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_access_token,gmail_refresh_token,timezone')
    .eq('telegram_id', actor.legacyTelegramId).maybeSingle()
  if (error) throw new Error(`appointment_gmail_credentials_failed:${error.message}`)
  if (!data?.gmail_connected) return null
  let access = decryptGoogleToken(String(data.gmail_access_token || ''))
  const refresh = decryptGoogleToken(String(data.gmail_refresh_token || ''))
  if (!access && refresh) access = await refreshGmailAccessToken(refresh) || ''
  if (!access) return null
  return { access, refresh, timezone:String(data.timezone || 'Asia/Kolkata') }
}

async function gmailFetch(actor:AgentActor, url:string, creds:{access:string;refresh:string}) {
  let response = await fetch(url, { headers:{Authorization:`Bearer ${creds.access}`}, cache:'no-store' })
  if (response.status === 401 && creds.refresh) {
    const next = await refreshGmailAccessToken(creds.refresh)
    if (!next) return null
    await supabaseAdmin.from('users').update({ gmail_access_token: encryptGoogleToken(next) }).eq('telegram_id', actor.legacyTelegramId)
    creds.access = next
    response = await fetch(url, { headers:{Authorization:`Bearer ${next}`}, cache:'no-store' })
  }
  return response.ok ? response : null
}

function decode64(v:string) { return Buffer.from(String(v||'').replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8') }
function header(headers:any[], name:string) { return safe((headers||[]).find((h:any)=>String(h?.name||'').toLowerCase()===name.toLowerCase())?.value,300) }
function flatten(part:any,out:any[]=[]){ if(!part)return out;out.push(part);for(const c of Array.isArray(part?.parts)?part.parts:[])flatten(c,out);return out }
function textPart(part:any){ const mime=String(part?.mimeType||'').toLowerCase();const data=String(part?.body?.data||'');if(!data||!/^text\/(plain|html)/.test(mime))return'';return decode64(data).replace(/<[^>]+>/g,' ') }

async function findAppointmentEmail(actor:AgentActor, selection:any) {
  const creds = await gmailToken(actor)
  if (!creds) return { connected:false, evidence:null as any, timezone:'Asia/Kolkata' }
  const provider = safe(selection?.provider || selection?.title,120)
  const city = safe(selection?.location,100)
  const queries = [
    [provider, city, 'appointment confirmation', 'newer_than:30d'].filter(Boolean).join(' '),
    [provider, 'appointment confirmed', 'newer_than:30d'].filter(Boolean).join(' '),
    [provider, city, 'booking confirmation', 'newer_than:30d'].filter(Boolean).join(' '),
  ]
  const ids:string[]=[]
  for (const q of queries) {
    const r = await gmailFetch(actor, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({q,maxResults:'10'})}`, creds)
    if (!r) continue
    const j:any = await r.json().catch(()=>({}))
    for (const m of Array.isArray(j?.messages)?j.messages:[]) { const id=String(m?.id||''); if(id&&!ids.includes(id))ids.push(id) }
  }
  let best:any=null
  for (const id of ids.slice(0,15)) {
    const r = await gmailFetch(actor, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`, creds)
    if (!r) continue
    const msg:any = await r.json().catch(()=>({}))
    const subject=header(msg?.payload?.headers||[],'Subject')
    const from=header(msg?.payload?.headers||[],'From')
    const body=safe(flatten(msg?.payload).map(textPart).filter(Boolean).join('\n'),14000)
    const hay=`${subject} ${from} ${body}`.toLowerCase()
    let score=0
    if(provider&&hay.includes(provider.toLowerCase()))score+=4
    if(city&&hay.includes(city.toLowerCase()))score+=2
    if(/appointment|consultation/.test(hay))score+=3
    if(/confirmed|confirmation|booked|scheduled/.test(hay))score+=5
    if(/cancelled|canceled/.test(hay))score-=8
    if(!best||score>best.score)best={score,messageId:id,threadId:String(msg?.threadId||''),subject,from,body}
  }
  return { connected:true, evidence:best&&best.score>=7?best:null, timezone:creds.timezone }
}

function parseJsonLoose(text:string){const s=String(text||'').replace(/```json|```/g,'').trim();try{return JSON.parse(s)}catch{}const m=s.match(/\{[\s\S]*\}/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}

async function extractConfirmation(evidence:any, selection:any, timezone:string) {
  const prompt = `Extract a confirmed healthcare appointment from this email. Return JSON only. Never invent values. The selected provider and city are locked and the email must agree with them. status is confirmed only when the email clearly says the appointment is booked/confirmed/scheduled. Convert an unambiguous date/time to ISO 8601 using ${timezone}. JSON:{"status":"confirmed|unknown","provider":null,"city":null,"clinic":null,"startAt":null,"confirmationRef":null,"doctor":null,"service":null}. Locked provider:${safe(selection?.provider||selection?.title,180)}. Locked city:${safe(selection?.location,120)}. Subject:${safe(evidence?.subject,400)}. From:${safe(evidence?.from,400)}. Body:${safe(evidence?.body,10000)}`
  try {
    const r=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:500,temperature:0,messages:[{role:'user',content:prompt}]})
    const raw=r.content[0]?.type==='text'?parseJsonLoose(r.content[0].text):null
    return {
      status:raw?.status==='confirmed'?'confirmed':'unknown', provider:safe(raw?.provider,180)||null,
      city:safe(raw?.city,120)||null, clinic:safe(raw?.clinic,220)||null,
      startAt:raw?.startAt&&Number.isFinite(Date.parse(raw.startAt))?String(raw.startAt):null,
      confirmationRef:safe(raw?.confirmationRef,160)||null, doctor:safe(raw?.doctor,180)||null,
      service:safe(raw?.service,180)||null,
    }
  } catch { return {status:'unknown',provider:null,city:null,clinic:null,startAt:null,confirmationRef:null,doctor:null,service:null} }
}

function sameLockedContext(extracted:any, selection:any) {
  const wantedProvider=safe(selection?.provider||selection?.title,180).toLowerCase()
  const wantedCity=safe(selection?.location,120).toLowerCase()
  const provider=safe(extracted?.provider,180).toLowerCase()
  const city=safe(extracted?.city,120).toLowerCase()
  const providerOk=!provider||!wantedProvider||provider.includes(wantedProvider)||wantedProvider.includes(provider)
  const cityAliases=wantedCity==='bengaluru'?['bengaluru','bangalore']:wantedCity==='bangalore'?['bengaluru','bangalore']:[wantedCity]
  const cityOk=!city||cityAliases.some((x)=>city.includes(x))
  return providerOk&&cityOk
}

export async function tryResumeAppointmentAfterHumanAuth(params:{actor:AgentActor;surface:AgentSurface;text:string}) {
  const intent=appointmentAuthResumeIntent(params.text)
  if(!intent)return null
  const run=await latestHandoff(params.actor.legacyTelegramId)
  if(!run) return {runId:'',status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:'I do not have a recent provider + city locked appointment handoff to resume. Start from the appointment provider search so I do not attach this to the wrong booking.',handledBy:'appointment-auth-resume' as const}
  const meta:any=run.metadata_json||{}, selection:any=meta.appointment_selection||{}
  const provider=safe(selection.provider||selection.title,180)||'the selected provider'
  const city=safe(selection.location,120)||'the selected city'
  const url=safe(selection.url||selection.originalUrl,1200)

  if(intent==='auth_done'){
    await saveResumeState(params.actor.legacyTelegramId,run,{state:'waiting_provider_confirmation',authCompletedExternallyAt:new Date().toISOString(),provider,city,option:selection.option||null,handoffUrl:url})
    return {runId:String(run.id),status:'paused' as const,capability:'browser' as const,risk:'low' as const,text:`I kept option ${selection.option||''} — ${provider} — locked to ${city}. I will not ask for or store your OTP/password. Complete the provider's confirmation on the provider page${url?`:\n${url}`:''}. Once the provider says the appointment is booked, reply *APPOINTMENT BOOKED* and I will verify the provider confirmation before creating the Life Event.`,handledBy:'appointment-auth-resume' as const}
  }

  await saveResumeState(params.actor.legacyTelegramId,run,{state:'checking_provider_confirmation',provider,city,option:selection.option||null,handoffUrl:url})
  const gmail=await findAppointmentEmail(params.actor,selection)
  if(!gmail.connected){
    await saveResumeState(params.actor.legacyTelegramId,run,{state:'waiting_confirmation_evidence',lastCheckAt:new Date().toISOString(),confirmationSource:'gmail_not_connected'})
    return {runId:String(run.id),status:'paused' as const,capability:'email' as const,risk:'low' as const,text:`I still have ${provider} in ${city} locked. Gmail is not connected, so I cannot independently verify the provider confirmation yet. Do not send an OTP/password. Send the provider confirmation screenshot/email to AskGogo, or connect Gmail and reply *CHECK APPOINTMENT CONFIRMATION*.`,handledBy:'appointment-auth-resume' as const}
  }
  if(!gmail.evidence){
    await saveResumeState(params.actor.legacyTelegramId,run,{state:'waiting_provider_confirmation',lastCheckAt:new Date().toISOString(),confirmationSource:'gmail',confirmationFound:false})
    return {runId:String(run.id),status:'paused' as const,capability:'email' as const,risk:'low' as const,text:`I kept ${provider} + ${city} locked, but I cannot yet verify a matching provider confirmation in connected Gmail. I have not created a calendar event, reminder or Life Event from an unverified booking. When the confirmation arrives, reply *CHECK APPOINTMENT CONFIRMATION*.`,handledBy:'appointment-auth-resume' as const}
  }

  const extracted=await extractConfirmation(gmail.evidence,selection,gmail.timezone)
  if(extracted.status!=='confirmed'||!sameLockedContext(extracted,selection)){
    await saveResumeState(params.actor.legacyTelegramId,run,{state:'waiting_provider_confirmation',lastCheckAt:new Date().toISOString(),confirmationSource:'gmail',confirmationFound:true,confirmationVerified:false})
    return {runId:String(run.id),status:'paused' as const,capability:'email' as const,risk:'low' as const,text:`I found appointment-related email, but it does not safely verify the locked ${provider} + ${city} booking yet. I did not create downstream actions from ambiguous evidence.`,handledBy:'appointment-auth-resume' as const}
  }

  const title=[extracted.service||selection.service||'Appointment',extracted.doctor?`with ${extracted.doctor}`:''].filter(Boolean).join(' ')
  const event=await registerLifeEvent({telegramId:params.actor.legacyTelegramId,eventType:'appointment',subtype:'provider_confirmed_appointment',source:'gmail_provider_confirmation',title,provider:provider,startAt:extracted.startAt,timezone:gmail.timezone,location:extracted.clinic||city,confirmationRef:extracted.confirmationRef,metadata:{providerConfirmationVerified:true,providerLocked:true,locationLocked:true,appointmentOption:selection.option||null,sourceRunId:String(run.id),gmailMessageId:gmail.evidence.messageId,handoffUrl:url},sourceRefs:[{source:'gmail',kind:'appointment_confirmation',gmailMessageId:gmail.evidence.messageId},{source:'provider',kind:'appointment_handoff',url}]})
  await saveResumeState(params.actor.legacyTelegramId,run,{state:'confirmed',confirmedAt:new Date().toISOString(),confirmationSource:'gmail',confirmationFound:true,confirmationVerified:true,lifeEventId:event.id,gmailMessageId:gmail.evidence.messageId})
  const when=extracted.startAt?`\n*When:* ${extracted.startAt}`:''
  return {runId:String(run.id),status:'completed' as const,capability:'email' as const,risk:'low' as const,text:`✅ Provider confirmation verified.\n\n*Provider:* ${provider}\n*City:* ${city}${when}${extracted.confirmationRef?`\n*Confirmation:* ${extracted.confirmationRef}`:''}\n\nI created the appointment Life Event only after verifying the provider email. Any consequential calendar/provider mutation remains behind the normal approval boundary.`,handledBy:'appointment-auth-resume' as const,lifeEventId:event.id,providerConfirmationVerified:true}
}
