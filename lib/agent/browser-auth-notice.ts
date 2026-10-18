import {supabaseAdmin} from '@/lib/supabase-admin'
import {otpReply} from './provider-booking'

/** Codes are human-only; an ordinary numeric reply needs owner-specific auth context. */
export async function shouldWithholdAuthenticationCode(telegramId:number|string,text:string):Promise<boolean>{
  if(!otpReply(text))return false
  if(/^(?:otp|code|the code is|code is|otp is)\b/i.test(text.trim()))return true
  const now=Date.now()
  const {data,error}=await supabaseAdmin.from('agent_runs').select('status,metadata_json')
    .eq('telegram_id',String(telegramId)).eq('type','secure_browser').in('status',['paused','running'])
    .gte('updated_at',new Date(now-10*60_000).toISOString()).order('updated_at',{ascending:false}).limit(20)
  if(error)throw new Error('authentication_context_lookup_failed')
  return (data||[]).some(row=>[row.metadata_json?.login_code,row.metadata_json?.booking_otp].some(context=>{
    const requested=Date.parse(String(context?.requested_at||''))
    return Number.isFinite(requested)&&requested<=now&&now-requested<=10*60_000
  }))
}

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

export async function humanAuthTakeoverReply(telegramId:number|string):Promise<string>{
  const base=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
  let target=base+'/dashboard/tasks'
  try{
    const {data,error}=await supabaseAdmin.from('agent_runs').select('id,metadata_json').eq('telegram_id',String(telegramId)).eq('type','secure_browser').eq('status','paused').order('updated_at',{ascending:false}).limit(20)
    const waiting=!error&&(data||[]).find(row=>row.metadata_json?.handoff)
    if(waiting)target=base+'/dashboard/activity/'+encodeURIComponent(waiting.id)+'/browser'
  }catch{}
  return 'I did not use or save that code. Complete sign-in codes, passkeys and other secondary authentication yourself in Take control, then tap Resume to continue the same task. Keep codes out of chat.\n'+target
}
