import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { getUserLearningReport } from '@/lib/agent/learning-report'

export const dynamic='force-dynamic'
export async function GET(request:Request){
  const session=await getSession()
  const headers={'Cache-Control':'private, no-store','Vary':'Cookie'}
  if(!session)return NextResponse.json({error:'unauthorized'},{status:401,headers})
  const hours=Number(new URL(request.url).searchParams.get('hours')||168)
  try{
    const report=await getUserLearningReport(session.telegramId,{hours,limit:1000})
    return NextResponse.json(report,{headers})
  }catch{
    return NextResponse.json({error:'brain_evidence_unavailable'},{status:503,headers})
  }
}
