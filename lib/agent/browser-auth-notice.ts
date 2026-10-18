import {supabaseAdmin} from '@/lib/supabase-admin'

export function loginUnavailableMessage(site:string,resumeUrl:string):string{
  return `I couldn't sign in to ${site} automatically, so I paused this task.\n\nOpen this, tap Take control and sign in yourself, then tap Resume. I'll continue the same question. Keep passwords and sign-in codes in Take control, not in chat:\n${resumeUrl}`
}

export async function browserHandoffInUseReply(telegramId:number):Promise<string>{
  const base=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
  let target=`${base}/dashboard/tasks`
  try{
    const {data,error}=await supabaseAdmin.from('agent_runs').select('id,metadata_json')
      .eq('telegram_id',String(telegramId)).eq('type','secure_browser').eq('status','paused')
      .order('updated_at',{ascending:false}).limit(20)
    if(!error){
      const waiting=(data||[]).find(row=>row.metadata_json?.handoff)
      if(waiting)target=`${base}/dashboard/activity/${encodeURIComponent(waiting.id)}/browser`
    }
  }catch{/* The user still receives the safe task-list handoff if lookup fails. */}
  return `Another browser task is waiting for you to sign in or finish a secure step. Open it and complete that step before retrying this request. Nothing was submitted for this request.\n${target}`
}
