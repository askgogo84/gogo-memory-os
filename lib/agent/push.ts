import { supabaseAdmin } from '@/lib/supabase-admin'

export async function sendAgentPush(telegramId:string, input:{title:string;body:string;path?:string;data?:Record<string,unknown>}){
  const {data,error}=await supabaseAdmin.from('agent_devices')
    .select('id,expo_push_token').eq('telegram_id',String(telegramId)).eq('enabled',true).not('expo_push_token','is',null)
  if(error){console.error('AGENT_PUSH_DEVICE_READ_FAILED:',error.message);return {sent:0,failed:0}}
  const tokens=(data||[]).map((x:any)=>String(x.expo_push_token||'').trim()).filter(Boolean)
  if(!tokens.length)return {sent:0,failed:0}
  const messages=tokens.slice(0,20).map((to:string)=>({
    to,
    sound:'default',
    title:String(input.title||'Gogo update').slice(0,120),
    body:String(input.body||'').slice(0,500),
    data:{path:input.path||'/agent',...(input.data||{})},
    channelId:'gogo-updates',
    priority:'high',
  }))
  try{
    const res=await fetch('https://exp.host/--/api/v2/push/send',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(messages),
    })
    if(!res.ok){console.error('AGENT_PUSH_SEND_FAILED:',res.status);return {sent:0,failed:messages.length}}
    const payload:any=await res.json().catch(()=>({}))
    const receipts=Array.isArray(payload?.data)?payload.data:[]
    let sent=0,failed=0
    for(let i=0;i<messages.length;i++){
      const r=receipts[i]
      if(r?.status==='ok')sent++;else failed++
      if(r?.details?.error==='DeviceNotRegistered'){
        const token=messages[i].to
        await supabaseAdmin.from('agent_devices').update({enabled:false,updated_at:new Date().toISOString()}).eq('telegram_id',String(telegramId)).eq('expo_push_token',token)
      }
    }
    return {sent,failed}
  }catch(err:any){console.error('AGENT_PUSH_SEND_FAILED:',err?.message||err);return {sent:0,failed:messages.length}}
  }
