import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resumePausedBrowserRun } from '@/lib/agent/browser-command'
import type { AgentActor } from '@/lib/agent/actor'

export const dynamic='force-dynamic'

export async function POST(request:Request,{params}:{params:Promise<{runId:string}>}){
  const blocked=verifySameOrigin(request)
  if(blocked)return blocked
  const session=await getSession()
  if(!session)return NextResponse.json({ok:false},{status:401})
  const {runId}=await params

  const {data:user,error:userError}=await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id',Number(session.telegramId))
    .maybeSingle()
  if(userError||!user?.id||!user?.whatsapp_id)return NextResponse.json({ok:false,error:'user_unavailable'},{status:400})

  const actor:AgentActor={
    userId:String(user.id),
    legacyTelegramId:Number(user.telegram_id),
    whatsappId:String(user.whatsapp_id),
    name:String(user.name||'Gogo'),
  }

  try{
    const result=await resumePausedBrowserRun({actor,runId:String(runId)})
    return NextResponse.json({ok:true,result:{
      runId:result.runId,status:result.status,text:result.text,blockedReason:(result as any).blockedReason||null,
    }})
  }catch(err:any){
    const reason=String(err?.message||'resume_failed')
    console.error('DASHBOARD_BROWSER_RESUME_FAILED:',reason)
    const status=reason==='browser_resume_not_paused'?409:reason==='browser_resume_execute_requires_approval'?409:500
    return NextResponse.json({ok:false,error:reason},{status})
  }
}
