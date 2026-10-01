import { supabaseAdmin } from '@/lib/supabase-admin'

// Acknowledgement is separate from delivery: sent=true cannot mean the user
// completed an occurrence. Never let Done cancel an unrelated future reminder.
export async function completeReminderOccurrence(telegramId:number,replyToSid?:string|null){
  const columns='id,message,sent,status,is_recurring,recurring_pattern,sent_at,twilio_sid'
  let target:any=null
  if(replyToSid){
    const {data,error}=await supabaseAdmin.from('reminders').select(columns)
      .eq('telegram_id',telegramId).eq('twilio_sid',replyToSid).eq('sent',true).maybeSingle()
    if(error)throw new Error('reminder_completion_read_failed')
    target=data
  }else{
    const {data,error}=await supabaseAdmin.from('reminders').select(columns)
      .eq('telegram_id',telegramId).eq('sent',true)
      .gte('sent_at',new Date(Date.now()-30*60_000).toISOString())
      .order('sent_at',{ascending:false}).limit(2)
    if(error)throw new Error('reminder_completion_read_failed')
    // Without quoted-message identity, only one recent occurrence is unambiguous.
    if(data?.length===1)target=data[0]
  }
  if(!target)return 'Please reply to the specific reminder message with *done* so I can close the right occurrence. I haven’t changed any reminders.'
  const name=String(target.message||'Reminder').replace(/\s+/g,' ').trim().slice(0,240)
  if(target.status==='completed')return `✅ Already done: *${name}*. This occurrence is closed.`
  const {data:saved,error}=await supabaseAdmin.from('reminders')
    .update({status:'completed'}).eq('id',target.id).eq('telegram_id',telegramId).eq('sent',true)
    .select('id,status').maybeSingle()
  if(error||saved?.status!=='completed')throw new Error('reminder_completion_write_failed')
  return `✅ Done: *${name}*. This occurrence is closed.${target.is_recurring?' Your recurring schedule stays active.':''}`
}
