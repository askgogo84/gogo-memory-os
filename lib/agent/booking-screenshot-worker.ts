import OpenAI from 'openai'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDocumentSignedUrl } from '@/lib/services/document-store'
import { prepareBookingCalendarApproval } from './booking-calendar-execution'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import type { AgentActor } from './actor'

const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY})
const MAX_ACTIONS=6
const MAX_DOCUMENTS=8
const MAX_SCANNED_IDS=80

function safe(v:unknown,max=600){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function parseJson(text:string){const s=String(text||'').replace(/```json|```/g,'').trim();try{return JSON.parse(s)}catch{const m=s.match(/\{[\s\S]*\}/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}}
function validIso(v:unknown){const s=String(v||'').trim();if(!s||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(s))return null;return Number.isFinite(Date.parse(s))?s:null}
function isPlaceholderTitle(v:unknown){return /^(?:event booking|booking|event|movie booking|unknown booking)$/i.test(safe(v,120))}
function titleOverlap(a:string,b:string){const stop=new Set(['the','movie','a','an','and','part','film']);const terms=(s:string)=>s.toLowerCase().replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(x=>x.length>2&&!stop.has(x));const aa=terms(a),bb=new Set(terms(b));return aa.some(x=>bb.has(x))}
function likelyTicketDocument(doc:any,expectedTitle:string){const hay=`${doc?.title||''} ${doc?.summary||''} ${JSON.stringify(doc?.extracted||{})}`.toLowerCase();if(/bookmyshow|booking id|ticket\(s\)|\bticket\b|\baud[i]?\b|qr-|barcode|seat|showtime|cinema|movie/.test(hay))return true;return !isPlaceholderTitle(expectedTitle)&&titleOverlap(hay,expectedTitle)}

async function actorFor(telegramId:number):Promise<{actor:AgentActor;timezone:string}> {const{data,error}=await supabaseAdmin.from('users').select('id,telegram_id,whatsapp_id,name,timezone').eq('telegram_id',telegramId).maybeSingle();if(error||!data?.id)throw new Error('booking_screenshot_actor_missing');return{actor:{userId:String(data.id),legacyTelegramId:Number(data.telegram_id),whatsappId:String(data.whatsapp_id||''),name:String(data.name||'Gogo')},timezone:String(data.timezone||'Asia/Kolkata')}}

async function imageDataUrl(storagePath:string,mime:string){const signed=await getDocumentSignedUrl(storagePath,300);if(!signed)return null;const res=await fetch(signed,{cache:'no-store'});if(!res.ok)return null;const buf=Buffer.from(await res.arrayBuffer());if(!buf.length||buf.length>18*1024*1024)return null;const type=/png/i.test(mime)?'image/png':/webp/i.test(mime)?'image/webp':'image/jpeg';return`data:${type};base64,${buf.toString('base64')}`}

async function extractTicket(params:{dataUrl:string;expectedTitle:string;timezone:string}){
  if(!process.env.OPENAI_API_KEY)return null
  const now=new Date().toISOString(),placeholder=isPlaceholderTitle(params.expectedTitle)
  const response=await openai.chat.completions.create({model:'gpt-4o',temperature:0,max_tokens:700,response_format:{type:'json_object'},messages:[{role:'system',content:'You are AskGogo verifying a user-provided screenshot of an existing event/movie ticket. Extract only details clearly visible in the screenshot. Never invent seats, booking IDs, venue, date, time, amount or ticket count. isMatch=true only when this is clearly a BookMyShow booking/ticket and the screenshot shows ticket/booking evidence such as a QR/barcode, booking ID, seats, show time, or venue. When an expected event title is supplied, require an unmistakable title match; when it is explicitly marked unknown, do not require title overlap.'},{role:'user',content:[{type:'text',text:`Expected event: ${placeholder?'UNKNOWN — identify from the ticket screenshot':params.expectedTitle}\nProvider: BookMyShow\nUser timezone: ${params.timezone}\nCurrent timestamp: ${now}\nIf the screenshot omits the year but shows an unambiguous day/month/show time, infer the nearest matching year relative to the current timestamp only when consistent; otherwise startAt must be null. If startAt is returned it MUST include Z or an explicit UTC offset such as +05:30; never return an offset-free timestamp. Return JSON exactly with: {"isMatch":false,"title":null,"startAt":null,"location":null,"city":null,"screen":null,"seats":[],"bookingRef":null,"ticketCount":null,"totalAmount":null,"qrVisible":false}.`},{type:'image_url',image_url:{url:params.dataUrl,detail:'high'}}]}]})
  const raw=parseJson(response.choices?.[0]?.message?.content||'');if(!raw?.isMatch)return null
  const title=safe(raw.title||params.expectedTitle,200)||params.expectedTitle
  if(!placeholder&&!titleOverlap(title,params.expectedTitle)&&title.toLowerCase()!==params.expectedTitle.toLowerCase())return null
  const seats=Array.isArray(raw.seats)?raw.seats.map((x:any)=>safe(x,50)).filter(Boolean).slice(0,12):[]
  const bookingRef=raw.bookingRef?safe(raw.bookingRef,120):null
  const qrVisible=Boolean(raw.qrVisible)
  if(!bookingRef&&!qrVisible&&!seats.length)return null
  return{title,startAt:validIso(raw.startAt),location:raw.location?safe(raw.location,300):null,city:raw.city?safe(raw.city,120):null,screen:raw.screen?safe(raw.screen,120):null,seats,bookingRef,ticketCount:Number.isFinite(Number(raw.ticketCount))?Math.max(1,Math.min(20,Number(raw.ticketCount))):null,totalAmount:raw.totalAmount?safe(raw.totalAmount,80):null,qrVisible}
}

async function ensureReminder(telegramId:number,details:any,timezone:string){if(!details.startAt)return false;const at=new Date(details.startAt).getTime()-2*3600_000;if(!Number.isFinite(at)||at<=Date.now())return false;const remindAt=new Date(at).toISOString(),message=`${details.title} starts in 2 hours${details.location?` at ${details.location}`:''}. Your ticket/QR is saved in AskGogo.`;const{data}=await supabaseAdmin.from('reminders').select('id').eq('telegram_id',telegramId).eq('message',message).eq('remind_at',remindAt).limit(1);if(data?.length)return true;const{error}=await supabaseAdmin.from('reminders').insert({telegram_id:telegramId,chat_id:telegramId,message,remind_at:remindAt,sent:false,timezone});return!error}

function formatWhen(iso:string|null,timezone:string){if(!iso)return'';try{return new Intl.DateTimeFormat('en-IN',{timeZone:timezone,weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso))}catch{return iso}}
async function persistScanned(row:any,payload:any,ids:string[]){if(!ids.length)return;const previous=Array.isArray(payload.scannedScreenshotDocumentIds)?payload.scannedScreenshotDocumentIds.map(String):[],next=[...new Set([...previous,...ids])].slice(-MAX_SCANNED_IDS);const{error}=await supabaseAdmin.from('life_event_actions').update({payload_json:{...payload,scannedScreenshotDocumentIds:next,lastScreenshotScanAt:new Date().toISOString()},updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','blocked');if(error)throw new Error(`booking_screenshot_scan_persist_failed:${error.message}`)}

export async function processPendingBookingScreenshots(limit=MAX_ACTIONS){
  const{data:rows,error}=await supabaseAdmin.from('life_event_actions').select('id,life_event_id,telegram_id,status,payload_json,updated_at').eq('action_key','booking-closure').eq('status','blocked').contains('payload_json',{deviceHandoffRequired:true,providerBlock:'cloudflare'}).order('updated_at',{ascending:false}).limit(limit);if(error)throw new Error(`booking_screenshot_actions_failed:${error.message}`)
  let checked=0,completed=0,waiting=0,failed=0
  for(const row of (rows||[]) as any[]){checked++
    try{
      const tg=Number(row.telegram_id),payload:any=row.payload_json||{},lifeEventId=String(payload?.lastResolution?.lifeEventId||row.life_event_id||'');if(!tg||!lifeEventId){waiting++;continue}
      const{data:event,error:eventError}=await supabaseAdmin.from('life_events').select('id,title,provider,start_at,end_at,timezone,location,metadata_json,source_refs').eq('id',lifeEventId).eq('telegram_id',String(tg)).maybeSingle();if(eventError||!event){waiting++;continue}
      const requestedAt=Date.parse(String(payload.screenshotRequestedAt||row.updated_at||'')),floor=Number.isFinite(requestedAt)?new Date(requestedAt-10*60_000).toISOString():new Date(Date.now()-6*3600_000).toISOString()
      const scanned=new Set((Array.isArray(payload.scannedScreenshotDocumentIds)?payload.scannedScreenshotDocumentIds:[]).map(String))
      const{data:docs,error:docError}=await supabaseAdmin.from('documents').select('id,title,summary,storage_path,mime,source_message_id,created_at,extracted').eq('telegram_id',tg).not('storage_path','is',null).gte('created_at',floor).order('created_at',{ascending:false}).limit(MAX_DOCUMENTS);if(docError)throw new Error(`booking_screenshot_docs_failed:${docError.message}`)
      let matched:any=null,details:any=null;const scannedNow:string[]=[]
      const timezone=String(event.timezone||'Asia/Kolkata'),expectedTitle=String(event.title||payload?.lastResolution?.title||'Event booking')
      for(const doc of docs||[]){const id=String(doc.id||'');if(!id||scanned.has(id))continue;scannedNow.push(id);if(!String(doc.mime||'').startsWith('image/')||!likelyTicketDocument(doc,expectedTitle))continue;const dataUrl=await imageDataUrl(String(doc.storage_path||''),String(doc.mime||''));if(!dataUrl)continue;const extracted=await extractTicket({dataUrl,expectedTitle,timezone}).catch(()=>null);if(extracted){matched=doc;details=extracted;break}}
      if(!matched||!details){await persistScanned(row,payload,scannedNow);waiting++;continue}
      const previous:any=event.metadata_json||{},effectiveStartAt=details.startAt||event.start_at||previous?.bookingDetails?.startAt||null,effectiveLocation=details.location||event.location||previous?.bookingDetails?.location||null
      const bookingDetails={title:details.title,provider:'BookMyShow',startAt:effectiveStartAt,endAt:event.end_at||previous?.bookingDetails?.endAt||null,timezone,location:effectiveLocation,city:details.city||previous?.bookingDetails?.city||null,screen:details.screen||previous?.bookingDetails?.screen||null,seats:details.seats?.length?details.seats:(previous?.bookingDetails?.seats||[]),bookingRef:details.bookingRef||previous?.bookingDetails?.bookingRef||null,durationMinutes:previous?.bookingDetails?.durationMinutes||null,status:'confirmed'}
      const now=new Date().toISOString(),credential={documentId:String(matched.id),storagePath:String(matched.storage_path),mimeType:String(matched.mime||'image/jpeg'),providerIssued:true,source:'user_ticket_screenshot'},metadata={...previous,bookingDetails,credential,schedulePending:!effectiveStartAt,humanAuthRequired:false,attentionRequired:false,deviceHandoffRequired:false,screenshotEvidence:{documentId:String(matched.id),sourceMessageId:matched.source_message_id||null,capturedAt:now,qrVisible:details.qrVisible,ticketCount:details.ticketCount,totalAmount:details.totalAmount}}
      const refs=Array.isArray(event.source_refs)?event.source_refs:[];if(!refs.some((x:any)=>String(x?.documentId||'')===String(matched.id)))refs.push({source:'whatsapp',kind:'ticket_screenshot',documentId:String(matched.id),messageId:matched.source_message_id||null})
      const{error:updateError}=await supabaseAdmin.from('life_events').update({title:details.title,provider:'BookMyShow',start_at:effectiveStartAt,timezone,location:effectiveLocation,confirmation_ref:bookingDetails.bookingRef,lifecycle_state:'watching',metadata_json:metadata,source_refs:refs,updated_at:now}).eq('id',lifeEventId).eq('telegram_id',String(tg));if(updateError)throw new Error(`booking_screenshot_event_update_failed:${updateError.message}`)
      const reminderSet=await ensureReminder(tg,bookingDetails,timezone).catch(()=>false),{actor}=await actorFor(tg)
      let calendar:Awaited<ReturnType<typeof prepareBookingCalendarApproval>>=null
      if(effectiveStartAt){const endAt=bookingDetails.endAt||new Date(new Date(effectiveStartAt).getTime()+3*3600_000).toISOString();calendar=await prepareBookingCalendarApproval({actor,input:{lifeEventId,title:details.title,startAt:effectiveStartAt,endAt,timezone,location:effectiveLocation,provider:'BookMyShow',sourceUrl:String(previous.resolvedUrl||previous.bookingUrl||payload.bookingUrl||''),endEstimated:!bookingDetails.endAt}}).catch(()=>null)}
      await supabaseAdmin.from('life_event_actions').update({status:'completed',due_at:null,updated_at:now,payload_json:{...payload,deviceHandoffRequired:false,lastError:null,retryAt:null,screenshotCompletedAt:now,screenshotDocumentId:String(matched.id),scannedScreenshotDocumentIds:[...new Set([...(payload.scannedScreenshotDocumentIds||[]).map(String),...scannedNow])].slice(-MAX_SCANNED_IDS),closureLifeEventId:lifeEventId}}).eq('id',row.id).eq('status','blocked')
      const to=String(payload.whatsappTo||actor.whatsappId||'');if(to){const lines=[`🎟️ *${details.title}*`,'✅ *Ticket screenshot verified and saved*',effectiveStartAt?`*Show:* ${formatWhen(effectiveStartAt,timezone)}`:'',effectiveLocation?`*Venue:* ${effectiveLocation}`:'',bookingDetails.screen?`*Screen:* ${bookingDetails.screen}`:'',bookingDetails.seats?.length?`*Seats:* ${bookingDetails.seats.join(', ')}`:'',bookingDetails.bookingRef?`*Booking ID:* ${bookingDetails.bookingRef}`:'',details.ticketCount?`*Tickets:* ${details.ticketCount}`:'',details.totalAmount?`*Amount:* ${details.totalAmount}`:'',reminderSet?'✅ *2-hour reminder set*':'',calendar?'📅 *Calendar block ready for approval* — reply *APPROVE* to add it.':'','Your ticket/QR is now attached to this saved booking.'].filter(Boolean);await sendWhatsAppMessage(to,lines.join('\n')).catch(()=>{})}
      completed++
    }catch(err:any){failed++;console.error('BOOKING_SCREENSHOT_WORKER_FAILED:',err?.message||err)}
  }
  return{checked,completed,waiting,failed}
}
