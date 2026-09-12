import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { registerLifeEvent } from './life-event-engine'
import { readProviderTicketPage } from './secure-ticket-reader'
import { findGmailTicketEvidence } from './gmail-ticket-credential'
import { prepareBookingCalendarApproval } from './booking-calendar-execution'
import { getDocumentSignedUrl } from '@/lib/services/document-store'
import type { AgentActor } from './actor'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const BUCKET = 'user-documents'
const TRUSTED_PROVIDER_HOSTS = ['bmsurl.co','bookmyshow.com','district.in','insider.in','ticketmaster.com']

export type BookingDetails = {
  title: string; provider: string; startAt: string | null; endAt: string | null; timezone: string
  location: string | null; city: string | null; screen: string | null; seats: string[]
  bookingRef: string | null; durationMinutes: number | null
  status: 'confirmed'|'unknown'|'cancelled'|'rescheduled'
}
export type BookingClosureResult = {
  text: string; lifeEventId?: string; credentialUrl?: string; credentialMimeType?: string
  approvalId?: string; runId?: string; needsUserAuth?: boolean; details?: BookingDetails
}

function safe(v: unknown, max = 1000) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function firstUrl(text: string) { const m = String(text || '').match(/https?:\/\/[^\s<>]+/i); return m ? m[0].replace(/[),.;!?]+$/, '') : '' }
function host(value: string) { try { return new URL(value).hostname.toLowerCase().replace(/^www\./,'') } catch { return '' } }
function trustedProviderUrl(value: string) {
  try {
    const u = new URL(value); if (!['http:','https:'].includes(u.protocol)) return false
    const h = host(value); return TRUSTED_PROVIDER_HOSTS.some(x => h === x || h.endsWith(`.${x}`))
  } catch { return false }
}
function providerFrom(text: string, url: string) {
  const h = `${text} ${url}`.toLowerCase()
  if (/bookmyshow|bmsurl\.co/.test(h)) return 'BookMyShow'
  if (/district\.in/.test(h)) return 'District'
  if (/insider\.in/.test(h)) return 'Insider'
  if (/ticketmaster/.test(h)) return 'Ticketmaster'
  return 'Booking provider'
}
function titleFrom(text: string) {
  const raw = String(text || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  const watching = raw.match(/we(?:'|’)re\s+watching\s+(.+?)(?=\.\s*(?:find|here|ticket)|\s+find\s+ticket|$)/i)
  if (watching?.[1]) return watching[1].trim().slice(0, 180)
  const t = raw.match(/(?:booking details|event|movie|concert)\s*[-–:]\s*(.+?)(?=\.|$)/i)
  return t?.[1]?.trim().slice(0, 180) || 'Event booking'
}
function htmlText(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim().slice(0,18000)
}

async function fetchBookingPage(initialUrl: string) {
  if (!trustedProviderUrl(initialUrl)) return { url: initialUrl, title: '', text: '' }
  let current = initialUrl
  for (let i=0;i<5;i++) {
    if (!trustedProviderUrl(current)) return { url: current, title: '', text: '' }
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 10000)
    try {
      const res = await fetch(current, { redirect:'manual', signal:ctrl.signal, cache:'no-store', headers:{'User-Agent':'Mozilla/5.0 AskGogo/1.0',Accept:'text/html,application/xhtml+xml'} })
      if ([301,302,303,307,308].includes(res.status)) {
        const loc = res.headers.get('location'); if (!loc) break
        const next = new URL(loc, current).toString(); if (!trustedProviderUrl(next)) return { url: next, title:'', text:'' }
        current = next; continue
      }
      if (!res.ok) return { url: current, title:'', text:'' }
      const html = (await res.text()).slice(0,300000)
      return { url: res.url || current, title:safe(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'',300), text:htmlText(html) }
    } catch { return { url: current, title:'', text:'' } }
    finally { clearTimeout(timer) }
  }
  return { url: current, title:'', text:'' }
}

function parseJsonLoose(text: string) { const s=String(text||'').replace(/```json|```/g,'').trim(); try{return JSON.parse(s)}catch{} const m=s.match(/\{[\s\S]*\}/); if(!m)return null; try{return JSON.parse(m[0])}catch{return null} }
async function extractDetails(input:{originalText:string;provider:string;pageTitle:string;pageText:string;gmailText:string;timezone:string}):Promise<BookingDetails>{
  const prompt=`Extract one existing event/movie/concert booking from the evidence. Return JSON only. Never invent date/time/venue/seat/reference/status. status=confirmed only when evidence clearly represents an existing confirmed booking/ticket; cancelled when explicitly cancelled; rescheduled when explicitly changed; otherwise unknown. Convert an unambiguous local date/time to ISO 8601 using ${input.timezone}. Only calculate endAt when duration/end is evidenced.\nJSON:{"title":"","provider":"","startAt":null,"endAt":null,"timezone":"${input.timezone}","location":null,"city":null,"screen":null,"seats":[],"bookingRef":null,"durationMinutes":null,"status":"confirmed|unknown|cancelled|rescheduled"}\nForward:${input.originalText.slice(0,2500)}\nProvider:${input.provider}\nPage title:${input.pageTitle}\nProvider page:${input.pageText.slice(0,9000)}\nEmail:${input.gmailText.slice(0,9000)}`
  try{
    const r=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:900,temperature:0,messages:[{role:'user',content:prompt}]})
    const raw=r.content[0]?.type==='text'?parseJsonLoose(r.content[0].text):null
    const start=raw?.startAt&&Number.isFinite(Date.parse(raw.startAt))?String(raw.startAt):null
    const end=raw?.endAt&&Number.isFinite(Date.parse(raw.endAt))?String(raw.endAt):null
    return {title:safe(raw?.title||titleFrom(input.originalText),200)||'Event booking',provider:safe(raw?.provider||input.provider,120)||input.provider,startAt:start,endAt:end,timezone:safe(raw?.timezone||input.timezone,80)||input.timezone,location:raw?.location?safe(raw.location,300):null,city:raw?.city?safe(raw.city,120):null,screen:raw?.screen?safe(raw.screen,120):null,seats:Array.isArray(raw?.seats)?raw.seats.map((x:any)=>safe(x,50)).filter(Boolean).slice(0,12):[],bookingRef:raw?.bookingRef?safe(raw.bookingRef,120):null,durationMinutes:Number.isFinite(Number(raw?.durationMinutes))?Math.max(1,Math.min(600,Number(raw.durationMinutes))):null,status:['confirmed','unknown','cancelled','rescheduled'].includes(raw?.status)?raw.status:'unknown'}
  }catch{return {title:titleFrom(input.originalText),provider:input.provider,startAt:null,endAt:null,timezone:input.timezone,location:null,city:null,screen:null,seats:[],bookingRef:null,durationMinutes:null,status:'unknown'}}
}

