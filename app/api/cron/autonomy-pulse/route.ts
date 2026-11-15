import { NextResponse } from 'next/server'
import { processAutonomyPulse } from '@/lib/agent/autonomy-pulse'
import { isCronAuthorized } from '@/lib/security/cron-auth'

export const dynamic='force-dynamic'
export const maxDuration=120

// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronAuthorized(request)

export async function GET(request:Request){
  if(!authorized(request))return NextResponse.json({error:'unauthorized'},{status:401})
  try{
    const result=await processAutonomyPulse()
    return NextResponse.json({ok:true,...result})
  }catch(err:any){
    console.error('AUTONOMY_PULSE_FAILED:',err?.message||err)
    return NextResponse.json({ok:false,error:'autonomy_pulse_failed'},{status:500})
  }
}
