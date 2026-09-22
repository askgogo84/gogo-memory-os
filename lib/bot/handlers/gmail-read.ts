import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildGmailConnectUrl, fetchLatestEmails, fetchUnreadEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { decryptGoogleToken } from '@/lib/security/google-token-crypto'

function clean(value:unknown,max=500){
  return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
}

async function gmailAccess(telegramId:number){
  const [{data:user,error:userError},{data:consent,error:consentError}]=await Promise.all([
    supabaseAdmin.from('users')
      .select('gmail_connected,gmail_email,gmail_access_token,gmail_refresh_token')
      .eq('telegram_id',telegramId).maybeSingle(),
    supabaseAdmin.from('user_consent_settings')
      .select('gmail_enabled').eq('telegram_id',telegramId).maybeSingle(),
  ])
  if(userError)throw new Error(`gmail_user_read_failed:${userError.message}`)
  if(consentError)throw new Error(`gmail_consent_read_failed:${consentError.message}`)
  if(consent?.gmail_enabled===false)return {connected:false,disabled:true,email:null,accessToken:''}
  if(!user?.gmail_connected)return {connected:false,disabled:false,email:null,accessToken:''}

  let accessToken=''
  const refreshToken=decryptGoogleToken(user.gmail_refresh_token)
  if(refreshToken)accessToken=String(await refreshGmailAccessToken(refreshToken)||'')
  if(!accessToken)accessToken=decryptGoogleToken(user.gmail_access_token)
  return {connected:Boolean(accessToken),disabled:false,email:String(user.gmail_email||'').toLowerCase()||null,accessToken}
}

export async function buildGmailConnectReply(telegramId:number){
  const access=await gmailAccess(telegramId)
  if(access.disabled)return 'Google Workspace access is turned off in your privacy settings.'
  if(access.connected){
    return `✅ *Google Workspace is connected*${access.email?` as *${access.email}*`:''}.\n\nGogo can use the read-only Gmail context you approved. Sending or modifying email is still a separate approval-gated action.`
  }
  const url=buildGmailConnectUrl(telegramId)
  if(!url)return 'Google Workspace connection is temporarily unavailable.'
  return `📧 *Connect Google Workspace*\n\nThis gives Gogo read-only access to the Gmail, Contacts and Drive context you approve.\n\n${url}\n\nSending email, changing files or other consequential actions are not enabled by this connection.`
}

export async function buildGmailReadReply(telegramId:number,mode:'latest'|'unread'='latest',maxResults=5){
  const access=await gmailAccess(telegramId)
  if(access.disabled)return 'Google Workspace access is turned off in your privacy settings.'
  if(!access.connected){
    const url=buildGmailConnectUrl(telegramId)
    return url
      ? `Your Google Workspace account is not connected yet.\n\nConnect read-only access here:\n${url}`
      : 'Your Google Workspace account is not connected yet.'
  }

  const rows=mode==='unread'
    ? await fetchUnreadEmails(access.accessToken,maxResults)
    : await fetchLatestEmails(access.accessToken,maxResults)
  if(!rows.length)return mode==='unread'?'You have no unread emails in the current Gmail view.':'I could not find recent Gmail messages.'

  const heading=mode==='unread'?'📧 *Unread emails*':'📧 *Latest emails*'
  const lines=rows.map((row:any,index:number)=>{
    const from=clean(row.from,120)
    const subject=clean(row.subject,160)
    const snippet=clean(row.snippet,220)
    return `${index+1}. *${subject}*\nFrom: ${from}${snippet?`\n${snippet}`:''}`
  })
  return `${heading}\n\n${lines.join('\n\n')}\n\nI only read the Google context you approved. I have not sent, deleted, archived or modified anything.`
}