function ext(mime:string){if(/pdf/i.test(mime))return'pdf';if(/png/i.test(mime))return'png';if(/jpe?g/i.test(mime))return'jpg';if(/webp/i.test(mime))return'webp';return'bin'}
async function storeCredential(params:{telegramId:number;bytes:Buffer;mimeType:string;title:string;source:string;sourceId?:string|null}){
  if(!params.bytes.length||params.bytes.length>10*1024*1024)return null
  const path=`${params.telegramId}/event-tickets/${randomUUID()}.${ext(params.mimeType)}`
  const {error:uploadError}=await supabaseAdmin.storage.from(BUCKET).upload(path,params.bytes,{contentType:params.mimeType,upsert:false});if(uploadError)throw new Error(`booking_credential_upload_failed:${uploadError.message}`)
  const {data,error}=await supabaseAdmin.from('documents').insert({telegram_id:params.telegramId,doc_type:'event_ticket',title:params.title.slice(0,300),summary:`Provider-issued event entry credential captured from ${params.source}.`,storage_path:path,mime:params.mimeType,size_bytes:params.bytes.length,extracted:{source:params.source,source_id:params.sourceId||null,providerIssued:true}}).select('id').single();if(error)throw new Error(`booking_credential_document_failed:${error.message}`)
  return{documentId:String(data.id),storagePath:path,mimeType:params.mimeType}
}
async function actorFor(telegramId:number):Promise<{actor:AgentActor;timezone:string}>{const{data,error}=await supabaseAdmin.from('users').select('id,telegram_id,whatsapp_id,name,timezone').eq('telegram_id',telegramId).maybeSingle();if(error||!data?.id)throw new Error('booking_actor_missing');return{actor:{userId:String(data.id),legacyTelegramId:Number(data.telegram_id),whatsappId:String(data.whatsapp_id||''),name:String(data.name||'Gogo')},timezone:String(data.timezone||'Asia/Kolkata')}}
async function existingByUrl(telegramId:number,urls:string[]){const{data}=await supabaseAdmin.from('life_events').select('id,metadata_json,source_refs').eq('telegram_id',String(telegramId)).eq('event_type','event').order('updated_at',{ascending:false}).limit(40);return(data||[]).find((row:any)=>{const meta=row.metadata_json||{},refs=Array.isArray(row.source_refs)?row.source_refs:[];const known=[meta.bookingUrl,meta.resolvedUrl,...refs.map((r:any)=>r?.url)].filter(Boolean).map(String);return urls.some(u=>u&&known.includes(u))})||null}
async function ensureReminder(telegramId:number,details:BookingDetails){if(!details.startAt)return false;const at=new Date(details.startAt).getTime()-2*3600_000;if(!Number.isFinite(at)||at<=Date.now())return false;const remindAt=new Date(at).toISOString(),message=`${details.title} starts in 2 hours${details.location?` at ${details.location}`:''}. Your ticket/QR is saved in AskGogo.`;const{data}=await supabaseAdmin.from('reminders').select('id').eq('telegram_id',telegramId).eq('message',message).eq('remind_at',remindAt).limit(1);if(data?.length)return true;const{error}=await supabaseAdmin.from('reminders').insert({telegram_id:telegramId,chat_id:telegramId,message,remind_at:remindAt,sent:false,timezone:details.timezone});return!error}
function detailLines(d:BookingDetails){const out=[`🎟️ *${d.title}*`,`*Provider:* ${d.provider}`];if(d.startAt)out.push(`*Starts:* ${d.startAt}`);if(d.endAt)out.push(`*Ends:* ${d.endAt}`);if(d.location)out.push(`*Venue:* ${d.location}`);if(d.screen)out.push(`*Screen:* ${d.screen}`);if(d.seats.length)out.push(`*Seats:* ${d.seats.join(', ')}`);if(d.bookingRef)out.push(`*Booking ref:* ${d.bookingRef}`);return out}

