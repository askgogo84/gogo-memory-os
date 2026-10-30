import { supabaseAdmin } from '@/lib/supabase-admin'
import { buildGmailConnectUrl, fetchLatestEmails, fetchUnreadEmails, refreshGmailAccessToken, searchGmailThreads } from '@/lib/google-gmail'
import { decryptGoogleToken } from '@/lib/security/google-token-crypto'
import { formatEmailSnippet, redactEmailAuthSecrets } from '@/lib/agent/google-workspace-read'

function clean(value:unknown,max=500){
  // Marketing mail pads previews with invisible joiners (U+034F etc.); they showed as rows of "͏ ͏ ͏".
  return String(value??'').replace(/[\u034F\u00AD\u200B-\u200F\u2060-\u2064\uFEFF\u180E]/g,'').replace(/\s+/g,' ').trim().slice(0,max)
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
  // "from my email" names the mailbox being read, not a sender called
  // "my email". Preserve actual "email from Swiggy" sender constraints.
  const raw = String(text || '').replace(/\bfrom\s+my\s+(?:e-?mails?|gmail|inbox)\b/gi,' ').replace(/\s+/g, ' ').trim()
  const from = raw.match(/\bfrom\s+([A-Za-z0-9][A-Za-z0-9 .&'@-]{1,40}?)(?=\s*(?:[?.!,]|$|\bto\b|\babout\b|\bregarding\b))/i)
  const topic = raw.match(/\b(?:latest|last|newest|recent|unread)\s+([A-Za-z][A-Za-z '&-]{2,40}?)\s+(?:e-?mails?|mails?|messages?)\b/i)
  const topicWords = String(topic?.[1] || '').replace(/\b(?:my|the|a|an|new|unread|important|urgent)\b/gi, '').replace(/\s+/g, ' ').trim()
  // "emails from today" / "from this week" name a time, not a sender; "work emails" names no searchable topic.
  const sender = from?.[1]?.trim() || ''
  const timeSender = /^(?:today|yesterday|tonight|this (?:morning|afternoon|evening|week|month)|last (?:night|week|month|\d+ (?:hours?|days?))|the (?:past|last) .+)$/i.test(sender)
  const genericTopic = /^(?:work|office|personal|all|pending|new|recent)$/i.test(topicWords)
  return { sender: (!timeSender && sender) || null, topic: (!genericTopic && topicWords) || null }
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

export async function buildGmailReadReply(telegramId:number,mode:'latest'|'unread'='latest',maxResults=5,filter?:GmailReadFilter,summarise=false,attentionOnly=false,timezone?:string){
  // "What needs my attention" / "summarise my inbox": only the mail that needs the person, with why, from every
  // connected source (Gmail, forwarded inbox, Composio). Learned rules apply. Lists below stay for explicit asks.
  if((attentionOnly||summarise)&&!filter?.sender&&!filter?.topic){
    const store:any=await import('@/lib/email/attention-store').catch(()=>null)
    if(store?.buildAttentionCard){
      try{return (await store.buildAttentionCard({legacyTelegramId:telegramId,timezone})).text}
      catch(err:any){console.error('ATTENTION_CARD_FAILED:',String(err?.message||err).slice(0,160))}
    }
  }
  const access=await gmailAccess(telegramId)
  if(access.disabled)return 'Google Workspace access is turned off in your privacy settings.'
  if(!access.connected){
    const url=buildGmailConnectUrl(telegramId)
    return url
      ? `Your Google Workspace account is not connected yet.\n\nConnect read-only access here:\n${url}`
      : 'Your Google Workspace account is not connected yet.'
  }

  const filtered=Boolean(filter?.sender||filter?.topic)
  const fetchLimit=filtered||attentionOnly?25:maxResults
  const fetched=mode==='unread'
    ? await fetchUnreadEmails(access.accessToken,fetchLimit)
    : await fetchLatestEmails(access.accessToken,fetchLimit,{inboxOnly:attentionOnly})
  const matching=fetched.filter((row:any)=>matchesFilter(row,filter))
  const attention=attentionOnly?(await import('@/lib/agent/open-loops')).isActionableGmailMessage:null
  const candidates=attention?matching.filter(attention):matching
  const rows=candidates.slice(0,maxResults)
  // Persist only source-bound service-risk notices from this successful read.
  // A failed reconciliation is surfaced without claiming the mail was saved.
  let attentionWarning=''
  try{await (await import('@/lib/agent/open-loops')).captureGmailServiceNotices(telegramId,attentionOnly?matching:rows)}
  catch{attentionWarning='\n\nI read the emails but could not save their urgent action items. Please review the notices directly.'}
  if(!rows.length){
    if(attentionOnly)return `Nothing needs your attention in your latest ${fetched.length} ${mode==='unread'?'unread ':''}emails. I only checked those ${fetched.length}, not the whole inbox.${attentionWarning}`
    if(filtered){
      const what=[filter?.topic,filter?.sender?`from ${filter.sender}`:''].filter(Boolean).join(' ')
      return `I couldn't find a recent email${what?` matching “${what}”`:''} in your latest Gmail messages. I did not guess.`
    }
    return mode==='unread'?'You have no unread emails in the current Gmail view.':'I could not find recent Gmail messages.'
  }

  if(summarise&&!filtered&&!attentionOnly){
    const more=mode==='unread'?await fetchUnreadEmails(access.accessToken,15):await fetchLatestEmails(access.accessToken,15)
    return `${summariseInbox(more.length?more:rows)}\n\nSay “show my latest emails” for the full list. I have not sent, deleted, archived or modified anything.${attentionWarning}`
  }
  const heading=attentionOnly?`📧 *Attention candidates* (${rows.length} of ${candidates.length}; latest ${fetched.length} checked, up to ${fetchLimit})`:mode==='unread'?'📧 *Unread emails*':filtered?'📧 *Matching emails*':'📧 *Latest emails*'
  const lines=rows.map((row:any,index:number)=>{
    const from=clean(row.from,120)
    const subject=clean(redactEmailAuthSecrets(String(row.subject||'')),160)
    const snippet=formatEmailSnippet(row.snippet,220)
    const ref=String(row.threadId||row.id||'')
    const source=/^[a-f0-9]{6,64}$/i.test(ref)&&access.email?`\nSource: https://mail.google.com/mail/u/?authuser=${encodeURIComponent(access.email)}#all/${ref}`:'\nSource link unavailable for this message.'
    return `${index+1}. *${subject}*\nFrom: ${from}${snippet?`\n${snippet}`:''}${source}`
  })
  return `${heading}\n\n${lines.join('\n\n')}\n\nI only read the Google context you approved. I have not sent, deleted, archived or modified anything.${attentionWarning}`
}

// ── 29 Oct: "Draft replies to my unread work emails from today" (Muse 18) ──────────────────────────────────────────
// Before: it listed the unread mail (a Quora digest, a Naukri promo, a verification code) and drafted nothing.
// Now: automated mail is skipped, up to three emails a person wrote get a short draft each. Nothing is sent.

export const BULK_DRAFT_RE = /\bdraft\s+(?:some\s+)?repl(?:y|ies)\s+(?:to|for)\s+(?:all\s+)?(?:my\s+)?(?:unread|new|latest|today'?s|work|pending)\b[^.?!]{0,30}\b(?:e-?mails?|mails?|inbox)\b/i

/** Emails a person wrote that could need a reply: not automated, not a code or alert. Pure. */
export async function bulkDraftCandidates(rows:any[]):Promise<any[]>{
  const loops=await import('@/lib/agent/open-loops')
  return rows.filter(r=>!loops.isAutomatedGmailMessage(r)&&!/\b(?:verification|security|login|one[- ]time)\s+code\b|\bOTP\b/i.test(`${r?.subject||''} ${r?.snippet||''}`))
}

async function draftOne(row:any,name:string|null):Promise<string|null>{
  const apiKey=(globalThis as any).process?.env?.ANTHROPIC_API_KEY
  if(!apiKey)return null
  const prompt=`Write a short reply (2 to 4 sentences) to this email for ${name||'the user'} to review. Acknowledge what was asked, commit to nothing specific (no dates, amounts or decisions that are not in the email), and leave a [placeholder] where the user must add a fact. No subject line, no sign-off.
From: ${clean(row.from,120)}
Subject: ${clean(redactEmailAuthSecrets(String(row.subject||'')),160)}
Preview: ${clean(redactEmailAuthSecrets(String(row.snippet||'')),400)}`
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:'claude-haiku-4-5',max_tokens:220,messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(12000)})
    if(!res.ok)return null
    const data:any=await res.json()
    return String((data?.content||[]).filter((b:any)=>b?.type==='text').map((b:any)=>b.text).join('')).trim()||null
  }catch{return null}
}

export async function buildDraftRepliesReply(telegramId:number){
  const access=await gmailAccess(telegramId)
  if(access.disabled)return 'Google Workspace access is turned off in your privacy settings.'
  if(!access.connected)return buildGmailConnectReply(telegramId)
  const unread=await fetchUnreadEmails(access.accessToken,15)
  const people=await bulkDraftCandidates(unread)
  if(!people.length)return `None of your ${unread.length} unread emails look like they need a reply: they are newsletters, alerts, promotions or codes. Name one ("draft a reply to Nithin") and I'll draft it.`
  const {data:user}=await supabaseAdmin.from('users').select('name').eq('telegram_id',telegramId).maybeSingle()
  const picked=people.slice(0,3)
  const drafts=await Promise.all(picked.map(r=>draftOne(r,user?.name||null)))
  const blocks=picked.map((r,i)=>`${i+1}. *Re: ${clean(redactEmailAuthSecrets(String(r.subject||'(no subject)')),120)}*\nTo: ${clean(r.from,120)}\n${drafts[i]||'(I could not write this draft just now; ask again for this one.)'}`)
  const skipped=unread.length-people.length
  return `✍️ *Draft replies* (${picked.length} of ${people.length} emails from people${skipped?`; ${skipped} newsletters, alerts or codes skipped`:''})\n\n${blocks.join('\n\n')}\n\nThese are drafts only. Nothing was sent. Tell me what to change in any of them.`
}

/** The newest email from someone whose name or address contains `name`, received after `sinceIso`. Null when none
 * or when Gmail cannot be read (the caller then sends the plain reminder). */
export async function latestEmailFrom(telegramId:number,name:string,sinceIso:string):Promise<{subject:string;at:string}|null>{
  const access=await gmailAccess(telegramId)
  if(!access.connected)return null
  const rows=await fetchLatestEmails(access.accessToken,30)
  const needle=String(name||'').toLowerCase().split(/\s+/)[0]
  const since=Date.parse(sinceIso)
  const hit=rows.find((r:any)=>String(r.from||'').toLowerCase().includes(needle)&&Number(r.internalDate||Date.parse(r.date||''))>since)
  return hit?{subject:clean(redactEmailAuthSecrets(String(hit.subject||'')),120),at:new Date(Number(hit.internalDate||Date.parse(hit.date))).toISOString()}:null
}


// Duet 03 (29 Oct live): "Which emails am I waiting on replies for?" read every open loop for 68 s and mixed in
// non-email items. The answer is in Sent mail: threads where you wrote last, to a person, more than a day ago.
export type AwaitingReply={to:string;subject:string;sentAt:number}
export function awaitingRepliesFrom(threads:{subject:string;messages:{from:string;to:string;labelIds:string[];internalDate:number;subject:string}[]}[],myEmail:string,now=Date.now()):AwaitingReply[]{
  const me=String(myEmail||'').toLowerCase()
  const out:AwaitingReply[]=[]
  for(const t of threads){
    const last=t.messages[t.messages.length-1]
    if(!last||!last.labelIds.includes('SENT'))continue
    if(now-last.internalDate<20*3600_000)continue
    const to=String(last.to||'').split(',')[0].trim()
    const addr=(to.match(/<([^>]+)>/)?.[1]||to).toLowerCase()
    if(!addr||(me&&addr===me)||AUTOMATED_SENDER.test(addr)||/\b(?:support|help|billing|team|hello|contact)@/i.test(addr))continue
    const name=clean(to.replace(/<[^>]+>/,'').replace(/"/g,''),60)||addr
    out.push({to:name,subject:clean(redactEmailAuthSecrets(String(last.subject||t.subject||'(no subject)')).replace(/^(?:re|fwd?):\s*/i,''),90),sentAt:last.internalDate})
  }
  return out.sort((a,b)=>a.sentAt-b.sentAt).slice(0,8)
}
export function formatAwaitingReplies(rows:AwaitingReply[],now=Date.now()){
  if(!rows.length)return '📨 Nobody owes you a reply right now. Every email you sent in the last 3 weeks has an answer, or was sent less than a day ago.'
  const ago=(t:number)=>{const d=Math.floor((now-t)/86400_000);return d<=1?'yesterday':`${d} days ago`}
  const first=rows[0].to.split(/\s+/)[0]
  return `📨 *Waiting on replies* (${rows.length})\n\n${rows.map((r,i)=>`${i+1}. ${r.to} — “${r.subject}” · sent ${ago(r.sentAt)}`).join('\n')}\n\nWant a nudge? Say *remind me if ${first} doesn't reply by Friday* and I'll check Gmail on Friday before reminding you.`
}
export async function awaitingRepliesReply(telegramId:number):Promise<string|null>{
  const access=await gmailAccess(telegramId)
  if(!access.connected)return null
  const threads=await searchGmailThreads(access.accessToken,'in:sent newer_than:21d',15)
  return formatAwaitingReplies(awaitingRepliesFrom(threads as any,String(access.email||'')))
}
