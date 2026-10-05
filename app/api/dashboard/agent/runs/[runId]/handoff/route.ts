import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {browserHandoffIsLive} from '@/lib/agent/browser-handoff-health'
import {managedLiveViewUrl} from '@/lib/agent/managed-browser'
import {browserSandboxName} from '@/lib/agent/browser-handoff'

export const dynamic='force-dynamic'

function privateRedirect(url:URL){
  const response=NextResponse.redirect(url)
  response.headers.set('Cache-Control','private, no-store')
  response.headers.set('Referrer-Policy','no-referrer')
  return response
}

export async function GET(_request:Request,{params}:{params:Promise<{runId:string}>}){
  const session=await getSession()
  if(!session)return NextResponse.json({error:'unauthorized'},{status:401})
  const {runId}=await params
  const {data,error}=await supabaseAdmin.from('agent_runs')
    .select('metadata_json,status')
    .eq('id',runId)
    .eq('telegram_id',String(session.telegramId))
    .maybeSingle()
  if(error)return NextResponse.json({error:'read_failed'},{status:500})
  if(!data)return NextResponse.json({error:'not_found'},{status:404})
  if(!['paused','waiting_approval'].includes(String(data.status)))return NextResponse.json({error:'handoff_unavailable'},{status:409})

  const handoff:any=(data.metadata_json as any)?.handoff||{}
  const target=handoff?.mode==='device'?handoff?.providerUrl:handoff?.takeoverUrl
  if(!target)return NextResponse.json({error:'handoff_unavailable'},{status:404})
  let url:URL
  try{url=new URL(String(target))}catch{return NextResponse.json({error:'handoff_invalid'},{status:400})}
  if(!['https:','http:'].includes(url.protocol))return NextResponse.json({error:'handoff_invalid'},{status:400})
  if(handoff?.mode!=='device'&&!await browserHandoffIsLive(target)){
    return privateRedirect(new URL('/dashboard/activity/'+encodeURIComponent(runId)+'/browser',_request.url))
  }

  if(handoff?.mode!=='device'&&handoff?.managedSessionId){
    try{
      const {data:owner,error:ownerError}=await supabaseAdmin.from('users')
        .select('id').eq('telegram_id',String(session.telegramId)).maybeSingle()
      if(!ownerError&&owner?.id){
        const personal=browserSandboxName(String(owner.id))
        const commerce=browserSandboxName(`${owner.id}:commerce`)
        const sandboxName=String(handoff.sandboxName||'')
        if(sandboxName===personal||sandboxName===commerce){
          const live=await managedLiveViewUrl(String(handoff.managedSessionId),sandboxName)
          return privateRedirect(new URL(live))
        }
      }
    }catch{return privateRedirect(url)}
  }

  return privateRedirect(url)
}
