import { askClaude, askClaudeWithContext, type Message } from '@/lib/claude'
import { addToList, checkItem, clearList, formatList, getAllLists, getList } from '@/lib/lists'
import { checkAndIncrementLimit, getUsageStatusReply } from '@/lib/limits'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAuthUrl } from '@/lib/google-calendar'
import { fetchLatestEmails, fetchUnreadEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { resolveUser, type Channel } from './resolve-user'
import { detectIntent } from './detect-intent'
import { parseClaudeResponse } from './parse-claude-response'
import { formatOutgoingText } from './format-response'
import { searchWeb } from '@/lib/web-search'
import { buildSportsReplyWithState } from './handlers/sports'
import { getLatestFollowupState } from './handlers/followup-state'
import { buildEmailActionReply } from './handlers/email-actions'
import { styleReplyByIntent } from './handlers/response-style'
import { buildAmPmClarificationReply, getAmbiguousReminderTime, buildReminderConfirmation, parseReminderIntent } from './handlers/reminders'
import { editLatestReminder } from './handlers/edit-reminder'
import { buildMorningBriefing } from './handlers/morning-briefing'
import { setBriefingTime } from './handlers/briefing-settings'
import { buildDeterministicWeatherReply, buildDeterministicGoldReply, buildDeterministicIplStandingsReply } from './handlers/deterministic'
import { buildDirectWebAnswer } from './handlers/web-answer'
import { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'
import { buildCalendarActionReply, createCalendarConflictEvent, isCalendarAction } from './handlers/calendar-actions'
import { isCalendarConflictMoveCommand, moveCalendarConflictEvent } from './handlers/calendar-conflict-followup'
import { buildPlanMyDayReply, createDayPlanReminders, isPlanMyDayIntent } from './handlers/plan-my-day'

export type ProcessIncomingParams = {
  channel: Channel
  externalUserId: string
  text: string
  userName?: string
  messageType?: 'text' | 'voice' | 'image' | 'document'
}

export type ProcessIncomingResult = {
  text: string
  resolvedUser: Awaited<ReturnType<typeof resolveUser>>
}

async function getConversationHistory(telegramId: number): Promise<Message[]> {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('role, content')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: true })
    .limit(20)

  return ((data || []) as any[])
    .filter((x) => x.role === 'user' || x.role === 'assistant')
    .map((x) => ({ role: x.role, content: x.content }))
}

async function saveConversation(telegramId: number, role: 'user' | 'assistant', content: string) {
  await supabaseAdmin.from('conversations').insert({ telegram_id: telegramId, role, content })
}

async function getMemories(telegramId: number): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('content')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(20)

  return ((data || []) as any[]).map((m) => m.content).filter(Boolean)
}

async function saveMemory(telegramId: number, content: string) {
  await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content })
}

