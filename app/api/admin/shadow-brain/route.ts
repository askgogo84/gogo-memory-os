import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/admin/auth'
import { getShadowBrainReport } from '@/lib/agent/shadow-report'

export const dynamic='force-dynamic'

export async function GET(req:NextRequest){
  const admin=await requireAdminSession()
  if(!admin.ok)return NextResponse.json({error:admin.reason},{status:admin.status})

  const hours=Number(req.nextUrl.searchParams.get('hours')||24)
  const report=await getShadowBrainReport({hours})
  return NextResponse.json(report)
}
