import {NextResponse} from 'next/server'
import {processTravelResearchQueue} from '@/lib/agent/travel-research-worker'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(request: Request) {
  if(!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({error:'unauthorized'},{status:401})
  try {
    const result = await processTravelResearchQueue(Date.now()+270_000)
    return NextResponse.json({ok:result.deliveryFailures===0,...result},{status:result.deliveryFailures ? 503 : 200})
  } catch(error) {
    console.error('TRAVEL_RESEARCH_CRON_FAILED:',error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({error:'travel_worker_failed'},{status:500})
  }
}