function normalizeReminderMessage(message: string) {
  return (message || '')
    .toLowerCase()
    .replace(/^every\s+to\s+/i, '')
    .replace(/^to\s+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isCleanerReminderMessage(newMessage: string, oldMessage: string) {
  const oldLower = (oldMessage || '').toLowerCase().trim()
  const newLower = (newMessage || '').toLowerCase().trim()
  if (/^every\s+to\s+/i.test(oldLower)) return true
  if (newLower.length < oldLower.length && normalizeReminderMessage(newLower) === normalizeReminderMessage(oldLower)) return true
  return false
}

async function findDuplicateRecurringReminder(telegramId: number, pattern?: string) {
  if (!pattern) return null

  const { data } = await supabaseAdmin
    .from('reminders')
    .select('id, message, recurring_pattern, remind_at, sent')
    .eq('telegram_id', telegramId)
    .eq('sent', false)
    .eq('is_recurring', true)
    .eq('recurring_pattern', pattern)
    .order('created_at', { ascending: true })
    .limit(5)

  return data?.[0] || null
}

async function createReminder(
  telegramId: number,
  chatId: number,
  remindAt: string,
  message: string,
  pattern?: string,
  whatsappTo?: string | null
) {
  if (pattern) {
    const duplicate = await findDuplicateRecurringReminder(telegramId, pattern)
    if (duplicate?.id) {
      const updatePayload: any = { remind_at: remindAt, sent: false }
      if (whatsappTo) updatePayload.whatsapp_to = whatsappTo
      if (isCleanerReminderMessage(message, duplicate.message)) updatePayload.message = message

      const { error: updateError } = await supabaseAdmin
        .from('reminders')
        .update(updatePayload)
        .eq('id', duplicate.id)

      if (updateError) {
        console.error('REMINDER DEDUPE UPDATE FAILED:', updateError, updatePayload)
        throw new Error(`Reminder update failed: ${updateError.message}`)
      }

      console.log('REMINDER DUPLICATE SKIPPED:', { telegramId, pattern, existingId: duplicate.id })
      return
    }
  }

  const payload: any = { telegram_id: telegramId, chat_id: chatId, message, remind_at: remindAt, sent: false }
  if (whatsappTo) payload.whatsapp_to = whatsappTo
  if (pattern) {
    payload.recurring_pattern = pattern
    payload.is_recurring = true
  }

  const { error } = await supabaseAdmin.from('reminders').insert(payload)
  if (error) {
    console.error('REMINDER INSERT FAILED:', error, payload)
    throw new Error(`Reminder insert failed: ${error.message}`)
  }
}

function extractListNameFromText(text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('shopping')) return 'shopping'
  if (lower.includes('todo')) return 'todo'
  if (lower.includes('to-do')) return 'todo'
  if (lower.includes('grocery')) return 'grocery'
  return 'list'
}

function isUsageCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return lower === 'usage' || lower === 'my usage' || lower === 'usage status' || lower === 'plan usage' || lower === 'limits' || lower === 'my limits'
}

