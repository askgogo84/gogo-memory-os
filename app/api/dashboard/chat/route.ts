import { tryRunWorkspaceDriveContext } from '@/lib/agent/workspace-drive-context'
import { isPlainInfoQuestion, isPersonalDataReadQuestion } from '@/lib/agent/plain-question'
import { tryPriceComparison } from '@/lib/commerce/price-comparison'
import {runCompoundShoppingFriendRequests} from '@/lib/bot/compound-shopping-friend'
import {detectFriendReminder, getPendingFriend, isFriendReminderFollowupCandidate} from '@/lib/bot/handlers/friend-reminders'
import {namesRetailerPriceRead} from '@/lib/commerce/comparison-model'
import {tryRunContentWorkflow} from '@/lib/agent/content-workflow-entry'
import { tryMeetingShareFollowup } from '@/lib/agent/meeting-share-followup'
import { tryCreateGoldRateWatchFromCommand } from '@/lib/agent/gold-watch'
import { tryCreateInboxTriageWatchFromCommand, tryCreateWebWatchFromCommand, tryUpdateWebWatchFromCommand, tryGetWatcherStatusFromCommand, tryRunPriceWatchClarification, tryStopWatcherFromCommand } from '@/lib/agent/watch-command'
import { tryTypedTimeRouting } from '@/lib/agent/typed-time-routing'
import { tryFoodComparison } from '@/lib/agent/food-comparison'
import { recordDecisionLearning } from '@/lib/agent/decision-learning'
import { isSameBrainIntrospection, trySameBrainIntrospection } from '@/lib/agent/brain-introspection'
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { buildReferenceFxReply } from '@/lib/bot/handlers/reference-fx'
import { getSession } from '@/lib/dashboard/session'
import { meterAs } from '@/lib/metering/core'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { routeFeatureIntent } from '@/lib/feature-intents'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { isDecisionRecallQuery } from '@/lib/agent/recall-query'
import { isConnectionCapabilityQuery, tryGetAutonomyStatus } from '@/lib/agent/autonomy-status'
import { parseTaskStatusQuery, tryGetTaskStatus } from '@/lib/agent/task-status'
import { isLinkVaultSaveRequest, isLinkVaultQuery } from '@/lib/services/link-vault'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { detectDashboardDayIntent, getDashboardDayReply } from '@/lib/dashboard/day-chat'
import { isPublicTravelResearchRequest, isTravelResearchDetailsReply, tryRunTravelResearch } from '@/lib/agent/travel-research'
import { hardenTravelResearchResult } from '@/lib/agent/travel-research-sanitize'
import { tryRunGeneralPlan } from '@/lib/agent/general-planner'
import { tryAccountSiteAnswer } from '@/lib/agent/account-site-gate'
import { otpReply } from '@/lib/agent/provider-booking'
import { isStandaloneWorkspaceMeetingPrep, tryPrepareWorkspaceMeetingPlan } from '@/lib/agent/workspace-meeting-plan'
import { resolveAgentActor } from '@/lib/agent/actor'
import { tryResolvePendingQuestion } from '@/lib/bot/pending-question-resolver'
import { tryFlightBooking } from '@/lib/agent/flight-booking'
import { observeShadowBrainTurn } from '@/lib/agent/shadow-brain'
import { tryUnderstandFirst } from '@/lib/agent/understand-first'
import { isGroundedReminderCommand, jevClarificationReply } from '@/lib/agent/jev-router'
import { parseApproxLocation } from '@/lib/dashboard/approx-location'
import { recordShadowRouterOutcome } from '@/lib/agent/shadow-router-outcome'
import { detectReadOnlyScheduleRequest, readTomorrowSchedule } from '@/lib/agent/read-only-schedule'
import { tryRunAppointmentResearch } from '@/lib/agent/appointment-research'
import { tryRunAppointmentFollowup } from '@/lib/agent/appointment-followup'
import { queueRestaurantReservationResearch } from '@/lib/agent/restaurant-reservation'
import { tryRunBrowserCommand } from '@/lib/agent/browser-command'
import { tryRunTrainResearch } from '@/lib/agent/train-research'
import { handleInboxReplyRead } from '@/lib/agent/open-loops'
import { tryRunExpiryReminderPlan } from '@/lib/agent/compound-planner'
import { tryCancelRunFromChat } from '@/lib/agent/run-cancel'
import { isTicketRetrievalAsk, buildTicketRetrievalReply } from '@/lib/services/asset-memory'

// Request timing: mark(label) after each awaited step; a step slower than TIMING_THRESHOLD_MS (250)
// logs one TIMING line. Inlined (not imported) so test harnesses with strict dependency maps load it.
function startTrace(surface: string) {
  const threshold = Number((typeof process !== 'undefined' && process.env?.TIMING_THRESHOLD_MS) || 120)
  const started = Date.now(); let last = started
  return { mark(step: string) { const now = Date.now(), ms = now - last; last = now; if (ms >= threshold) console.log('TIMING:', JSON.stringify({ surface, step, ms, total: now - started })) } }
}


export const dynamic = 'force-dynamic'

// Round 6 (#7): redaction can land inside a link's address ("…/[sensitive detail withheld].cms"); such a link is
// broken, so keep its words and drop the address. Inlined so strict route harnesses keep their dependency maps.
function safeReplyText(raw: string): string {
  const text = redactSecretShapedText(raw)
  if (!/detail withheld\]/i.test(text)) return text
  const marker = /\[(?:sensitive |authentication )?detail withheld\]/i
  return text
    .replace(/\[([^\]]*?)\]\(([^)]*)\)/g, (m, label, href) => (!marker.test(href) && !marker.test(label) ? m : marker.test(label) ? '' : label))
    .replace(/(?:https?:\/\/|www\.)\S*?\[(?:sensitive |authentication )?detail withheld\]\S*/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
}

