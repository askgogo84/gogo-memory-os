import { NextRequest, NextResponse } from 'next/server'
import { getGmailSendAuthUrl, verifyGmailSendConnectToken } from '@/lib/google-gmail'
import { setOauthBindingCookie } from '@/lib/security/oauth-browser-binding'

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
  // Bind the OAuth state to the browser that opened this link (OAuth CSRF fix).
  const res=NextResponse.redirect(authUrl)
  if(!setOauthBindingCookie(res,'gmail',authUrl)){
    return NextResponse.json({ok:false,error:'Gmail Send upgrade is temporarily unavailable'},{status:503})
  }
  return res
}
