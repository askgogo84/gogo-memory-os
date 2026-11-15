import { NextResponse } from 'next/server'
import { processOpenLoopScoutPass } from '@/lib/agent/open-loops'
import { isCronAuthorized } from '@/lib/security/cron-auth'

export const dynamic='force-dynamic'
export const maxDuration=120

// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronAuthorized(request)

export async function GET(request:Request){
  if(!authorized(request))return NextResponse.json({error:'unauthorized'},{status:401})
  try{
    const result=await processOpenLoopScoutPass()
    return NextResponse.json({ok:true,...result})
  }catch(err:any){
    console.error('OPEN_LOOP_SCOUT_FAILED:',err?.message||err)
    return NextResponse.json({ok:false,error:'open_loop_scout_failed'},{status:500})
  }
}