// "What are my reminders?" / "show my reminders for tomorrow": a read of saved reminders, no change asked.
// Inlined on top of isGroundedReminderCommand so route harnesses with strict dependency maps load it unchanged.
function isReminderReadOnlyAsk(text: string): boolean {
  const t = String(text || '').trim()
  return t.length <= 120 && isGroundedReminderCommand(t) && /\breminders?\b/i.test(t)
    && !/\b(?:set|create|add|make|schedule|remind me|cancel|delete|remove|stop|skip|snooze|move|reschedule|change|update|edit)\b/i.test(t)
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).host === req.nextUrl.host } catch { return false }
}

function cleanHistory(role: string, raw: string): string | null {
  const text = String(raw || '').trim()
  if (!text) return null
  if (/^\[(?:image_media|pending_[a-z_]+\]|completed_skin_check|button:|dashboard link sent)/i.test(text)) return null
  if (role === 'user' && /^\[(?:asset|asset pdf|image|image note|food photo|image ticket|pdf|pdf document|meeting audio|typed meeting notes)\]/i.test(text)) {
    const trailing = text.replace(/^\[[^\]]+\]\s*/i, '').trim()
    return trailing || 'Shared something with Gogo'
  }
  return safeReplyText(text)
}

async function resolveDashboardUser(telegramId: string) {
  const tg = parseInt(telegramId, 10)
  if (!Number.isFinite(tg)) return null
  const { data } = await supabaseAdmin
    .from('users')
    .select('telegram_id, whatsapp_id, name')
    .eq('telegram_id', tg)
    .maybeSingle()
  return data || null
}

async function saveConversation(telegramId: number | string, userText: string, assistantText: string) {
  const { error } = await supabaseAdmin.from('conversations').insert([
    { telegram_id: telegramId, role: 'user', content: userText },
    { telegram_id: telegramId, role: 'assistant', content: assistantText },
  ])
  if (error) console.error('DASHBOARD_CHAT_CONVERSATION_SAVE_FAILED:', error.message)
}

export async function GET(req?: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await resolveDashboardUser(session.telegramId)
  if (!user) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })

  // Duet parity step 4: channels. ?thread=<id> shows that channel; no param shows the one ongoing thread (everything
  // not in a channel, WhatsApp included). Before the thread_id migration the plain view still works.
  const threadParam = (() => { try { return new URL(String((req as any)?.url || '')).searchParams.get('thread') || '' } catch { return '' } })()
  let threadId: string | null = null
  if (threadParam) {
    const ctx = await import('@/lib/agent/thread-context').catch(() => null)
    const thread = await ctx?.resolveThreadForUser(String(user.telegram_id), threadParam).catch(() => null)
    if (!thread) return NextResponse.json({ error: 'channel_not_found' }, { status: 404 })
    threadId = thread.id
  }
  const historyQuery = (scoped: boolean) => {
    let q: any = supabaseAdmin
      .from('conversations')
      .select(scoped ? 'role, content, created_at, thread_id' : 'role, content, created_at')
      .eq('telegram_id', user.telegram_id)
      .in('role', ['user', 'assistant'])
    if (scoped && threadId) q = q.eq('thread_id', threadId)
    return q.order('created_at', { ascending: false })
      // Reverse below displays each tied batch as user then assistant.
      .order('role', { ascending: true })
      .limit(threadId || !scoped ? 50 : 120)
  }
  // Main view: rows outside channels (filtered here, so it also works before the thread_id column exists).
  let { data, error } = await historyQuery(true)
  if (error && threadId) return NextResponse.json({ messages: [], name: user.name || 'Gogo', channelsNotReady: true })
  if (error) ({ data, error } = await historyQuery(false))
  if (!error && !threadId) data = (data || []).filter((row: any) => !row?.thread_id).slice(0, 50)

  if (error) return NextResponse.json({ error: 'history_failed' }, { status: 500 })
  const messages = (data || [])
    .reverse()
    .map((row: any) => ({
      role: row.role,
      content: cleanHistory(row.role, row.content),
      createdAt: row.created_at,
    }))
    .filter((row: any) => row.content)

  return NextResponse.json({ messages, name: user.name || 'Gogo' })
}

async function callPlanWasLastReply(telegramId:number|string){
  // A bare "yes" goes to the call module only when Gogo's latest message is a call plan (21 Oct live: "Yes" fell
  // through to chat, which claimed it was calling). Read here so other "yes" replies never load the module.
  try{
    const {data}=await supabaseAdmin.from('conversations').select('role,content').eq('telegram_id',telegramId).order('created_at',{ascending:false}).limit(3)
    return String((data||[]).find((r:any)=>r.role==='assistant')?.content||'').includes('CALL PLAN')
  }catch{return false}
}

export async function POST(req: NextRequest) { return withChatChannel(req) }

