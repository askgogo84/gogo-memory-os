import { NextRequest, NextResponse } from 'next/server'
import { getGmailSendAuthUrl, verifyGmailSendConnectToken } from '@/lib/google-gmail'

export const dynamic='force-dynamic'

export async function GET(req:NextRequest){
  const url=new URL(req.url)
  const token=url.searchParams.get('token')||''
  const telegramId=verifyGmailSendConnectToken(token)
  if(!telegramId){
    return NextResponse.json({ok:false,error:'Invalid or expired Gmail Send upgrade link'},{status:401})
  }
  const authUrl=getGmailSendAuthUrl(telegramId)
  if(!authUrl){
    return NextResponse.json({ok:false,error:'Gmail Send upgrade is temporarily unavailable'},{status:503})
  }
  return NextResponse.redirect(authUrl)
}
