import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {browserHandoffIsLive} from '@/lib/agent/browser-handoff-health'

export const dynamic='force-dynamic'

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
  // Prefer the provider's interactive live view (the real browser); the relay is the fallback.
  // With the relay alive, open the relay page with the live view inside it: taps go to the real
  // browser and our Type box types into the tapped field (phone keyboards are not supported by the
  // provider's live view). Without the relay, open the live view directly.
  let liveView:URL|null=null
  if(handoff?.mode!=='device'&&typeof handoff?.liveViewUrl==='string'){
    try{
      const live=new URL(handoff.liveViewUrl)
      if(live.protocol==='https:'&&(live.hostname==='browserbase.com'||live.hostname.endsWith('.browserbase.com')))liveView=live
    }catch{}
  }
  if(liveView&&typeof handoff?.takeoverUrl==='string'&&await browserHandoffIsLive(handoff.takeoverUrl)){
    try{
      const relay=new URL(handoff.takeoverUrl)
      if(['https:','http:'].includes(relay.protocol)){relay.searchParams.set('live',liveView.toString());return NextResponse.redirect(relay)}
    }catch{}
  }
  if(liveView)return NextResponse.redirect(liveView)
  const target=handoff?.mode==='device'?handoff?.providerUrl:handoff?.takeoverUrl
  if(!target)return NextResponse.json({error:'handoff_unavailable'},{status:404})
  let url:URL
  try{url=new URL(String(target))}catch{return NextResponse.json({error:'handoff_invalid'},{status:400})}
  if(!['https:','http:'].includes(url.protocol))return NextResponse.json({error:'handoff_invalid'},{status:400})
  if(handoff?.mode!=='device'&&!await browserHandoffIsLive(target)){
    return NextResponse.redirect(new URL('/dashboard/activity/'+encodeURIComponent(runId)+'/browser',_request.url))
  }

  return NextResponse.redirect(url)
}