async function handleChatPost(req: NextRequest) {
  const __trace = startTrace('web')
  if (!sameOrigin(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const session = await getSession()
  __trace.mark('session')
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const user = await resolveDashboardUser(session.telegramId)
  __trace.mark('user')
  if (!user) return NextResponse.json({ error: 'user_not_found' }, { status: 404 })
  if (!user.whatsapp_id) return NextResponse.json({ error: 'whatsapp_not_linked' }, { status: 409 })
  meterAs(session.telegramId, 'dashboard')

  const body = await req.json().catch(() => null) as any
  __trace.mark('body')
  let text = String(body?.text || '').trim().slice(0, 2000)
  if (!text) return NextResponse.json({ error: 'empty_message' }, { status: 400 })

  try {
    const actor = await resolveAgentActor({ telegramId:String(session.telegramId), surface:'web' })
    __trace.mark('actor')
    // Secondary authentication belongs only in the owner's secure takeover.
    const loginCode = text.length <= 24 && /\d{4}/.test(text.replace(/[\s-]/g, '')) ? otpReply(text) : null
    if (loginCode) {
      const {humanAuthTakeoverReply,shouldWithholdAuthenticationCode}=await import('@/lib/agent/browser-auth-notice')
      if(await shouldWithholdAuthenticationCode(user.telegram_id,text)){
        const reply=await humanAuthTakeoverReply(user.telegram_id)
        __trace.mark('reply')
        await saveConversation(user.telegram_id,'[authentication code withheld]',reply)
        return NextResponse.json({text:reply,handledBy:'human-auth-required'})
      }
    }
    // Round 6 (#34, #31, #49, #48): "Hi", "help", "What can you do?" and "What's pending?" get the same approved
    // replies as WhatsApp, instantly, before any slow matcher (the dashboard Hi took 25 s and used the old intro).
    // Inlined matchers (same as lib/bot/handlers/whatsapp-direct-premium.ts and lib/bot/pending-summary.ts) and lazy
    // imports only on a match, so strict route harnesses keep their dependency maps.
    {
      const quick = text.toLowerCase().replace(/[’]/g, "'").replace(/[\s!.?,]+$/g, '').trim()
      const isHi = /^(?:hi+|hello|hey|hii|hola|namaste|start|\/start)(?:\s+(?:there|askgogo|gogo))?$|^askgogo$/.test(quick)
      const isHelp = /^(?:please\s+|pls\s+)?(?:\/?help|menu|commands|features|what (?:all )?can (?:you|askgogo|gogo) do(?: for me)?|what do you do|how do (?:i|you) use (?:you|askgogo|this)|show (?:me )?(?:the )?(?:help|menu|features|commands)|what are your features)$/.test(quick)
      if (isHi || isHelp) {
        const welcome: any = await import('@/lib/bot/handlers/welcome').catch(() => null)
        const reply = isHi ? welcome?.buildWelcomeBack?.(user.name) : welcome?.HELP_MENU
        if (typeof reply === 'string' && reply) {
          await saveConversation(user.telegram_id, text, reply)
          return NextResponse.json({ text: reply, handledBy: isHi ? 'welcome-back' : 'help-menu', status: 'completed' })
        }
      }
      const isPending = quick.length <= 60 && /^(?:so\s+|ok\s+|and\s+)?(?:what(?:'s| is| all is| else is)?\s+(?:still\s+)?(?:pending|left|open|outstanding)(?:\s+(?:for me|today|now|on my plate))?|anything\s+(?:still\s+)?(?:pending|left|open|outstanding)(?:\s+(?:for me|today))?|what(?:'s| is)\s+on my plate(?:\s+today)?|what do i (?:still )?(?:need|have) to do(?:\s+today)?|my pending (?:items|tasks|stuff)|pending (?:items|tasks|stuff)|show (?:me )?(?:what(?:'s| is) )?pending)$/.test(quick)
      if (isPending) {
        const pendingMod: any = await import('@/lib/bot/pending-summary').catch(() => null)
        const reply = typeof pendingMod?.buildPendingSummary === 'function' ? await pendingMod.buildPendingSummary(String(session.telegramId)).catch(() => null) : null
        if (typeof reply === 'string' && reply) {
          await saveConversation(user.telegram_id, text, reply)
          return NextResponse.json({ text: reply, handledBy: 'pending-summary', status: 'completed' })
        }
      }
    }
    // "What time is it in New York?" answers instantly (23 Oct live: 37 s through the general brain).
    if (text.length <= 80 && /\btime\b/i.test(text) && /\b(?:in|at)\s+[a-z]/i.test(text)) {
      const wt: any = await import('@/lib/bot/world-time').catch(() => null)
      const reply = typeof wt?.worldTimeReply === 'function' ? wt.worldTimeReply(text) : null
      if (typeof reply === 'string' && reply) {
        await saveConversation(user.telegram_id, text, reply)
        return NextResponse.json({ text: reply, handledBy: 'world-time', status: 'completed' })
      }
    }
    // Invite links on the dashboard too (23 Oct live: "Send me my invite link" / "my invites" only worked on WhatsApp).
    {
      const inv: any = /\binvite|\brefer/i.test(text) ? await import('@/lib/invites/core').catch(() => null) : null
      if (inv && (inv.isInviteLinkCommand(text) || inv.isMyInvitesCommand(text))) {
        let reply = `I couldn't get your invite link just now. Please try again in a minute.`
        try {
          const store: any = await import('@/lib/invites/store')
          const { code, remaining } = await store.getOrCreateInviteCode(Number(user.telegram_id), user.name || null)
          if (inv.isMyInvitesCommand(text)) reply = inv.myInvitesReply({ code, remaining, joined: await store.listJoinedFriends(Number(user.telegram_id)) })
          else { const r = inv.inviteLinkReply({ code, remaining }); reply = r.link ? `${r.text}\n\n${r.link}` : r.text }
        } catch (err: any) { console.error('DASHBOARD_INVITE_FAILED:', err?.message || err) }
        await saveConversation(user.telegram_id, text, reply)
        return NextResponse.json({ text: reply, handledBy: 'invite-links', status: 'completed' })
      }
    }
    // "Order milk on Swiggy Instamart" via the user's connected Swiggy account: three in-stock options, and a
    // 1/2/3 reply binds only while that list is Gogo's latest reply. Lazy so strict harnesses keep their maps.
    // Cheap pre-filter: only an Instamart mention or a bare 1/2/3-style pick loads the module.
    const instamartChat:any=(/\binstamart\b/i.test(text)||/^\s*(?:(?:add|pick|choose|select|take)\s+)?(?:the\s+)?(?:(?:option|number|no\.?|item)\s*)?#?\s*(?:[123](?:st|nd|rd)?|first|second|third)(?:\s+(?:one|option|item))?(?:\s+please)?\s*[.!]?\s*$/i.test(text))?await import('@/lib/commerce/instamart-chat').catch(()=>null):null
    const instamart=typeof instamartChat?.tryInstamartChat==='function'?await Promise.resolve().then(()=>instamartChat.tryInstamartChat({telegramId:actor.legacyTelegramId,text,surface:'web'})).catch((err:any)=>{console.error('INSTAMART_CHAT_FAILED:',String(err?.message||err).slice(0,160));return null}):null
    __trace.mark('instamart')
    if(instamart){
      await saveConversation(user.telegram_id,text,instamart.text)
      return NextResponse.json(instamart)
    }
    // Phone calls (Bolna): a call plan needs an explicit "yes call"; "test call me" rings the owner's own phone.
    const voiceMod:any=(/^\s*(?:yes[,!]?\s*)?(?:please\s+)?(?:go\s+ahead\s+and\s+)?(?:call|redial|phone|ring|test\s+call|do\s+a\s+test\s+call|make\s+a\s+test\s+call|place\s+the\s+call|try\s+again)\b|^\s*(?:no|don'?t\s+call|do\s+not\s+call|cancel\s+(?:the\s+)?call)[.!]?\s*$/i.test(text)||(/^\s*(?:yes|yeah|yep|yup|ok|okay|sure|go\s+ahead|do\s+it|please\s+do|haan|ha)(?:\s+please)?[.!]*\s*$/i.test(text)&&await callPlanWasLastReply(user.telegram_id)))?await import('@/lib/agent/voice-call').catch(()=>null):null
    const voice=typeof voiceMod?.tryVoiceCall==='function'?await Promise.resolve().then(()=>voiceMod.tryVoiceCall({actor,text,surface:'web'})).catch((err:any)=>{console.error('VOICE_CALL_FAILED:',String(err?.message||err).slice(0,160));return null}):null
    if(voice){
      await saveConversation(user.telegram_id,text,voice.text)
      return NextResponse.json(voice)
    }
    // Emails that need you: the attention card, its numbered actions ("not important 2", "draft 1") and learned rules.
    // Lazy and pre-filtered so strict harnesses keep their dependency maps.
    {
      const cmds:any=text.length<=140&&/\b(?:e-?mails?|mails?|inbox|flag(?:ging)?|undo|rule)\b|^\s*(?:not important|important|draft|remind|why|open|ignore|skip)\b[^\n]{0,40}\b[1-9]\b/i.test(text)?await import('@/lib/email/attention-commands').catch(()=>null):null
      if(cmds?.mightBeAttentionCommand?.(text)){
        const store:any=await import('@/lib/email/attention-store').catch(()=>null)
        const res=store?await Promise.resolve().then(()=>store.handleEmailAttentionCommand({actor,text})).catch((err:any)=>{console.error('EMAIL_ATTENTION_FAILED:',String(err?.message||err).slice(0,160));return null}):null
        if(res?.rewrite)text=res.rewrite
        else if(res){
          await saveConversation(user.telegram_id,text,res.text)
          return NextResponse.json(res)
        }
      }
    }
    // A short reply to the question Gogo just asked ("This Saturday 8pm" after "What time should I
    // book Toit for?") resumes that request before any feature matcher reads it as something new.
    // Resolved once per turn here; processIncomingMessage below is told so and skips the same reads.
    const pendingQuestionChecked = true
    const pendingAnswer = await tryResolvePendingQuestion({user:{telegramId:Number(user.telegram_id)},text,surface:'web',actor})
    __trace.mark('pendingAnswer')
    if(pendingAnswer?.rewrite){
      // "24k" right after "22K or 24K gold?": route the full request it completes, exactly as if typed.
      text=pendingAnswer.rewrite
    }else if(pendingAnswer){
      await saveConversation(user.telegram_id,text,pendingAnswer.text)
      return NextResponse.json(pendingAnswer)
    }
    const inboxReplyRead = await handleInboxReplyRead({actor,text})
    __trace.mark('inboxReplyRead')
    if(inboxReplyRead){
      await saveConversation(user.telegram_id,text,inboxReplyRead.text)
      return NextResponse.json(inboxReplyRead)
    }
    // Same run cancel as WhatsApp ("cancel that task", "stop the flight booking"). Owner-bound; reminders,
    // calendar, watches, lists, orders and Gmail are refused by the parser and keep their own paths.
    const runCancel = await tryCancelRunFromChat({telegramId:actor.legacyTelegramId},text,{surface:'web'})
    __trace.mark('runCancel')
    if(runCancel){
      await saveConversation(user.telegram_id,text,runCancel.text)
      return NextResponse.json(runCancel)
    }
    // Round 6 (#14): "Cancel the Monday review reminder" took 28 s (understand-first + planner) before the
    // deterministic reminder editor asked which one. A named reminder cancel/skip goes straight there.
    if (/^(?:please\s+)?(?:cancel|delete|remove|skip)\b/i.test(text) && /\breminders?\b/i.test(text)
        && !/\b(?:meeting|event|appointment|calendar|standup|task|watch|order|booking|subscription|friend)\b/i.test(text)) {
      const editor: any = await import('@/lib/bot/handlers/edit-reminder').catch(() => null)
      const lowered = text.toLowerCase().replace(/^please\s+/, '').trim()
      if (typeof editor?.editLatestReminder === 'function' && (editor.isCancelReminderCommand?.(lowered) || editor.isSkipReminderCommand?.(lowered))) {
        const reply = await Promise.resolve().then(() => editor.editLatestReminder(Number(user.telegram_id), text.replace(/^please\s+/i, ''))).catch(() => null)
        if (typeof reply === 'string' && reply) {
          await saveConversation(user.telegram_id, text, reply)
          return NextResponse.json({ text: safeReplyText(reply), handledBy: 'edit-reminder', status: 'completed' })
        }
      }
    }
    // One event id per turn, shared by the understand-first reading and the shadow router outcome.
    const shadowEventId = `web-${randomUUID()}`
    // Understand-first choke point, same as WhatsApp (docs/architecture/06-understand-first-shadow.md). Safe
    // live set only (after the inbox read and run cancel, which keep first refusal); anything else, a timeout or an error returns null and the routing below is unchanged.
    // R03 (22 Oct live): "How is Same Brain learning from my outcomes?" got a generic understand-first answer on the
    // dashboard; WhatsApp checks the measured learning report first. Same order here.
    const brainFirst = /\bsame brain\b|\bhave you (?:learnt|learned) (?:about|from) me\b/i.test(text) && isSameBrainIntrospection(text)
    const understoodReply = brainFirst ? null : await (async () => tryUnderstandFirst({ actor, surface:'web', text, eventId:shadowEventId, externalUserId:String(user.whatsapp_id), userName:user.name||'Gogo', registryChecked:pendingQuestionChecked }))()
      .catch((err:any) => { console.error('UNDERSTAND_FIRST_DASHBOARD_FAILED:', String(err?.message || err).slice(0,160)); return null })
    __trace.mark('understoodReply')
    if (understoodReply?.text) {
      if (!understoodReply.persisted) await saveConversation(user.telegram_id, text, understoodReply.text)
      // The chat shows mediaUrl as an image; a PDF ticket keeps its "Open original" link in the text instead.
      const pdfMedia = /^application\/pdf/i.test(String(understoodReply.mediaType || ''))
      return NextResponse.json(pdfMedia ? { ...understoodReply, mediaUrl: null, mediaType: null } : understoodReply)
    }
    // 20 Oct live: "Jailer qr code" on the dashboard reached same-brain ("I don't have access to your BookMyShow
    // or PVR account… the show's tonight") because #681's ticket retrieval was wired only into WhatsApp. Same
    // owner-bound path here: the ticket attached to the saved booking (then a saved ticket document), with the
    // image for the chat to show, or one honest line. Booking/buying/cancelling asks are not retrievals.
    if (isTicketRetrievalAsk(text)) {
      const ticket = await buildTicketRetrievalReply(Number(user.telegram_id), text, shadowEventId)
      __trace.mark('ticket')
      if (ticket) {
        // The chat renders mediaUrl as an image; a PDF ticket keeps its "Open original" link in the text.
        const image = Boolean(ticket.mediaUrl && /^image\//i.test(String(ticket.mediaType || '')))
        await saveConversation(user.telegram_id, text, ticket.text)
        return NextResponse.json({ text: ticket.text, mediaUrl: image ? ticket.mediaUrl : null, mediaType: image ? ticket.mediaType : null, handledBy: 'ticket-retrieval', status: 'completed', readOnly: true, mutated: false })
      }
    }
    // Same gold-rate watch as WhatsApp: "alert me if gold rate drops by 10%" is a rule, never a one-off quote.
    const goldWatch=await tryCreateGoldRateWatchFromCommand({actor,surface:'web',text})
    __trace.mark('goldWatch')
    if(goldWatch){
      await saveConversation(user.telegram_id,text,goldWatch.text)
      return NextResponse.json(goldWatch)
    }
    const contentDraft = await tryRunContentWorkflow(actor, text, `web-${randomUUID()}`)
    __trace.mark('contentDraft')
    if (contentDraft) return NextResponse.json(contentDraft)
    // Match WhatsApp's per-request routing before a whole-message handler can
    // combine different products or swallow a delegated reminder.
    const compoundEventId = `web-${randomUUID()}`
    const compoundReplies = await runCompoundShoppingFriendRequests(text, {
      checkPrice: async stepText => {
        const comparison = await tryPriceComparison({telegramId: actor.legacyTelegramId, text: stepText, surface: 'web'})
        __trace.mark('comparison')
        if (!comparison) throw new Error('compound_price_unhandled')
        await saveConversation(user.telegram_id, stepText, comparison.text)
        return comparison.text
      },
      prepareFriend: async (stepText, index) => {
        const reminder = await processIncomingMessage({channel: 'whatsapp', externalUserId: String(user.whatsapp_id),
          text: stepText, userName: user.name || 'Gogo', messageType: 'text', messageId: `${compoundEventId}:${index}`})
        return redactSecretShapedText(reminder.text)
      },
      readReminders: async (stepText, index) => {
        const reminder = await tryRunExpiryReminderPlan({actor, surface: 'web', text: stepText,
          messageId: `${compoundEventId}:${index}`})
        if (!reminder) throw new Error('compound_reminder_read_unhandled')
        await saveConversation(user.telegram_id, stepText, reminder.text)
        return redactSecretShapedText(reminder.text)
      },
      onError: (error, kind, index) => console.error('DASHBOARD_COMPOUND_STEP_FAILED:',
        {kind, index, error: error instanceof Error ? error.message : String(error)}),
    })
    if (compoundReplies) return NextResponse.json({text: compoundReplies.join('\n\n—\n\n'), handledBy: 'compound-shopping-friend'})
    // Keep the number/time/YES continuation with the same reminder state that
    // the compound request opened, rather than allowing a planner to claim it.
    if (detectFriendReminder(text) || (isFriendReminderFollowupCandidate(text) && await getPendingFriend(Number(user.telegram_id)))) {
      const reminder = await processIncomingMessage({channel: 'whatsapp', externalUserId: String(user.whatsapp_id),
        text, userName: user.name || 'Gogo', messageType: 'text', messageId: compoundEventId, pendingQuestionChecked})
      return NextResponse.json({text: redactSecretShapedText(reminder.text), handledBy: reminder.handledBy || 'same-brain'})
    }
    const watcherStatus=await tryGetWatcherStatusFromCommand({actor,text})
    __trace.mark('watcherStatus')
    if(watcherStatus){
      await saveConversation(user.telegram_id,text,watcherStatus.text)
      return NextResponse.json(watcherStatus)
    }
    // Same watch handling as WhatsApp. A price alert asks its one clarifying question (listed price or after
    // offers) before anything is saved, and "stop watching <name>" stops that watch by name. Both read the
    // sentence themselves and return nothing for anything else, so other messages continue below.
    const priceWatch=await tryRunPriceWatchClarification({actor,surface:'web',text})
    __trace.mark('priceWatch')
    if(priceWatch){
      await saveConversation(user.telegram_id,text,priceWatch.text)
      return NextResponse.json(priceWatch)
    }
    const watcherStop=await tryStopWatcherFromCommand({actor,text})
    __trace.mark('watcherStop')
    if(watcherStop){
      await saveConversation(user.telegram_id,text,watcherStop.text)
      return NextResponse.json(watcherStop)
    }
    // Inbox monitoring must create a real watcher before the generic planner
    // can turn the same request into an ordinary task with no scheduled checks.
    const inboxWatch=await tryCreateInboxTriageWatchFromCommand({actor,text,surface:'web'})
    __trace.mark('inboxWatch')
    if(inboxWatch){
      await saveConversation(user.telegram_id,text,inboxWatch.text)
      return NextResponse.json(inboxWatch)
    }
    const meetingReply=await tryMeetingShareFollowup({actor,text,surface:'web'})
    __trace.mark('meetingReply')
    if(meetingReply){
      await saveConversation(user.telegram_id,text,meetingReply.text)
      return NextResponse.json(meetingReply)
    }
    const foodComparison=(/\bcompar(?:e|ison|isons)\b/i.test(text)||namesRetailerPriceRead(text) ? await tryPriceComparison({telegramId:actor.legacyTelegramId,text,surface:'web'}) : null) || await tryFoodComparison({telegramId:actor.legacyTelegramId,text,surface:'web'})
    if(foodComparison){
      await saveConversation(user.telegram_id,text,foodComparison.text)
      return NextResponse.json(foodComparison)
    }
    // "book the cheapest" after a flight result, and the traveller details that follow (same as WhatsApp).
    const flightBooking=await tryFlightBooking({actor,surface:'web',text})
    __trace.mark('flightBooking')
    if(flightBooking){
      await saveConversation(user.telegram_id,text,flightBooking.text)
      return NextResponse.json(flightBooking)
    }
    const typedReply = await tryTypedTimeRouting({actor,text,surface:'web',messageId:`web-${randomUUID()}`})
    __trace.mark('typedReply')
    if(typedReply){
      await saveConversation(user.telegram_id,text,typedReply.text)
      return NextResponse.json(typedReply)
    }
    // Save an explicit persistent search before a one-shot planner can claim it.
    const webWatch = await tryUpdateWebWatchFromCommand({actor,text}) || await tryCreateWebWatchFromCommand({ actor, surface:'web', text })
    __trace.mark('webWatch')
    if (webWatch) {
      await saveConversation(user.telegram_id, text, webWatch.text)
      return NextResponse.json(webWatch)
    }
    const brainReply = await trySameBrainIntrospection({ actor, text })
    __trace.mark('brainReply')
    if (brainReply) {
      await saveConversation(user.telegram_id, text, brainReply.text)
      return NextResponse.json(brainReply)
    }
    let webObservation:Awaited<ReturnType<typeof observeShadowBrainTurn>>|null=null
    try {
      webObservation = await observeShadowBrainTurn({ actor, surface:'web', text, eventId:shadowEventId })
    } catch (shadowError:any) {
      console.error('SHADOW_BRAIN_DASHBOARD_FAILED:', String(shadowError?.message || shadowError).slice(0,180))
    }

    // Saved-object intent precedes provider words inside the object's caption.
    // A past decision or a link save is not a new booking/browser command.
    if(isConnectionCapabilityQuery(text)||isDecisionRecallQuery(text)||isLinkVaultSaveRequest(text)||isLinkVaultQuery(text)){
      const result=await processIncomingMessage({channel:'whatsapp',externalUserId:String(user.whatsapp_id),text,userName:user.name||'Gogo',messageType:'text',messageId:shadowEventId,semantic:webObservation?.jev,pendingQuestionChecked})
      __trace.mark('result')
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:result.handledBy||'same-brain',actualCapability:'memory'}).catch(()=>{})
      return NextResponse.json(result)
    }
    // Same task-status read as WhatsApp, before the general planner can treat it as a new request.
    // A named ask with no matching task returns null and routing continues.
    if (parseTaskStatusQuery(text)) {
      const taskStatus = await tryGetTaskStatus({ telegramId: actor.legacyTelegramId }, text) || await tryGetAutonomyStatus({ actor, text })
      __trace.mark('taskStatus')
      if (taskStatus) {
        await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:taskStatus.handledBy,actualCapability:'orchestrator',status:taskStatus.status,runId:taskStatus.runId}).catch(()=>{})
        await saveConversation(user.telegram_id, text, taskStatus.text)
        return NextResponse.json(taskStatus)
      }
    }
    const readOnlySchedule = detectReadOnlyScheduleRequest(text)
    if (readOnlySchedule) {
      const summary = await readTomorrowSchedule({ actor, scope: readOnlySchedule.scope, text })
      __trace.mark('summary')
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:'read-only-schedule',actualCapability:'calendar',status:'completed'}).catch(()=>{})
      await recordDecisionLearning({ actor, text, domain:'calendar', handler:'read-only-schedule', decisionId:shadowEventId, outcome:summary.calendarReadVerified?'verified_success':'unknown', verified:summary.calendarReadVerified }).catch(()=>{})
      await saveConversation(user.telegram_id, text, summary.text)
      return NextResponse.json({ text: summary.text, handledBy: 'read-only-schedule', status:'completed', readOnly:true, mutated:false })
    }

    const referenceFx=await buildReferenceFxReply(text)
    __trace.mark('referenceFx')
    if(referenceFx!==null){
      await saveConversation(user.telegram_id,text,referenceFx)
      return NextResponse.json({text:referenceFx,handledBy:'reference-fx',status:'completed',readOnly:true,mutated:false})
    }
    const dayIntent = detectDashboardDayIntent(text)
    if (dayIntent) {
      const dayReply = await getDashboardDayReply(session.telegramId, dayIntent)
      __trace.mark('dayReply')
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:'dashboard-day'}).catch(()=>{})
      await saveConversation(user.telegram_id, text, dayReply)
      return NextResponse.json({ text: dayReply, handledBy: 'dashboard-day' })
    }

    const driveContext = await tryRunWorkspaceDriveContext({actor,surface:'web',text})
    __trace.mark('driveContext')
    if (driveContext) {
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:driveContext.handledBy,actualCapability:'files',status:driveContext.status,runId:driveContext.runId}).catch(()=>{})
      await saveConversation(user.telegram_id,text,driveContext.text)
      return NextResponse.json(driveContext)
    }

    // Same as WhatsApp: provider research runs in the background and the result is messaged back, so the chat
    // never waits minutes on a provider page (20 Oct live: 191s inline on District 6).
    const restaurantReservation = await queueRestaurantReservationResearch({ actor, text, messageId: shadowEventId })
    __trace.mark('restaurantReservation')
    if (restaurantReservation) {
      const suffix = restaurantReservation.status === 'waiting_approval'
        ? '\n\nOpen Gogo Agent to approve or reject this bounded reservation mission.'
        : ''
      const reply = `${restaurantReservation.text || ''}${suffix}`
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:restaurantReservation.handledBy,actualCapability:'browser',status:restaurantReservation.status,runId:restaurantReservation.runId}).catch(()=>{})
      await saveConversation(user.telegram_id, text, reply)
      return NextResponse.json({ text: reply, handledBy: restaurantReservation.handledBy, runId: restaurantReservation.runId, status: restaurantReservation.status })
    }

    // Same appointment brain as Gogo Agent: preserve discovery context across
    // surfaces and keep final provider confirmation behind the Agent approval UI.
    const appointmentFollowup = await tryRunAppointmentFollowup({ actor, surface:'web', text })
    __trace.mark('appointmentFollowup')
    if (appointmentFollowup) {
      const suffix = appointmentFollowup.status === 'waiting_approval'
        ? '\n\nI paused before the consequential provider action. Open Gogo Agent to approve or reject it.'
        : ''
      const reply = `${appointmentFollowup.text || ''}${suffix}`
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:appointmentFollowup.handledBy,actualCapability:(appointmentFollowup as any).capability||'browser',status:appointmentFollowup.status,runId:appointmentFollowup.runId}).catch(()=>{})
      await saveConversation(user.telegram_id, text, reply)
      return NextResponse.json({ text: reply, handledBy: appointmentFollowup.handledBy, runId: appointmentFollowup.runId, status: appointmentFollowup.status })
    }

    const appointmentResearch = await tryRunAppointmentResearch({ actor, surface:'web', text })
    __trace.mark('appointmentResearch')
    if (appointmentResearch) {
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:appointmentResearch.handledBy,actualCapability:(appointmentResearch as any).capability||'browser',status:appointmentResearch.status,runId:appointmentResearch.runId}).catch(()=>{})
      await saveConversation(user.telegram_id, text, appointmentResearch.text)
      return NextResponse.json({ text: appointmentResearch.text, handledBy: appointmentResearch.handledBy, runId: appointmentResearch.runId, status: appointmentResearch.status })
    }

    // Train research started on Dashboard must remain on the web surface. Giving
    // the specialist first refusal here prevents the WhatsApp compatibility bridge
    // from storing source='whatsapp' and later pushing IRCTC handoff/results there.
    const trainResearch = await tryRunTrainResearch({ actor, surface:'web', text })
    __trace.mark('trainResearch')
    if (trainResearch) {
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:trainResearch.handledBy,actualCapability:(trainResearch as any).capability||'travel',status:trainResearch.status,runId:trainResearch.runId}).catch(()=>{})
      await saveConversation(user.telegram_id, text, trainResearch.text)
      return NextResponse.json({
        text: trainResearch.text,
        handledBy: trainResearch.handledBy,
        runId: trainResearch.runId,
        status: trainResearch.status,
      })
    }

    // First-class provider/browser tasks stay on the dashboard surface. This is
    // especially important for Vault-backed tasks such as "find my saved reels
    // on Instagram": the secure browser must own the request before the generic
    // planner or WhatsApp compatibility bridge can claim it.
    // Before the browser: a question about an unconnected account (Amazon orders) gets the Connect card, not a
    // browser run that hits the site's sign-in page (15 Oct live: amazon.in returned 503 and no card was shown).
    const accountGate = await tryAccountSiteAnswer(actor, text)
    __trace.mark('accountGate')
    if (accountGate) {
      await saveConversation(user.telegram_id, text, accountGate.text)
      return NextResponse.json({ text: accountGate.text, handledBy: accountGate.handledBy, status: accountGate.status })
    }

    const browserTask = await tryRunBrowserCommand({ actor, surface:'web', text })
    __trace.mark('browserTask')
    if (browserTask) {
      const suffix = browserTask.status === 'waiting_approval'
        ? '\n\nI paused before the consequential provider action. Open Gogo Agent to approve or reject it.'
        : ''
      const reply = `${browserTask.text || ''}${suffix}`
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:browserTask.handledBy,actualCapability:(browserTask as any).capability||'browser',status:browserTask.status,runId:browserTask.runId}).catch(()=>{})
      await saveConversation(user.telegram_id, text, reply)
      return NextResponse.json({
        text: reply,
        handledBy: browserTask.handledBy,
        runId: browserTask.runId,
        status: browserTask.status,
      })
    }

    if (isTravelResearchDetailsReply(text)) {
      const resumed = await tryRunTravelResearch({actor,surface:'web',text})
      __trace.mark('resumed')
      if (resumed) {
        await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:resumed.handledBy,actualCapability:'travel',status:resumed.status,runId:resumed.runId||null}).catch(()=>{})
        await saveConversation(user.telegram_id,text,resumed.text)
        return NextResponse.json(resumed)
      }
    }

    // 20 Oct live: "Draft an email to Nithin saying I will be 15 minutes late to the 4pm meeting" went to the
    // meeting-slot finder below. A dictated email is a Gmail draft (shown for review; "send it" stages the same
    // approval as a reply; nothing is sent here). Loaded lazily so route harnesses keep their dependency maps.
    if (/^(?:please\s+|pls\s+|can\s+you\s+|could\s+you\s+)?(?:(?:draft|write|compose|prepare|send)\b[^\n]*?\b(?:e-?mail|mail)\b|(?:e-?mail|mail)\s+\S)/i.test(text)) {
      const gmailSend: any = await import('@/lib/agent/gmail-send').catch(() => null)
      if (gmailSend?.parseGmailComposeCommand?.(text)) {
        const draft = await gmailSend.tryRunGmailSendCommand({ actor, text })
        __trace.mark('gmailCompose')
        if (draft?.text) {
          await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:draft.handledBy||'gmail-send',actualCapability:'email',status:draft.status||null,runId:null}).catch(()=>{})
          await saveConversation(user.telegram_id, text, draft.text)
          return NextResponse.json({ text: draft.text, handledBy: draft.handledBy || 'gmail-send', status: draft.status })
        }
      }
    }

    if (isStandaloneWorkspaceMeetingPrep(text)) {
      const meeting = await tryPrepareWorkspaceMeetingPlan({actor,surface:'web',text})
      __trace.mark('meeting')
      if (meeting) {
        await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:meeting.handledBy,actualCapability:meeting.capability,status:meeting.status,runId:meeting.runId}).catch(()=>{})
        await saveConversation(user.telegram_id,text,meeting.text)
        return NextResponse.json(meeting)
      }
    }

    // High-confidence semantic ambiguity stops before the broad planner can act on the wrong object
    // (same guard WhatsApp has). Jev only asks for the missing detail; it never gets execution authority.
    // Grounded reminder commands ("move it", "what reminders do I have") are never second-guessed.
    const jevClarify = isGroundedReminderCommand(text) ? null : jevClarificationReply(webObservation?.jev)
    if (jevClarify) {
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:'jev-clarification-guard',actualCapability:null,status:'paused'}).catch(()=>{})
      await saveConversation(user.telegram_id, text, jevClarify)
      return NextResponse.json({ text: jevClarify, handledBy: 'jev-clarification-guard', status: 'paused' })
    }

    // Plain information questions skip the general planner (20 Oct: 1–2.4s, then it declined). So does a read-only
    // question about the person's own data ("Any important emails today?", "What are my reminders?" 22.9s live):
    // each goes to its read path, and the planner could only decline it or turn it into a multi-step mission.
    const mission = isPlainInfoQuestion(text) || isPersonalDataReadQuestion(text) || isReminderReadOnlyAsk(text) ? null : await tryRunGeneralPlan({
      actor,
      surface:'web',
      text,
      messageId:`web-${randomUUID()}`,
    })
    __trace.mark('generalPlan')
    if (mission) {
      const suffix = mission.status === 'waiting_approval'
        ? '\n\nI paused at a consequential step. Open Gogo Agent to review and approve or reject it.'
        : ''
      const reply = `${mission.text || ''}${suffix}`
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:mission.handledBy,actualCapability:(mission as any).capability||null,status:mission.status,runId:mission.runId}).catch(()=>{})
      await saveConversation(user.telegram_id, text, reply)
      return NextResponse.json({ text: reply, handledBy: mission.handledBy, runId: mission.runId, status: mission.status })
    }

    if (isPublicTravelResearchRequest(text)) {
      const travel = await tryRunTravelResearch({ actor, surface:'web', text })
      __trace.mark('travel')
      if (travel) {
        const hardened = await hardenTravelResearchResult(travel, text)
        __trace.mark('hardened')
        await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:travel.handledBy,actualCapability:(travel as any).capability||'travel',status:(travel as any).status||null,runId:(travel as any).runId||null}).catch(()=>{})
        await saveConversation(user.telegram_id, text, hardened.text)
        return NextResponse.json({ text: hardened.text, handledBy: hardened.handledBy, status: hardened.status, runId: 'runId' in hardened ? hardened.runId : undefined })
      }
    }

    const featureReply = await routeFeatureIntent(String(user.whatsapp_id), text, {
      telegramId: Number(user.telegram_id),
      caption: text,
      semantic: webObservation?.jev,
      surface: 'web',
    })
    __trace.mark('featureReply')

    if (featureReply) {
      await recordShadowRouterOutcome({telegramId:user.telegram_id,surface:'web',eventId:shadowEventId,actualHandler:'feature-intent'}).catch(()=>{})
      await saveConversation(user.telegram_id, text, featureReply)
      return NextResponse.json({ text: safeReplyText(featureReply), handledBy: 'feature-intent' })
    }

    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: String(user.whatsapp_id),
      text,
      userName: user.name || 'Gogo',
      messageType: 'text',
      messageId: shadowEventId,
      semantic: webObservation?.jev,
      approxLocation: parseApproxLocation(body?.location),
      pendingQuestionChecked,
    })

    await recordShadowRouterOutcome({
      telegramId:user.telegram_id,
      surface:'web',
      eventId:shadowEventId,
      actualHandler:result.handledBy || 'same-brain',
      actualCapability:(result as any).capability || null,
      status:(result as any).status || null,
      runId:(result as any).runId || null,
    }).catch(()=>{})

    return NextResponse.json({
      text: safeReplyText(result.text),
      mediaUrl: result.mediaUrl || null,
      mediaType: result.mediaType || null,
      handledBy: result.handledBy || 'same-brain',
    })
  } catch (error: any) {
    console.error('DASHBOARD_CHAT_FAILED:', error?.message || error)
    return NextResponse.json({ error: 'chat_failed', message: 'Gogo had trouble with that. Try once more.' }, { status: 500 })
  }
}

