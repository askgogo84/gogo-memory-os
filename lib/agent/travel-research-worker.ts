import {supabaseAdmin} from '@/lib/supabase-admin'
import {resolveAgentActor} from './actor'
import {runQueuedTravelResearch} from './travel-research-queue'
import {deliverNotification} from '@/lib/services/notification-delivery'
import {sendWhatsApp} from '@/lib/whatsapp'

export async function processTravelResearchQueue(deadline: number) {
  const staleBefore = new Date(Date.now()-10*60_000).toISOString()
  const {data:stale,error:staleError} = await supabaseAdmin.from('agent_runs').select('id,metadata_json,updated_at')
    .eq('type','travel_research').eq('metadata_json->>background_travel','true').eq('status','running')
    .lte('updated_at',staleBefore).limit(10)
  if(staleError) throw new Error('travel_stale_read_failed')
  for(const run of stale || []) {
    const retried = run.metadata_json?.requeued === true
    const now = new Date().toISOString()
    const {error} = await supabaseAdmin.from('agent_runs').update(retried ? {
      status:'failed',completed_at:now,updated_at:now,error:'travel_worker_interrupted',
      summary:'The flight check was interrupted and could not finish.',
      metadata_json:{...run.metadata_json,result_text:'The flight check was interrupted and could not finish. No booking or payment was made.'},
    } : {status:'queued',updated_at:now,metadata_json:{...run.metadata_json,requeued:true}})
      .eq('id',run.id).eq('status','running').eq('updated_at',run.updated_at)
    if(error) throw new Error('travel_stale_write_failed')
  }
  const {data:queued,error:queueError} = await supabaseAdmin.from('agent_runs').select('id,telegram_id')
    .eq('type','travel_research').eq('metadata_json->>background_travel','true').eq('status','queued')
    .order('updated_at',{ascending:true}).limit(1)
  if(queueError) throw new Error('travel_worker_queue_failed')
  let claimed = 0
  for(const run of queued || []) {
    if(Date.now()+180_000 >= deadline) break
    const {data:claim,error} = await supabaseAdmin.from('agent_runs').update({status:'running',updated_at:new Date().toISOString()})
      .eq('id',run.id).eq('telegram_id',run.telegram_id).eq('type','travel_research').eq('status','queued').select('id').maybeSingle()
    if(error) throw new Error('travel_worker_claim_failed')
    if(!claim) continue
    claimed++
    try {
      const actor = await resolveAgentActor({telegramId:String(run.telegram_id),surface:'web'})
      await runQueuedTravelResearch(actor,String(run.id))
    } catch(error) {
      console.error('TRAVEL_WORKER_FAILED:',error instanceof Error ? error.message : 'unknown')
      // If the process dies rather than throwing, the stale sweep above recovers.
      const now = new Date().toISOString()
      const {error:saveError} = await supabaseAdmin.from('agent_runs').update({status:'failed',completed_at:now,updated_at:now,
        error:'travel_worker_failed',summary:'The flight check could not finish safely.'})
        .eq('id',run.id).eq('telegram_id',run.telegram_id).eq('status','running')
      if(saveError) throw new Error('travel_worker_failure_write_failed')
    }
  }
  const {data:terminal,error:deliveryReadError} = await supabaseAdmin.rpc('due_travel_research_deliveries',{p_limit:10})
  if(deliveryReadError) throw new Error('travel_delivery_queue_failed')
  let published = 0, deliveryFailures = 0
  for(const row of terminal || []) {
    if(Date.now() >= deadline) break
    const {data:run,error} = await supabaseAdmin.from('agent_runs').select('id,telegram_id,source,status,updated_at,summary,metadata_json')
      .eq('id',row.id).eq('telegram_id',row.telegram_id).eq('type','travel_research').in('status',['completed','failed']).maybeSingle()
    if(error) {deliveryFailures++;continue}
    if(!run || run.metadata_json?.notified) continue
    const text = String(run.metadata_json?.result_text || 'I could not complete the flight check safely. No booking or payment was confirmed.')
    try {
      if(run.source === 'web') {
        const {data,error:publishError} = await supabaseAdmin.rpc('publish_web_travel_result',{
          p_owner:String(run.telegram_id),p_run_id:run.id,p_content:text,
        })
        if(publishError) throw new Error('travel_web_publication_failed')
        if(data) published++
      } else if(run.source === 'whatsapp') {
        const actor = await resolveAgentActor({telegramId:String(run.telegram_id),surface:'web'})
        const status = await deliverNotification({
          key:`travel_research/${run.id}`,source:'travel_research',owner:actor.legacyTelegramId,channel:'whatsapp',due:run.updated_at,deadline,
          prepare:async()=>{},ready:async()=>Boolean(actor.whatsappId),
          send:async token=>String((await sendWhatsApp(actor.whatsappId,text,undefined,process.env.TWILIO_STATUS_CALLBACK_URL?token:undefined))?.sid || ''),
          accepted:async()=>{
            const {error:markError} = await supabaseAdmin.from('agent_runs').update({metadata_json:{...run.metadata_json,notified:true}})
              .eq('id',run.id).eq('telegram_id',String(actor.legacyTelegramId)).is('metadata_json->>notified',null)
            if(markError) throw new Error('travel_delivery_marker_failed')
            const {error:historyError} = await supabaseAdmin.from('conversations').insert({telegram_id:actor.legacyTelegramId,role:'assistant',content:text})
            if(historyError) throw new Error('travel_delivery_history_failed')
          },
        })
        if(status === 'provider_accepted') published++
        if(['failed','persistence_failed','outcome_unknown'].includes(status)) deliveryFailures++
      }
    } catch(error) {deliveryFailures++;console.error('TRAVEL_RESULT_PUBLICATION_FAILED:',error instanceof Error ? error.message : 'unknown')}
  }
  return {claimed,published,deliveryFailures}
}
