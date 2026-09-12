import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readProviderTicketPage } from './secure-ticket-reader'
import { sendAgentPush } from './push'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const LEASE_MINUTES = 10
const RECHECK_HOURS = 6
function safe(v: unknown,max=800){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function parseJson(text:string){const s=String(text||'').replace(/```json|```/g,'').trim();try{return JSON.parse(s)}catch{const m=s.match(/\{[\s\S]*\}/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}}
async function actorUserId(telegramId:string){const{data}=await supabaseAdmin.from('users').select('id').eq('telegram_id',Number(telegramId)).maybeSingle();return data?.id?String(data.id):null}
async function compare(snapshot:any,pageText:string){const prompt=`Compare the saved booking snapshot to the current provider page. Return JSON only. Material changes are cancellation, event date/time change, venue change, or event title change. Ignore marketing/layout/availability chatter. Never infer a change unless the current page clearly states it. Saved snapshot:${JSON.stringify(snapshot).slice(0,4000)} Current page:${pageText.slice(0,10000)} Return {"changed":false,"reason":"","newStartAt":null,"newLocation":null,"newTitle":null,"cancelled":false}`;try{const r=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:500,temperature:0,messages:[{role:'user',content:prompt}]});return r.content[0]?.type==='text'?parseJson(r.content[0].text):null}catch{return null}}
async function defer(id:string,payload:any,hours=RECHECK_HOURS){const due=new Date(Date.now()+hours*3600_000).toISOString();await supabaseAdmin.from('life_event_actions').update({status:'ready',due_at:due,updated_at:new Date().toISOString(),payload_json:{...(payload||{}),lastCheckedAt:new Date().toISOString(),nextCheckAt:due}}).eq('id',id).eq('status','running')}
async function complete(id:string,payload:any){await supabaseAdmin.from('life_event_actions').update({status:'completed',updated_at:new Date().toISOString(),payload_json:{...(payload||{}),completedAt:new Date().toISOString()}}).eq('id',id).eq('status','running')}

export async function processBookingChangeWatches(limit=8){
  const now=new Date(),staleBefore=new Date(now.getTime()-LEASE_MINUTES*60_000).toISOString(),select='id,life_event_id,telegram_id,status,payload_json,updated_at'
  const[due,stale]=await Promise.all([supabaseAdmin.from('life_event_actions').select(select).eq('action_key','booking-change-watch').in('status',['queued','ready']).lte('due_at',now.toISOString()).limit(limit),supabaseAdmin.from('life_event_actions').select(select).eq('action_key','booking-change-watch').eq('status','running').lte('updated_at',staleBefore).limit(limit)])
  if(due.error)throw new Error(`booking_watch_due_failed:${due.error.message}`);if(stale.error)throw new Error(`booking_watch_stale_failed:${stale.error.message}`)
  const rows=[...(stale.data||[]),...(due.data||[])].filter((r:any,i:number,a:any[])=>a.findIndex(x=>String(x.id)===String(r.id))===i).slice(0,limit)
  let checked=0,changed=0,deferred=0,failed=0
  for(const row of rows as any[]){const expected=String(row.status);let q=supabaseAdmin.from('life_event_actions').update({status:'running',updated_at:now.toISOString()}).eq('id',row.id).eq('status',expected);if(expected==='running'&&row.updated_at)q=q.eq('updated_at',row.updated_at);const{data:claimed}=await q.select('id').maybeSingle();if(!claimed?.id)continue;checked++
    try{
      const{data:event}=await supabaseAdmin.from('life_events').select('id,title,start_at,location,lifecycle_state,metadata_json').eq('id',row.life_event_id).eq('telegram_id',String(row.telegram_id)).maybeSingle();if(!event)throw new Error('booking_watch_event_missing')
      if(event.lifecycle_state==='cancelled'||(event.start_at&&new Date(event.start_at).getTime()<Date.now()-6*3600_000)){await complete(row.id,row.payload_json);continue}
      const url=String(row.payload_json?.resolvedUrl||row.payload_json?.bookingUrl||event.metadata_json?.resolvedUrl||event.metadata_json?.bookingUrl||''),userId=await actorUserId(String(row.telegram_id));if(!url||!userId){await defer(row.id,row.payload_json,12);deferred++;continue}
      const page=await readProviderTicketPage({userId,url});if(page.status!=='completed'){await defer(row.id,row.payload_json,6);deferred++;continue}
      const snapshot=row.payload_json?.snapshot||event.metadata_json?.bookingDetails||{title:event.title,startAt:event.start_at,location:event.location,status:'confirmed'},delta=await compare(snapshot,page.pageText);if(!delta?.changed){await defer(row.id,row.payload_json);deferred++;continue}
      changed++;const at=new Date().toISOString(),cancelled=Boolean(delta.cancelled),nextSnapshot={...snapshot,...(delta.newStartAt?{startAt:delta.newStartAt}:{}),...(delta.newLocation?{location:delta.newLocation}:{}),...(delta.newTitle?{title:delta.newTitle}:{}),...(cancelled?{status:'cancelled',cancelled:true}:{})},nextMeta={...(event.metadata_json||{}),attentionRequired:true,lastProviderChange:{detectedAt:at,reason:safe(delta.reason,500),newStartAt:delta.newStartAt||null,newLocation:delta.newLocation||null,newTitle:delta.newTitle||null,cancelled,sourceUrl:page.url},bookingDetails:nextSnapshot}
      const{error:updateError}=await supabaseAdmin.from('life_events').update({lifecycle_state:cancelled?'cancelled':'watching',metadata_json:nextMeta,updated_at:at}).eq('id',event.id).eq('telegram_id',String(row.telegram_id));if(updateError)throw new Error(`booking_watch_event_update_failed:${updateError.message}`)
      const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({telegram_id:String(row.telegram_id),event_type:'booking_change_detected',message:`Booking change detected: ${safe(delta.reason||'provider changed the event',600)}`,metadata_json:{life_event_id:event.id,delta}})
      if(activityError) console.error('BOOKING_CHANGE_ACTIVITY_FAILED:',activityError.message)
      await sendAgentPush(String(row.telegram_id),{title:cancelled?'Booking cancelled':'Booking changed',body:safe(delta.reason||`${event.title} changed on the provider page.`,260),path:'/dashboard/today',data:{lifeEventId:String(event.id)}}).catch(()=>{})
      if(cancelled)await complete(row.id,{...(row.payload_json||{}),snapshot:nextSnapshot,lastChangeAt:at,cancellationNotified:true});else{await defer(row.id,{...(row.payload_json||{}),snapshot:nextSnapshot,lastChangeAt:at});deferred++}
    }catch(err:any){failed++;console.error('BOOKING_CHANGE_WATCH_FAILED:',err?.message||err);try{await defer(row.id,{...(row.payload_json||{}),lastError:safe(err?.message||'booking_watch_failed',300)},12)}catch(deferErr:any){console.error('BOOKING_CHANGE_DEFER_FAILED:',deferErr?.message||deferErr)}}
  }
  return{checked,changed,deferred,failed}
}