// Duet parity step 4: channels. The chat handlers save their own conversation rows; when the message was sent in a
// channel, the rows this request created are tagged with it afterwards (owner-scoped, untagged rows only, created
// during this request). Memory, tasks and approvals stay shared across channels.
async function withChatChannel(req: NextRequest) {
  const startedAt = new Date(Date.now() - 1000).toISOString()
  let threadValue = ''
  try { threadValue = String(((await (req as any).clone?.().json().catch(() => null)) as any)?.threadId || '') } catch {}
  const res = await handleChatPost(req)
  if (threadValue && res.status < 400) {
    try {
      const session = await getSession()
      const ctx = await import('@/lib/agent/thread-context').catch(() => null)
      const thread = session && ctx ? await ctx.resolveThreadForUser(String(session.telegramId), threadValue).catch(() => null) : null
      if (thread && session) {
        const tg = parseInt(String(session.telegramId), 10)
        const { error } = await supabaseAdmin.from('conversations').update({ thread_id: thread.id })
          .eq('telegram_id', tg).is('thread_id', null).gte('created_at', startedAt).in('role', ['user', 'assistant'])
        if (error) console.error('DASHBOARD_CHAT_CHANNEL_TAG_FAILED:', error.message)
        else await supabaseAdmin.from('agent_threads').update({ updated_at: new Date().toISOString() }).eq('id', thread.id).eq('telegram_id', String(session.telegramId))
      }
    } catch (err: any) { console.error('DASHBOARD_CHAT_CHANNEL_FAILED:', String(err?.message || err).slice(0, 160)) }
  }
  return res
}
