// AskGogo Feature Intent Router
// Existing deterministic routing remains byte-for-byte in feature-intents-legacy.
// Muse-style Agent handling runs ONLY when legacy routing declines the turn.

import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
import { tryRunWhatsAppAgent } from '@/lib/agent/whatsapp-bridge'
import { dispatchThroughSameBrain } from '@/lib/agent/same-brain'
import { isEventCredentialRetrieval, retrieveEventCredential } from '@/lib/agent/booking-closure'
import { queueBookingClosure } from '@/lib/agent/booking-queue'
import { buildGmailConnectUrl } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isBookingOrEventLinkText } from '@/lib/services/whatsapp-preview-routing'
import { sendWhatsAppMediaMessage } from '@/lib/channels/whatsapp'
import { addToListDetailed, formatAddResult, formatList, getList, normalizeListName } from '@/lib/lists'
import { normalizeNaturalReminderSave, parseNumberedChecklist, saveNaturalReminder } from '@/lib/bot/handlers/natural-command-routing'
import { normalizeUserInputForRouting } from '@/lib/bot/input-normalizer'
import { clearFollowupState, getLatestFollowupState, isStrictlyFreshFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'
import { isActiveListShow, parseActiveListAdd, parseExplicitListShow } from '@/lib/bot/handlers/list-conversation-context'
import { parseCalendarCreate, getCalendarTokens, createCalendarConflictEvent } from '@/lib/bot/handlers/calendar-actions'
import { resolvePendingCalendar, looksLikeNewCommand } from '@/lib/bot/pending-followup'
import { fetchPrimaryCalendarEvents } from '@/lib/google-calendar'
import { RESERVED_SHOW_NAMES } from '@/lib/data/reserved-names'
import type { ResolvedUser } from '@/lib/bot/resolve-user'
import { capabilityIsOff, parseAutonomyCommand, tryRunAdaptiveAutonomyCommand } from '@/lib/agent/adaptive-autonomy'

function isSimpleWorkspaceRead(text:string) {
  const t=String(text||'')
  const gmail=/\b(email|emails|gmail|inbox|mail)\b/i.test(t) && /\b(find|show|read|latest|recent|unread|search|look for|check|attached|attachment|brief)\b/i.test(t) && !/\b(send|forward|compose)\b/i.test(t)
  const contact=/\b(contact|contacts|email address|phone number|how do i reach|address for)\b/i.test(t) && /\b(find|show|look up|search|resolve|get|what is|what's)\b/i.test(t)
  const drive=/\b(google drive|drive file|google doc|google sheet|in drive)\b/i.test(t) && /\b(find|show|read|search|open|use|look for|get)\b/i.test(t)
  return gmail||contact||drive
}

function isWorkspaceConnect(text:string) {
  const t=String(text||'').toLowerCase()
  return /\b(connect|link|reconnect|refresh)\b/.test(t) && /\b(gmail|google workspace|google account|email)\b/.test(t)
}

function normListItem(value:unknown){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ')}

async function setActiveList(telegramId:number,listName:string){
  await saveFollowupState(telegramId,'active_list',{listName,created_at:new Date().toISOString()})
}

async function getActiveListName(telegramId:number){
  const state=await getLatestFollowupState(telegramId,'active_list')
  if(!state||!isStrictlyFreshFollowupState(state,30))return null
  const name=normalizeListName(String(state.payload?.listName||''))
  return name||null
}

function parseSnoozeDuration(text:string): { ms:number; label:string } | null {
  const raw=String(text||'').trim().toLowerCase()
  const match=raw.match(/^snooze\s+(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i)
  if(match){
    const amount=Math.max(1,Number(match[1]))
    const unit=match[2].toLowerCase()
    if(['m','min','mins','minute','minutes'].includes(unit)) return {ms:amount*60*1000,label:`in ${amount} minute${amount===1?'':'s'}`}
    if(['h','hr','hrs','hour','hours'].includes(unit)) return {ms:amount*60*60*1000,label:`in ${amount} hour${amount===1?'':'s'}`}
    if(['d','day','days'].includes(unit)) return {ms:amount*24*60*60*1000,label:amount===1?'tomorrow':`in ${amount} days`}
  }
  return null
}

async function tryHandleSnoozeCommand(telegramId:number,phone:string,text:string):Promise<string|null>{
  const parsed=parseSnoozeDuration(text)
  if(!parsed)return null

  // A fired reminder may already have been re-armed with sent=false while retaining sent_at.
  // Bind snooze to the most recently fired reminder by sent_at, regardless of current sent state.
  const thirtyMinsAgo=new Date(Date.now()-30*60*1000).toISOString()
  const {data:recentFired,error}=await supabaseAdmin
    .from('reminders')
    .select('id,message,is_recurring,recurring_pattern,whatsapp_to,timezone,chat_id,telegram_id,sent_at')
    .eq('telegram_id',telegramId)
    .gte('sent_at',thirtyMinsAgo)
    .order('sent_at',{ascending:false})
    .limit(1)
  if(error){console.error('SNOOZE_RECENT_REMINDER_LOOKUP_FAILED:',error.message);return null}
  const reminder=recentFired?.[0]
  if(!reminder)return null

  const newRemindAt=new Date(Date.now()+parsed.ms).toISOString()

  if(reminder.is_recurring){
    // Keep the normal recurrence intact. Snooze creates a one-off replay only.
    const {error:insertError}=await supabaseAdmin.from('reminders').insert({
      telegram_id:reminder.telegram_id,
      chat_id:reminder.chat_id ?? reminder.telegram_id,
      message:reminder.message,
      remind_at:newRemindAt,
      sent:false,
      is_recurring:false,
      recurring_pattern:null,
      whatsapp_to:reminder.whatsapp_to || phone,
      timezone:reminder.timezone || 'Asia/Kolkata',
    })
    if(insertError){
      console.error('RECURRING_SNOOZE_INSERT_FAILED:',reminder.id,insertError.message)
      return `I couldn't snooze that reminder just now. Please try once more.`
    }
  }else{
    const {error:updateError}=await supabaseAdmin
      .from('reminders')
      .update({remind_at:newRemindAt,sent:false})
      .eq('id',reminder.id)
    if(updateError){
      console.error('REMINDER_SNOOZE_UPDATE_FAILED:',reminder.id,updateError.message)
      return `I couldn't snooze that reminder just now. Please try once more.`
    }
  }

  return `⏰ Snoozed! I'll remind you about *${reminder.message}* again *${parsed.label}*.`
}

type CalendarApprovalPayload={
  title:string
  startIso:string
  endIso:string
  displayTime:string
  created_at:string
}

function istOffsetIso(parts:{year:number;month:number;day:number;hour:number;minute:number}){
  const yyyy=String(parts.year)
  const mm=String(parts.month).padStart(2,'0')
  const dd=String(parts.day).padStart(2,'0')
  const hh=String(parts.hour).padStart(2,'0')
  const min=String(parts.minute).padStart(2,'0')
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+05:30`
}

function calendarDisplay(iso:string){
  return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(iso))
}

function approvalReply(payload:CalendarApprovalPayload,conflict?:string){
  return (
    `📅 *Ready to add — approval required*\n\n`+
    `${payload.title}\n${payload.displayTime}\nDuration: 30 mins\n`+
    (conflict?`\n⚠️ Conflict: ${conflict}\n`:'')+
    `\nNothing has been added yet.\nReply *yes* to add it, or *cancel* to leave your calendar unchanged.`
  )
}

async function stageCalendarApproval(telegramId:number,payload:CalendarApprovalPayload,accessToken:string){
  let conflict:string|undefined
  try{
    const start=new Date(payload.startIso)
    const dayStart=new Date(start);dayStart.setUTCHours(0,0,0,0)
    const dayEnd=new Date(dayStart);dayEnd.setUTCDate(dayEnd.getUTCDate()+1)
    const events=await fetchPrimaryCalendarEvents(accessToken,dayStart.toISOString(),dayEnd.toISOString(),'GCAL_APPROVAL_CONFLICT_CHECK_FAILED')
    const s=new Date(payload.startIso).getTime(),e=new Date(payload.endIso).getTime()
    const hit=(events||[]).find((x:any)=>{
      const xs=x?.start?.dateTime?new Date(x.start.dateTime).getTime():NaN
      const xe=x?.end?.dateTime?new Date(x.end.dateTime).getTime():NaN
      return Number.isFinite(xs)&&Number.isFinite(xe)&&xs<e&&xe>s
    })
    if(hit)conflict=`${hit.summary||'Calendar event'} at ${calendarDisplay(hit.start.dateTime)}`
  }catch(err){console.error('CALENDAR_APPROVAL_CONFLICT_CHECK_FAILED:',err)}
  await saveFollowupState(telegramId,'calendar_create_approval',payload)
  return approvalReply(payload,conflict)
}

async function tryHandleCalendarApproval(telegramId:number,text:string):Promise<string|null>{
  const raw=String(text||'').trim()
  // WhatsApp quick-reply titles include presentation emoji (e.g. "✅ Yes, add it").
  // Normalize those before approval matching so the calendar capability owns the
  // approval turn instead of letting it fall through to a generic/LLM handler.
  const approvalText=raw.replace(/^[\s↩️↪️✅☑️✔️❌✖️🗓️📅]+/u,'').trim()
  const cancel=/^(cancel|no|don't add|do not add|leave it)$/i.test(approvalText)
  if(cancel){
    const pending=await getLatestFollowupState(telegramId,'calendar_create_approval')
    if(pending&&isStrictlyFreshFollowupState(pending,15)&&pending.payload?.startIso&&!pending.payload?.consumed){
      await clearFollowupState(telegramId,'calendar_create_approval')
      return `❌ Cancelled — nothing was added to your calendar.`
    }
  }

  const confirm=/^(yes(?:,?\s+add it)?|yeah|yep|approve|approved|confirm|confirmed|add it|go ahead)$/i.test(approvalText)
  if(confirm){
    const pending=await getLatestFollowupState(telegramId,'calendar_create_approval')
    if(pending&&isStrictlyFreshFollowupState(pending,15)&&pending.payload?.startIso&&!pending.payload?.consumed){
      // Consume before the external write. A successful Google POST followed by
      // an uncertain readback must never leave a replayable approval that can duplicate.
      await saveFollowupState(telegramId,'calendar_create_approval',{consumed:true,created_at:new Date().toISOString()})
      const reply=await createCalendarConflictEvent(telegramId,pending.payload)
      if(reply){
        // Preserve actionable non-success responses from the create layer (limits,
        // provider errors, reconnect guidance) rather than disguising them as verify failures.
        const successShaped=/^\s*✅\s*\*?Calendar event added/i.test(reply)
        if(!successShaped)return reply
        // The feature-intent approval path is independent of the Agent approval
        // orchestrator. Verify the exact staged event against Google before consuming
        // approval or returning any success-shaped copy.
        const tokens=await getCalendarTokens(telegramId)
        if(!tokens.connected||!tokens.accessToken)return `I couldn't verify that calendar change, so I won't claim it was added.`
        const start=new Date(pending.payload.startIso)
        const dayStart=new Date(start.getTime());dayStart.setUTCHours(0,0,0,0)
        const dayEnd=new Date(dayStart.getTime());dayEnd.setUTCDate(dayEnd.getUTCDate()+1)
        let verified=false
        try{
          const events=await fetchPrimaryCalendarEvents(tokens.accessToken,dayStart.toISOString(),dayEnd.toISOString(),'GCAL_FEATURE_APPROVAL_VERIFY_FAILED')
          const norm=(v:string)=>String(v||'').toLowerCase().replace(/["“”']/g,'').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()
          const wanted=norm(String(pending.payload.title||''))
          const wantedStart=new Date(pending.payload.startIso).getTime()
          verified=(events||[]).some((ev:any)=>{
            const sameTitle=norm(String(ev?.summary||''))===wanted
            const actualStart=ev?.start?.dateTime?new Date(ev.start.dateTime).getTime():NaN
            return sameTitle&&Number.isFinite(actualStart)&&Math.abs(actualStart-wantedStart)<60000
          })
        }catch(err){console.error('CALENDAR_FEATURE_APPROVAL_VERIFY_FAILED:',err)}
        if(!verified){
          return `⚠️ I couldn't verify this event in Google Calendar, so I won't claim it was scheduled. Please don't retry yet.`
        }
        return reply
      }
      return `I couldn't add that calendar event just now. Please try again.`
    }
  }

  const tokens=await getCalendarTokens(telegramId)
  if(!tokens.connected||!tokens.accessToken)return null

  if(!looksLikeNewCommand(text)){
    const pendingCalendar=await getLatestFollowupState(telegramId,'pending_calendar')
    if(pendingCalendar&&isStrictlyFreshFollowupState(pendingCalendar,15)){
      const resolved=resolvePendingCalendar(pendingCalendar.payload||{},text)
      if(resolved?.remindAtIso){
        const start=new Date(resolved.remindAtIso)
        const end=new Date(start.getTime()+30*60*1000)
        const payload:CalendarApprovalPayload={
          title:String(pendingCalendar.payload?.title||'Meeting'),
          startIso:start.toISOString(),
          endIso:end.toISOString(),
          displayTime:calendarDisplay(start.toISOString()),
          created_at:new Date().toISOString(),
        }
        return await stageCalendarApproval(telegramId,payload,tokens.accessToken)
      }
    }
  }

  const createIntent:any=parseCalendarCreate(text)
  if(!createIntent||createIntent.needsTime||!createIntent.start||!createIntent.end)return null
  const payload:CalendarApprovalPayload={
    title:String(createIntent.title||'Meeting'),
    startIso:istOffsetIso(createIntent.start),
    endIso:istOffsetIso(createIntent.end),
    displayTime:calendarDisplay(istOffsetIso(createIntent.start)),
    created_at:new Date().toISOString(),
  }
  return await stageCalendarApproval(telegramId,payload,tokens.accessToken)
}

