import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildGmailConnectUrl, fetchLatestEmails, fetchUnreadEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { decryptGoogleToken } from '@/lib/security/google-token-crypto'
import { formatEmailSnippet, redactEmailAuthSecrets } from '@/lib/agent/google-workspace-read'

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

export type GmailReadFilter = { sender?: string | null; topic?: string | null }

// "latest email from Swiggy" / "my latest password reset email": pull the sender and the topic out of the
// sentence so the reader shows the mail that was asked for instead of the five newest.
export function parseGmailReadFilter(text: string): GmailReadFilter {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  const from = raw.match(/\bfrom\s+([A-Za-z0-9][A-Za-z0-9 .&'@-]{1,40}?)(?=\s*(?:[?.!,]|$|\bto\b|\babout\b|\bregarding\b))/i)
  const topic = raw.match(/\b(?:latest|last|newest|recent|unread)\s+([A-Za-z][A-Za-z '&-]{2,40}?)\s+(?:e-?mails?|mails?|messages?)\b/i)
  const topicWords = String(topic?.[1] || '').replace(/\b(?:my|the|a|an|new|unread|important|urgent)\b/gi, '').replace(/\s+/g, ' ').trim()
  return { sender: from?.[1]?.trim() || null, topic: topicWords || null }
}

function matchesFilter(row: any, filter?: GmailReadFilter) {
  if (!filter?.sender && !filter?.topic) return true
  const hay = `${row.from || ''} ${row.subject || ''} ${row.snippet || ''}`.toLowerCase()
  if (filter.sender && !String(row.from || '').toLowerCase().includes(filter.sender.toLowerCase())) return false
  if (filter.topic) return filter.topic.toLowerCase().split(' ').filter(Boolean).every(word => hay.includes(word))
  return true
}

// 17 Oct scorecard: "summarise my inbox" listed five raw emails. A summary groups them: what needs the person,
// and how many are promotions/notifications (by sender), from the latest 15.
const AUTOMATED_SENDER=/\b(?:no-?reply|noreply|do-?not-?reply|promo|promotions?|newsletter|offers?|marketing|deals|notifications?|alerts?|updates?|mailer|info@|news@)\b/i
export function summariseInbox(rows:any[]){
  const automated=rows.filter(row=>AUTOMATED_SENDER.test(String(row.from||'')))
  const people=rows.filter(row=>!automated.includes(row))
  const name=(from:string)=>clean(String(from||'').replace(/<[^>]*>/g,'').replace(/"/g,''),40)||'Unknown sender'
  const senders=Array.from(new Set(automated.map(row=>name(row.from)))).slice(0,6)
  const lines=[`📧 *Inbox summary* (latest ${rows.length})`]
  if(people.length){
    lines.push('',`*From people (${people.length})*`)
    people.slice(0,6).forEach((row,i)=>lines.push(`${i+1}. ${name(row.from)}: ${clean(redactEmailAuthSecrets(String(row.subject||'(no subject)')),110)}`))
  } else lines.push('','Nothing from a person; all automated mail.')
  if(automated.length)lines.push('',`*Promotions and notifications (${automated.length})*: ${senders.join(', ')}${automated.length>senders.length?' and others':''}`)
  return lines.join('\n')
}

export async function buildGmailReadReply(telegramId:number,mode:'latest'|'unread'='latest',maxResults=5,filter?:GmailReadFilter,summarise=false){
  const access=await gmailAccess(telegramId)
  if(access.disabled)return 'Google Workspace access is turned off in your privacy settings.'
  if(!access.connected){
    const url=buildGmailConnectUrl(telegramId)
    return url
      ? `Your Google Workspace account is not connected yet.\n\nConnect read-only access here:\n${url}`
      : 'Your Google Workspace account is not connected yet.'
  }

  const filtered=Boolean(filter?.sender||filter?.topic)
  const fetched=mode==='unread'
    ? await fetchUnreadEmails(access.accessToken,filtered?25:maxResults)
    : await fetchLatestEmails(access.accessToken,filtered?25:maxResults)
  const rows=fetched.filter((row:any)=>matchesFilter(row,filter)).slice(0,maxResults)
  if(!rows.length){
    if(filtered){
      const what=[filter?.topic,filter?.sender?`from ${filter.sender}`:''].filter(Boolean).join(' ')
      return `I couldn't find a recent email${what?` matching “${what}”`:''} in your latest Gmail messages. I did not guess.`
    }
    return mode==='unread'?'You have no unread emails in the current Gmail view.':'I could not find recent Gmail messages.'
  }

  if(summarise&&!filtered){
    const more=mode==='unread'?await fetchUnreadEmails(access.accessToken,15):await fetchLatestEmails(access.accessToken,15)
    return `${summariseInbox(more.length?more:rows)}\n\nSay “show my latest emails” for the full list. I have not sent, deleted, archived or modified anything.`
  }
  const heading=mode==='unread'?'📧 *Unread emails*':filtered?'📧 *Matching emails*':'📧 *Latest emails*'
  const lines=rows.map((row:any,index:number)=>{
    const from=clean(row.from,120)
    const subject=clean(redactEmailAuthSecrets(String(row.subject||'')),160)
    const snippet=formatEmailSnippet(row.snippet,220)
    return `${index+1}. *${subject}*\nFrom: ${from}${snippet?`\n${snippet}`:''}`
  })
  return `${heading}\n\n${lines.join('\n\n')}\n\nI only read the Google context you approved. I have not sent, deleted, archived or modified anything.`
}