export async function closeBookingLink(params:{telegramId:number;text:string}):Promise<BookingClosureResult|null>{
  const originalUrl=firstUrl(params.text);if(!originalUrl)return null
  const provider=providerFrom(params.text,originalUrl),titleHint=titleFrom(params.text),{actor,timezone}=await actorFor(params.telegramId)
  const staticPage=await fetchBookingPage(originalUrl)
  const gmailPromise=findGmailTicketEvidence(actor,`${provider} ${titleHint} booking ticket QR`)
  const browser=await readProviderTicketPage({userId:actor.userId,url:staticPage.url||originalUrl})
  const gmail=await gmailPromise.catch(()=>null)
  const pageText=[staticPage.text,browser.status==='completed'?browser.pageText:'',browser.shareData?.text||''].filter(Boolean).join('\n')
  const details=await extractDetails({originalText:params.text,provider,pageTitle:browser.title||staticPage.title,pageText,gmailText:gmail?.bodyText||'',timezone})
  const resolvedUrl=browser.url||staticPage.url||originalUrl
  const existing=await existingByUrl(params.telegramId,[originalUrl,resolvedUrl])
  const previousCredential=(existing?.metadata_json as any)?.credential||null
  let credential: {documentId:string;storagePath:string;mimeType:string}|null=previousCredential?.storagePath?{documentId:String(previousCredential.documentId||''),storagePath:String(previousCredential.storagePath),mimeType:String(previousCredential.mimeType||'image/png')}:null
  if(!credential&&gmail?.credential?.bytes?.length)credential=await storeCredential({telegramId:params.telegramId,bytes:gmail.credential.bytes,mimeType:gmail.credential.mimeType,title:`${details.title} ticket`,source:'gmail',sourceId:gmail.messageId}).catch(()=>null)
  if(!credential&&browser.credential?.dataBase64)credential=await storeCredential({telegramId:params.telegramId,bytes:Buffer.from(browser.credential.dataBase64,'base64'),mimeType:browser.credential.mimeType,title:`${details.title} ticket QR`,source:'provider_page',sourceId:browser.url}).catch(()=>null)

  const actionable=details.status==='confirmed'||details.status==='rescheduled'
  const lifecycleState=details.status==='cancelled'?'cancelled':actionable?(browser.status==='blocked'?'waiting_approval':'watching'):'captured'
  const metadata={...(existing?.metadata_json||{}),bookingUrl:originalUrl,resolvedUrl,schedulePending:!details.startAt,bookingDetails:details,providerShare:browser.shareData||null,credential:credential?{documentId:credential.documentId,storagePath:credential.storagePath,mimeType:credential.mimeType,providerIssued:true,source:gmail?.credential?'gmail':'provider_page'}:previousCredential,gmail:gmail?{messageId:gmail.messageId,threadId:gmail.threadId,subject:gmail.subject}:(existing?.metadata_json as any)?.gmail||null,humanAuthRequired:browser.status==='blocked',attentionRequired:browser.status==='blocked'||details.status==='unknown'}
  let lifeEventId=existing?.id?String(existing.id):''
  if(existing?.id){const{error}=await supabaseAdmin.from('life_events').update({subtype:/movie|watching|cinema|theatre/i.test(params.text)?'movie_booking':'event_booking',title:details.title,provider:details.provider,start_at:details.startAt,end_at:details.endAt,timezone:details.timezone,location:details.location,confirmation_ref:details.bookingRef,lifecycle_state:lifecycleState,metadata_json:metadata,source_refs:[{source:'whatsapp',kind:'booking_link',url:originalUrl},{source:'provider',kind:'resolved_booking',url:resolvedUrl},...(gmail?[{source:'gmail',kind:'booking_confirmation',gmailMessageId:gmail.messageId}]:[])],updated_at:new Date().toISOString()}).eq('id',existing.id).eq('telegram_id',String(params.telegramId));if(error)throw new Error(`booking_life_event_update_failed:${error.message}`)}else{const reg=await registerLifeEvent({telegramId:params.telegramId,eventType:'event',subtype:/movie|watching|cinema|theatre/i.test(params.text)?'movie_booking':'event_booking',source:'whatsapp_booking_link',title:details.title,provider:details.provider,startAt:details.startAt,endAt:details.endAt,timezone:details.timezone,location:details.location,confirmationRef:details.bookingRef,metadata,sourceRefs:[{source:'whatsapp',kind:'booking_link',url:originalUrl},{source:'provider',kind:'resolved_booking',url:resolvedUrl},...(gmail?[{source:'gmail',kind:'booking_confirmation',gmailMessageId:gmail.messageId}]:[])]});lifeEventId=reg.id;await supabaseAdmin.from('life_events').update({lifecycle_state:lifecycleState,metadata_json:metadata,updated_at:new Date().toISOString()}).eq('id',lifeEventId).eq('telegram_id',String(params.telegramId))}

  let reminderSet=false,calendar:Awaited<ReturnType<typeof prepareBookingCalendarApproval>>=null
  if(actionable&&details.startAt){reminderSet=await ensureReminder(params.telegramId,details).catch(()=>false);let endAt=details.endAt,endEstimated=false;if(!endAt){endAt=new Date(new Date(details.startAt).getTime()+3*3600_000).toISOString();endEstimated=true}calendar=await prepareBookingCalendarApproval({actor,input:{lifeEventId,title:details.title,startAt:details.startAt,endAt,timezone:details.timezone,location:details.location,provider:details.provider,sourceUrl:resolvedUrl,endEstimated}}).catch(()=>null)}
  if(actionable){const watchAt=details.startAt?new Date(Math.max(Date.now()+60*60_000,new Date(details.startAt).getTime()-24*3600_000)).toISOString():new Date(Date.now()+6*3600_000).toISOString();await supabaseAdmin.from('life_event_actions').upsert({life_event_id:lifeEventId,telegram_id:String(params.telegramId),action_key:'booking-change-watch',action_type:'monitor',capability:'browser',title:'Watch booking source for time, venue or cancellation changes',due_at:watchAt,requires_approval:false,irreversible:false,payload_json:{bookingUrl:originalUrl,resolvedUrl,snapshot:details,notifyOnlyOnMaterialChange:true},updated_at:new Date().toISOString()},{onConflict:'life_event_id,action_key'}).catch(()=>{})}
  const signed=credential?await getDocumentSignedUrl(credential.storagePath,3600):null
  const lines=detailLines(details);lines.push('')
  if(details.status==='cancelled')lines.push('❌ *This booking is cancelled.* I did not create a reminder or calendar action.')
  else if(details.status==='unknown')lines.push('⚠️ I could not verify this as a confirmed booking yet, so I did not block your calendar or schedule a reminder. I kept the source for Background Gogo to retry.')
  else{lines.push(credential?'✅ *Ticket / QR captured and saved* — ask *show my movie ticket* anytime.':browser.status==='blocked'?'🔐 I reached a login/OTP/CAPTCHA boundary before I could capture the provider ticket. I saved the verified details and will resume after that one human step.':'⏳ The booking is confirmed, but the provider has not exposed a retrievable ticket/QR yet. I’ll keep checking the connected email/provider source.');if(reminderSet)lines.push('✅ *2-hour reminder set*');if(calendar)lines.push('📅 *Calendar block ready for approval* — reply *APPROVE* to add it.');lines.push('👀 *Change watch armed* for cancellation, time or venue changes.')}
  return{text:lines.join('\n'),lifeEventId,credentialUrl:signed||undefined,credentialMimeType:credential?.mimeType,approvalId:calendar?.approvalId,runId:calendar?.runId,needsUserAuth:browser.status==='blocked',details}
}

