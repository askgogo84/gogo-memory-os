import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/admin/auth'
import { getShadowBrainReport } from '@/lib/agent/shadow-report'
import { getUnderstandingShadowReport } from '@/lib/agent/understanding-report'

export const dynamic='force-dynamic'

export async function GET(req:NextRequest){
  const admin=await requireAdminSession()
  if(!admin.ok)return NextResponse.json({error:admin.reason},{status:admin.status})

  const hours=Number(req.nextUrl.searchParams.get('hours')||24)
  const report=await getShadowBrainReport({hours})
  // Understand-first readings vs the router that actually handled each turn (docs/architecture/06-understand-first-shadow.md).
  const understandFirst=await getUnderstandingShadowReport({hours}).catch((err:any)=>({error:String(err?.message||err).slice(0,160)}))
  return NextResponse.json({...report,understandFirst})
}