export async function processIncomingMessage(params: ProcessIncomingParams): Promise<ProcessIncomingResult> {
  console.log('PIM:start', { channel: params.channel, externalUserId: params.externalUserId, text: params.text })
  const resolvedUser = await resolveUser({ channel: params.channel, externalUserId: params.externalUserId, userName: params.userName })

  const incomingText = (params.text || '').trim()
  const intent = detectIntent(incomingText)
  console.log('PIM:intent', intent)

  if (isUsageCommand(incomingText)) {
    const reply = await getUsageStatusReply(resolvedUser.telegramId)
    await saveConversation(resolvedUser.telegramId, 'user', incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (isCalendarConflictMoveCommand(incomingText)) {
    const latestCalendarConflict = await getLatestFollowupState(resolvedUser.telegramId, 'calendar_conflict')

    if (latestCalendarConflict?.payload?.startIso) {
      const reply = await moveCalendarConflictEvent(resolvedUser.telegramId, latestCalendarConflict.payload, incomingText)

      if (reply) {
        await saveConversation(resolvedUser.telegramId, 'user', incomingText)
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        return { text: formatOutgoingText(params.channel, reply), resolvedUser }
      }
    }
  }

  if (intent.type === 'edit_reminder') {
    const reply = await editLatestReminder(resolvedUser.telegramId, incomingText)
    await saveConversation(resolvedUser.telegramId, 'user', incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  const followupYes = /^(yes|yeah|yep|haan|ok|okay|add anyway)( .*)?$/i.test(incomingText)
  if (followupYes) {
    await saveConversation(resolvedUser.telegramId, 'user', incomingText)

    const latestCalendarConflict = await getLatestFollowupState(resolvedUser.telegramId, 'calendar_conflict')
    if (latestCalendarConflict?.payload?.startIso) {
      const reply = await createCalendarConflictEvent(resolvedUser.telegramId, latestCalendarConflict.payload)
      if (reply) {
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        return { text: formatOutgoingText(params.channel, reply), resolvedUser }
      }
    }

    const latestDayPlanFollowup = await getLatestFollowupState(resolvedUser.telegramId, 'day_plan')
    if (latestDayPlanFollowup?.payload?.items?.length) {
      const reply = await createDayPlanReminders({
        telegramId: resolvedUser.telegramId,
        chatId: resolvedUser.telegramId,
        whatsappTo: params.channel === 'whatsapp' ? resolvedUser.whatsappId : null,
        items: latestDayPlanFollowup.payload.items,
      })
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }

    const latestSportsFollowup = await getLatestFollowupState(resolvedUser.telegramId, 'sports_match')
    if (latestSportsFollowup?.payload?.match_time_iso) {
      const matchTime = new Date(latestSportsFollowup.payload.match_time_iso)
      const lower = incomingText.toLowerCase()
      let remindAt = new Date(matchTime.getTime() - 60 * 60 * 1000)

      if (lower.includes('2 hours before')) remindAt = new Date(matchTime.getTime() - 2 * 60 * 60 * 1000)

      const reminderMessage = `${latestSportsFollowup.payload.match_label} match reminder`
      await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        remindAt.toISOString(),
        reminderMessage,
        undefined,
        params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
      )

      const reply = `✅ *Match reminder set*\n\n${latestSportsFollowup.payload.match_label}\n${lower.includes('2 hours before') ? '2 hours before the match' : '1 hour before the match'}`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  if (
    intent.type === 'welcome_menu' ||
    intent.type === 'help_menu' ||
    intent.type === 'upgrade_plan' ||
    intent.type === 'referral_flow' ||
    intent.type === 'notify_me'
  ) {
    const reply = buildPremiumWhatsappReply(intent.type, resolvedUser.name)
    await saveConversation(resolvedUser.telegramId, 'user', incomingText)
    if (intent.type === 'notify_me') {
      await saveMemory(resolvedUser.telegramId, 'User asked to be notified for AskGogo founder pricing / paid plan launch.')
    }
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (getAmbiguousReminderTime(incomingText) && (intent.type === 'set_reminder' || /\b(remind|wake|alarm|set)\b/i.test(incomingText))) {
    const reply = buildAmPmClarificationReply(incomingText)
    await saveConversation(resolvedUser.telegramId, 'user', incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  const limit = await checkAndIncrementLimit(resolvedUser.telegramId)
  if (!limit.allowed) {
    return { text: formatOutgoingText(params.channel, limit.upgradeMessage || 'Daily limit reached.'), resolvedUser }
  }

  await saveConversation(resolvedUser.telegramId, 'user', incomingText)

  if (isPlanMyDayIntent(incomingText)) {
    const reply = await buildPlanMyDayReply(resolvedUser.telegramId, resolvedUser.name)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (isCalendarAction(incomingText)) {
    const calendarResult = await buildCalendarActionReply(resolvedUser.telegramId, incomingText)
    if (calendarResult.handled) {
      await saveConversation(resolvedUser.telegramId, 'assistant', calendarResult.reply)
      return { text: formatOutgoingText(params.channel, calendarResult.reply), resolvedUser }
    }
  }

  const eagerReminder = parseReminderIntent(incomingText)
  if (eagerReminder && intent.type === 'set_reminder') {
    await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      eagerReminder.remindAtIso,
      eagerReminder.message,
      eagerReminder.kind === 'recurring' ? eagerReminder.pattern : undefined,
      params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
    )
    const reply = styleReplyByIntent('set_reminder', buildReminderConfirmation(eagerReminder))
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'set_briefing_time') {
    const reply = await setBriefingTime(resolvedUser.telegramId, incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'morning_briefing') {
    const reply = styleReplyByIntent('morning_briefing', await buildMorningBriefing(resolvedUser.telegramId, resolvedUser.name))
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'connect_calendar') {
    const url = getAuthUrl(resolvedUser.telegramId)
    const reply = `📅 *Connect Google Calendar*\n\nThis lets AskGogo include your schedule in Today briefing and help you plan reminders better.\n\n${url}\n\nAfter connecting, come back and type:\nToday`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'email_action') {
    const reply = styleReplyByIntent('email_action', await buildEmailActionReply(resolvedUser.telegramId, incomingText))
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'read_gmail') {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('gmail_connected, gmail_access_token, gmail_refresh_token, gmail_email')
      .eq('telegram_id', resolvedUser.telegramId)
      .single()

    if (!user?.gmail_connected) {
      const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${resolvedUser.telegramId}`
      const reply = `📬 *Connect Gmail*\n\nTo show unread emails and draft replies, connect Gmail once.\n\n${connectUrl}\n\nAfter connecting, come back and type:\nshow my unread emails`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }

    const lowerText = incomingText.toLowerCase()
    const wantsUnread = lowerText.includes('unread')
    const wantsSummary = lowerText.includes('summary') || lowerText.includes('summarize')
    let emails: any[] = []
    let accessToken = user.gmail_access_token || null
    const fetchMode = async (token: string) => wantsUnread ? await fetchUnreadEmails(token, 3) : await fetchLatestEmails(token, 3)

    if (accessToken) {
      try { emails = await fetchMode(accessToken) } catch (error) { console.error('fetch emails with current token failed:', error) }
    }

    if (!emails.length && user.gmail_refresh_token) {
      const refreshedToken = await refreshGmailAccessToken(user.gmail_refresh_token)
      if (refreshedToken) {
        accessToken = refreshedToken
        await supabaseAdmin.from('users').update({ gmail_access_token: refreshedToken }).eq('telegram_id', resolvedUser.telegramId)
        try { emails = await fetchMode(refreshedToken) } catch (error) { console.error('fetch emails with refreshed token failed:', error) }
      }
    }

    if (!emails.length) {
      const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${resolvedUser.telegramId}`
      const reply = `📬 *Gmail needs reconnecting*\n\nI couldn’t fetch your emails right now.\n\nReconnect Gmail here:\n${connectUrl}\n\nThen type:\nshow my unread emails`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }

    const reply = `Top 3 ${wantsUnread ? 'unread' : 'latest'} emails${user.gmail_email ? ` for ${user.gmail_email}` : ''}:\n\n` +
      emails.map((mail: any, idx: number) => {
        const safeSnippet = (mail.snippet || '').replace(/\s+/g, ' ').trim()
        const shortSnippet = safeSnippet.length > 160 ? safeSnippet.slice(0, 157) + '...' : safeSnippet
        return `${idx + 1}. ${mail.subject}\nFrom: ${mail.from}` + (shortSnippet ? `\n${shortSnippet}` : '')
      }).join('\n\n')

    const styledGmailReply = styleReplyByIntent('read_gmail', reply)
    await saveConversation(resolvedUser.telegramId, 'assistant', styledGmailReply)
    return { text: formatOutgoingText(params.channel, styledGmailReply), resolvedUser }
  }

  if (intent.type === 'connect_gmail') {
    const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${resolvedUser.telegramId}`
    const reply = `📬 *Connect Gmail*\n\nConnect once to unlock email summaries and reply drafts.\n\n${connectUrl}`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'weather_live') {
    let reply = ''
    try { reply = await buildDeterministicWeatherReply(incomingText) } catch { reply = `I couldn't fetch the weather right now. Please try again in a moment.` }
    const styledWeatherReply = styleReplyByIntent('weather_live', reply)
    await saveConversation(resolvedUser.telegramId, 'assistant', styledWeatherReply)
    return { text: formatOutgoingText(params.channel, styledWeatherReply), resolvedUser }
  }

  if (intent.type === 'gold_live') {
    const reply = await buildDeterministicGoldReply(incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'sports_standings') {
    const reply = await buildDeterministicIplStandingsReply(incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'sports_schedule') {
    const sportsResult = await buildSportsReplyWithState(incomingText, resolvedUser.telegramId)
    const styledSportsReply = styleReplyByIntent('sports_schedule', sportsResult?.reply || 'I could not find the next RCB match.')
    await saveConversation(resolvedUser.telegramId, 'assistant', styledSportsReply)
    return { text: formatOutgoingText(params.channel, styledSportsReply), resolvedUser }
  }

  if (intent.type === 'list_show_all') {
    const lists = await getAllLists(resolvedUser.telegramId)
    const reply = !lists.length ? 'You do not have any lists yet.' : `Your lists:\n` + lists.map((l: any) => `- ${l.list_name}`).join('\n')
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'list_show') {
    const listName = extractListNameFromText(incomingText)
    const list = await getList(resolvedUser.telegramId, listName)
    const reply = list ? formatList(list.list_name, list.items || []) : `I could not find a list called "${listName}".`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'web_search') {
    const searchContext = await searchWeb(incomingText)
    let reply = ''
    try { reply = await askClaudeWithContext(incomingText, searchContext, resolvedUser.name) } catch { reply = buildDirectWebAnswer(incomingText, searchContext) }
    if (!reply || /i apologize|unable to provide|don't have access|couldn't fetch|web search failed/i.test(reply)) reply = buildDirectWebAnswer(incomingText, searchContext)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  const history = await getConversationHistory(resolvedUser.telegramId)
  const memories = await getMemories(resolvedUser.telegramId)
  const rawClaude = await askClaude(incomingText, history, memories, resolvedUser.name)
  const parsed = parseClaudeResponse(rawClaude)
  let finalReply = rawClaude

  if (parsed.type === 'memory') {
    await saveMemory(resolvedUser.telegramId, parsed.fact)
    finalReply = parsed.replyText || 'Got it — I will remember that.'
  }

  if (parsed.type === 'reminder') {
    await createReminder(resolvedUser.telegramId, resolvedUser.telegramId, parsed.remindAt, parsed.message, parsed.pattern, params.channel === 'whatsapp' ? resolvedUser.whatsappId : null)
    finalReply = parsed.replyText || `Done — I have set the reminder for ${parsed.message}.`
  }

  if (parsed.type === 'list_add') finalReply = parsed.replyText || formatList(parsed.listName, await addToList(resolvedUser.telegramId, parsed.listName, parsed.items))
  if (parsed.type === 'list_show') {
    const list = await getList(resolvedUser.telegramId, parsed.listName)
    finalReply = list ? formatList(list.list_name, list.items || []) : `I could not find a list called "${parsed.listName}".`
  }
  if (parsed.type === 'list_check') {
    const updated = await checkItem(resolvedUser.telegramId, parsed.listName, parsed.itemText)
    finalReply = updated ? formatList(parsed.listName, updated) : `I could not find that list item.`
  }
  if (parsed.type === 'list_clear') {
    await clearList(resolvedUser.telegramId, parsed.listName)
    finalReply = parsed.replyText || `Cleared the ${parsed.listName} list.`
  }
  if (parsed.type === 'list_all') {
    const lists = await getAllLists(resolvedUser.telegramId)
    finalReply = !lists.length ? 'You do not have any lists yet.' : `Your lists:\n` + lists.map((l: any) => `- ${l.list_name}`).join('\n')
  }
  if (parsed.type === 'search') {
    const searchContext = await searchWeb(parsed.query)
    try { finalReply = await askClaudeWithContext(incomingText, searchContext, resolvedUser.name) } catch { finalReply = buildDirectWebAnswer(incomingText, searchContext) }
    if (!finalReply || /i apologize|unable to provide|don't have access|couldn't fetch|web search failed/i.test(finalReply)) finalReply = buildDirectWebAnswer(incomingText, searchContext)
  }

  const formatted = formatOutgoingText(params.channel, finalReply)
  await saveConversation(resolvedUser.telegramId, 'assistant', formatted)
  return { text: formatted, resolvedUser }
}
