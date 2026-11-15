import { NextResponse } from 'next/server'
import { processDueGoalReviews } from '@/lib/agent/goal-worker'
import { isCronBearerAuthorized } from '@/lib/security/cron-auth'

export const dynamic='force-dynamic'
export const maxDuration=60

// 15 Nov audit: the shared, constant-time check (was a local copy with a plain ===).
const authorized = (request: Request) => isCronBearerAuthorized(request)

export async function GET(request:Request){
  if(!authorized(request))return NextResponse.json({error:'unauthorized'},{status:401})
  try{return NextResponse.json({ok:true,...await processDueGoalReviews()})}
  catch(err:any){console.error('AGENT_GOAL_CRON_FAILED:',err?.message||err);return NextResponse.json({ok:false,error:'goal_worker_failed'},{status:500})}
}
