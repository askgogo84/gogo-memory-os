import { supabaseAdmin } from '@/lib/supabase-admin'
import { closeBookingLink } from './booking-closure'
import { sendWhatsAppMediaMessage, sendWhatsAppMessage } from '@/lib/channels/whatsapp'

const LEASE_MINUTES = 10
const RETRY_MINUTES = 10
function safe(v:unknown,max=400){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
async function defer(row:any,reason:string){const due=new Date(Date.now()+RETRY_MINUTES*60_000).toISOString();await supabaseAdmin.from('life_event_actions').update({status:'ready',due_at:due,updated_at:new Date().toISOString(),payload_json:{...(row.payload_json||{}),lastError:safe(reason),retryAt:due}}).eq('id',row.id).eq('status','running')}
async function complete(row:any,result:any){await supabaseAdmin.from('life_event_actions').update({status:'completed',updated_at:new Date().toISOString(),payload_json:{...(row.payload_json||{}),closedAt:new Date().toISOString(),closureLifeEventId:result?.lifeEventId||row.life_event_id}}).eq('id',row.id).eq('status','running')}

export async function processQueuedBookingClosures(limit=6){
  const now=new Date(),staleBefore=new Date(now.getTime()-LEASE_MINUTES*60_000).toISOString(),select='id,life_event_id,telegram_id,status,payload_json,updated_at'
  const[due,stale]=await Promise.all([supabaseAdmin.from('life_event_actions').select(select).eq('action_key','booking-closure').in('status',['queued','ready']).lte('due_at',now.toISOString()).limit(limit),supabaseAdmin.from('life_event_actions').select(select).eq('action_key','booking-closure').eq('status','running').lte('updated_at',staleBefore).limit(limit)])
  if(due.error)throw new Error(`booking_closure_due_failed:${due.error.message}`);if(stale.error)throw new Error(`booking_closure_stale_failed:${stale.error.message}`)
  const rows=[...(stale.data||[]),...(due.data||[])].filter((r:any,i:number,a:any[])=>a.findIndex(x=>String(x.id)===String(r.id))===i).slice(0,limit)
  let checked=0,completed=0,deferred=0,failed=0
  for(const row of rows as any[]){const expected=String(row.status);let q=supabaseAdmin.from('life_event_actions').update({status:'running',updated_at:now.toISOString()}).eq('id',row.id).eq('status',expected);if(expected==='running'&&row.updated_at)q=q.eq('updated_at',row.updated_at);const{data:claimed}=await q.select('id').maybeSingle();if(!claimed?.id)continue;checked++
    try{
      const text=String(row.payload_json?.originalText||''),to=String(row.payload_json?.whatsappTo||'');if(!text||!to)throw new Error('booking_closure_context_missing')
      const result=await closeBookingLink({telegramId:Number(row.telegram_id),text});if(!result)throw new Error('booking_closure_no_result')
      if(result.credentialUrl){const caption=`${result.details?.title?`🎟️ ${result.details.title}\n`:''}Provider-issued ticket / QR saved by AskGogo.`;await sendWhatsAppMediaMessage(to,caption,result.credentialUrl)}
      await sendWhatsAppMessage(to,result.text)
      await complete(row,result);completed++
      const { error: activityError } = await supabaseAdmin.from('agent_activity').insert({telegram_id:String(row.telegram_id),event_type:'booking_closure_completed',message:`Booking closure completed for ${safe(result.details?.title||'event',180)}.`,metadata_json:{life_event_id:result.lifeEventId||row.life_event_id,credential_saved:Boolean(result.credentialUrl),calendar_approval_id:result.approvalId||null}})
      if(activityError) console.error('BOOKING_CLOSURE_ACTIVITY_FAILED:',activityError.message)
    }catch(err:any){failed++;console.error('BOOKING_CLOSURE_WORKER_FAILED:',err?.message||err);await defer(row,err?.message||'booking_closure_failed');deferred++}
  }
  return{checked,completed,deferred,failed}
}