export function isEventCredentialRetrieval(text:string){return /\b(show|send|open|get|find)\b.*\b(movie|event|concert|theatre|theater)?\s*(ticket|qr|barcode|pass)\b/i.test(String(text||''))||/\b(show|send)\s+my\s+(ticket|qr|barcode|pass)\b/i.test(String(text||''))}
function queryTokens(text:string){return String(text||'').toLowerCase().replace(/\b(show|send|open|get|find|my|the|ticket|qr|barcode|pass|movie|event|concert|theatre|theater|please)\b/g,' ').split(/[^a-z0-9]+/).filter(x=>x.length>2)}
export async function retrieveEventCredential(telegramId:number,requestText:string){const{data}=await supabaseAdmin.from('life_events').select('id,title,subtype,start_at,location,provider,metadata_json').eq('telegram_id',String(telegramId)).eq('event_type','event').order('start_at',{ascending:true,nullsFirst:false}).limit(50);const rows=(data||[]).filter((x:any)=>x.metadata_json?.credential?.storagePath);if(!rows.length)return null;const tokens=queryTokens(requestText),wantsMovie=/\b(movie|cinema|theatre|theater)\b/i.test(requestText),now=Date.now();let candidates=rows.filter((x:any)=>!wantsMovie||x.subtype==='movie_booking');if(!candidates.length)candidates=rows;const scored=candidates.map((x:any)=>{const hay=`${x.title||''} ${x.provider||''}`.toLowerCase();const tokenScore=tokens.reduce((n,t)=>n+(hay.includes(t)?5:0),0);const future=x.start_at?new Date(x.start_at).getTime()>=now-12*3600_000:true;return{x,score:tokenScore+(future?2:0)}}).sort((a:any,b:any)=>b.score-a.score||((new Date(a.x.start_at||8640000000000000).getTime())-(new Date(b.x.start_at||8640000000000000).getTime())));const event:any=scored[0]?.x;if(!event)return null;const c=event.metadata_json.credential,url=await getDocumentSignedUrl(String(c.storagePath||''),600);if(!url)return null;const caption=[`🎟️ *${safe(event.title,180)}*`,event.start_at?`*Time:* ${event.start_at}`:'',event.location?`*Venue:* ${safe(event.location,240)}`:'','','Here is the provider-issued ticket/QR Gogo saved for you.'].filter(Boolean).join('\n');return{mediaUrl:url,mimeType:String(c.mimeType||'image/png'),caption,lifeEventId:String(event.id),title:safe(event.title,180)}}