export async function routeFeatureIntent(
  phone: string,
  text: string,
  extra?: { telegramId?: number; caption?: string },
): Promise<string | null> {
  const normalized=normalizeUserInputForRouting(text)
  if(normalized.changed) console.info('INPUT_NORMALIZED_FOR_FEATURE_ROUTING:',{reasons:normalized.reasons,originalLength:String(text||'').length,normalizedLength:normalized.text.length})
  text=normalized.text

  // Autonomy controls must run before reminder/list/calendar specialists so
  // commands like "set calendar autonomy to auto" cannot be stolen by a noun router.
  if(extra?.telegramId){
    const autonomy=parseAutonomyCommand(text)
    if(autonomy){
      const actor={userId:String(extra.telegramId),legacyTelegramId:extra.telegramId,whatsappId:phone,name:'Gogo'}
      const result=await tryRunAdaptiveAutonomyCommand({actor,text})
      if(result?.text)return result.text
    }
  }

  if(extra?.telegramId){
    const snoozeReply=await tryHandleSnoozeCommand(extra.telegramId,phone,text)
    if(snoozeReply)return snoozeReply

    const calendarApprovalReply=await tryHandleCalendarApproval(extra.telegramId,text)
    if(calendarApprovalReply)return calendarApprovalReply
  }

  if (extra?.telegramId && isEventCredentialRetrieval(text)) {
    const ticket = await retrieveEventCredential(extra.telegramId, text)
    if (ticket) {
      await sendWhatsAppMediaMessage(phone, ticket.caption, ticket.mediaUrl).catch((err:any) => console.error('EVENT_TICKET_MEDIA_SEND_FAILED:', err?.message || err))
      return `Sent the provider-issued ticket/QR for *${ticket.title}*. It stays attached to the same Life Event.`
    }
  }

  if (extra?.telegramId && isBookingOrEventLinkText(text)) {
    const queued = await queueBookingClosure({ telegramId: extra.telegramId, text, whatsappTo: phone })
    if (queued) return queued.text
  }

  if (extra?.telegramId && normalizeNaturalReminderSave(text)) {
    if(await capabilityIsOff(extra.telegramId,'reminders')){
      return 'Reminders are currently off in your Gogo autonomy settings. Say *set reminders autonomy to auto* (or *ask*) to turn them back on.'
    }
    try {
      return await saveNaturalReminder({ telegramId: extra.telegramId, whatsappTo: phone, text })
    } catch (err:any) {
      console.error('NATURAL_REMINDER_SAVE_FAILED:', err?.message || err)
      return `I understood this as a reminder, but I couldn't save it just now. Please try once more — I won't save it as a note instead.`
    }
  }

  const checklist = extra?.telegramId ? parseNumberedChecklist(text) : null
  if (extra?.telegramId && checklist) {
    if(await capabilityIsOff(extra.telegramId,'lists')){
      return 'Lists are currently off in your Gogo autonomy settings. Say *set lists autonomy to auto* (or *ask*) to turn them back on.'
    }
    try {
      const listName = normalizeListName(checklist.listName)
      const result = await addToListDetailed(extra.telegramId, listName, checklist.items)
      const stored = await getList(extra.telegramId, listName)
      const storedItems = Array.isArray(stored?.items) ? stored.items : []
      const pendingText = new Set(storedItems.filter((x:any)=>!x?.done).map((x:any)=>normListItem(x?.text)))
      const missing = checklist.items.filter(item=>!pendingText.has(normListItem(item)))
      if (missing.length) throw new Error(`checklist_persistence_incomplete:${missing.length}`)
      await setActiveList(extra.telegramId,listName)
      return formatAddResult(listName, { ...result, items: storedItems })
    } catch (err:any) {
      console.error('NUMBERED_CHECKLIST_SAVE_FAILED:', err?.message || err)
      return `I recognised this as a checklist, but I couldn't save every item just now. Please try once more — I won't turn it into an unrelated note.`
    }
  }

  // Explicit list display establishes short-lived conversational list context.
  // No LLM/memory inference is allowed here.
  if(extra?.telegramId){
    const explicitRaw=parseExplicitListShow(text)
    if(explicitRaw){
      const listName=normalizeListName(explicitRaw)
      if(listName&&!RESERVED_SHOW_NAMES.has(listName)){
        const list=await getList(extra.telegramId,listName)
        if(list){await setActiveList(extra.telegramId,list.list_name);return formatList(list.list_name,list.items||[])}
      }
    }

    const followupItems=parseActiveListAdd(text)
    if(followupItems){
      if(await capabilityIsOff(extra.telegramId,'lists')){
        return 'Lists are currently off in your Gogo autonomy settings. Say *set lists autonomy to auto* (or *ask*) to turn them back on.'
      }
      const listName=await getActiveListName(extra.telegramId)
      if(listName){
        const result=await addToListDetailed(extra.telegramId,listName,followupItems)
        await setActiveList(extra.telegramId,listName)
        return formatAddResult(listName,result)
      }
    }

    if(isActiveListShow(text)){
      const listName=await getActiveListName(extra.telegramId)
      if(listName){
        const list=await getList(extra.telegramId,listName)
        if(list){await setActiveList(extra.telegramId,list.list_name);return formatList(list.list_name,list.items||[])}
      }
    }
  }

  const legacy = await routeLegacyFeatureIntent(phone, text, extra)
  if (legacy) return legacy
  if (!extra?.telegramId) return null

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id,telegram_id,whatsapp_id,name,tier,timezone,platform')
      .eq('telegram_id', extra.telegramId)
      .maybeSingle()
    if (error) {
      console.error('WHATSAPP_AGENT_USER_LOOKUP_FAILED:', error.message)
      return null
    }
    if (!data?.id) return null

    const user: ResolvedUser = {
      id: data.id,
      channel: 'whatsapp',
      externalUserId: phone,
      telegramId: Number(data.telegram_id),
      whatsappId: String(data.whatsapp_id || phone),
      name: String(data.name || 'Friend'),
      tier: String(data.tier || 'free'),
      platform: 'whatsapp',
      timezone: String(data.timezone || 'Asia/Kolkata'),
      rawUser: data,
    }
    const actor={ userId:String(user.id),legacyTelegramId:user.telegramId, whatsappId:String(user.whatsappId||phone),name:String(user.name||'Gogo') }

    if (isWorkspaceConnect(text)) {
      const url=buildGmailConnectUrl(user.telegramId)
      return url
        ? `Connect Google Workspace here:\n${url}\n\nThis gives Gogo only the read-only Gmail, Contacts and Drive context you approve. Sending email, changing files or scheduling still requires the normal approval boundary.`
        : 'Google Workspace connection is temporarily unavailable. Please try again shortly.'
    }

    if (isSimpleWorkspaceRead(text)) {
      const result=await dispatchThroughSameBrain({actor,text})
      return result.text || null
    }

    // Calendar/meeting/event/appointment commands belong to processIncomingMessage's
    // calendar handlers. Do not re-enter the generic agent bridge here: reminder
    // mutation parsing is intentionally broad and would otherwise steal reschedules.
    const hasCalendarNoun = /\b(?:meeting|meetings|calendar|event|events|appointment|appointments)\b/i.test(text)
    if (!hasCalendarNoun) {
      const agent = await tryRunWhatsAppAgent({ user, text })
      if(agent?.text)return agent.text
    }

    if(normalized.changed){
      const repaired=await dispatchThroughSameBrain({actor,text})
      return repaired.text||null
    }
    return null
  } catch (err: any) {
    console.error('WHATSAPP_AGENT_BRIDGE_FAILED:', err?.message || err)
    // Infrastructure/execution failure is not a routing non-match. Fail closed
    // instead of falling through to processIncomingMessage/plain LLM.
    return 'I hit a problem while running that AskGogo action, so I stopped instead of guessing or falling back to an unverified answer. Please try again shortly.'
  }
}