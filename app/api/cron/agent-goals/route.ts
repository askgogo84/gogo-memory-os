import { NextResponse } from 'next/server'
import { processDueGoalReviews } from '@/lib/agent/goal-worker'

export const dynamic='force-dynamic'
export const maxDuration=60

function authorized(request:Request){
  const expected=process.env.CRON_SECRET
  if(!expected)return false
  const bearer=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  return bearer===expected
}

export async function GET(request:Request){
  if(!authorized(request))return NextResponse.json({error:'unauthorized'},{status:401})
  try{return NextResponse.json({ok:true,...await processDueGoalReviews()})}
  catch(err:any){console.error('AGENT_GOAL_CRON_FAILED:',err?.message||err);return NextResponse.json({ok:false,error:'goal_worker_failed'},{status:500})}
}
