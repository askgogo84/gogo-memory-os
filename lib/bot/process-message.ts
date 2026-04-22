import { askClaude, askClaudeWithContext, type Message } from '@/lib/claude'
import { addToList, checkItem, clearList, formatList, getAllLists, getList } from '@/lib/lists'
import { checkAndIncrementLimit } from '@/lib/limits'
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
import { buildReminderConfirmation, parseReminderIntent } from './handlers/reminders'
import { buildDeterministicWeatherReply, buildDeterministicGoldReply, buildDeterministicIplStandingsReply } from './handlers/deterministic'
import { buildDirectWebAnswer } from './handlers/web-answer'

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
    .map((x) => ({
      role: x.role,
      content: x.content,
    }))
}

async function saveConversation(telegramId: number, role: 'user' | 'assistant', content: string) {
  await supabaseAdmin.from('conversations').insert({
    telegram_id: telegramId,
    role,
    content,
  })
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
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content,
  })
}

async function createReminder(
  telegramId: number,
  chatId: number,
  remindAt: string,
  message: string,
  pattern?: string
) {
  const payload: any = {
    telegram_id: telegramId,
    chat_id: chatId,
    message,
    remind_at: remindAt,
    sent: false,
  }

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

export async function processIncomingMessage(params: ProcessIncomingParams): Promise<ProcessIncomingResult> {
  const resolvedUser = await resolveUser({
    channel: params.channel,
    externalUserId: params.externalUserId,
    userName: params.userName,
  })

  const incomingText = (params.text || '').trim()
  const intent = detectIntent(incomingText)

  const limit = await checkAndIncrementLimit(resolvedUser.telegramId)
  if (!limit.allowed) {
    return {
      text: formatOutgoingText(params.channel, limit.upgradeMessage || 'Daily limit reached.'),
      resolvedUser,
    }
  }

  await saveConversation(resolvedUser.telegramId, 'user', incomingText)

  const followupYes = /^(yes|yeah|yep|haan|ok|okay)( .*)?$/i.test(incomingText)
  if (followupYes) {
    const latestSportsFollowup = await getLatestFollowupState(resolvedUser.telegramId, 'sports_match')

    if (latestSportsFollowup?.payload?.match_time_iso) {
      const matchTime = new Date(latestSportsFollowup.payload.match_time_iso)
      const lower = incomingText.toLowerCase()

      let remindAt = new Date(matchTime)

      if (lower.includes('1 hour before')) {
        remindAt = new Date(matchTime.getTime() - 60 * 60 * 1000)
      } else if (lower.includes('2 hours before')) {
        remindAt = new Date(matchTime.getTime() - 2 * 60 * 60 * 1000)
      } else if (lower.includes('tomorrow morning')) {
        const d = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(matchTime.getTime() - 24 * 60 * 60 * 1000)).split('-')

        remindAt = new Date(Date.UTC(Number(d[0]), Number(d[1]) - 1, Number(d[2]), 3, 30, 0))
      } else {
        remindAt = new Date(matchTime.getTime() - 60 * 60 * 1000)
      }

      const reminderMessage = `${latestSportsFollowup.payload.match_label} match reminder`
      await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        remindAt.toISOString(),
        reminderMessage
      )

      let reply = ''

      if (lower.includes('1 hour before')) {
        reply = `Done — I'll remind you 1 hour before *${latestSportsFollowup.payload.match_label}*.`
      } else if (lower.includes('2 hours before')) {
        reply = `Done — I'll remind you 2 hours before *${latestSportsFollowup.payload.match_label}*.`
      } else if (lower.includes('tomorrow morning')) {
        reply = `Done — I'll remind you tomorrow morning about *${latestSportsFollowup.payload.match_label}*.`
      } else {
        reply = `Done — I'll remind you before *${latestSportsFollowup.payload.match_label}*.`
      }
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }
  const eagerReminder = parseReminderIntent(incomingText)
  if (eagerReminder && intent.type === 'set_reminder') {
    await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      eagerReminder.remindAtIso,
      eagerReminder.message,
      eagerReminder.kind === 'recurring' ? eagerReminder.pattern : undefined
    )

    const reply = buildReminderConfirmation(eagerReminder)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'connect_calendar') {
    const url = getAuthUrl(resolvedUser.telegramId)
    const reply = `Connect your Google Calendar here:\n${url}`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'email_action') {
    const reply = await buildEmailActionReply(resolvedUser.telegramId, incomingText)
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
      const reply = `Your Gmail is not connected yet.\n\nConnect it here:\n${connectUrl}`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }

    const lowerText = incomingText.toLowerCase()
    const wantsUnread = lowerText.includes('unread')
    const wantsSummary =
      lowerText.includes('summary') ||
      lowerText.includes('summarize')

    let emails: any[] = []
    let accessToken = user.gmail_access_token || null

    const fetchMode = async (token: string) => {
      return wantsUnread
        ? await fetchUnreadEmails(token, 3)
        : await fetchLatestEmails(token, 3)
    }

    if (accessToken) {
      try {
        emails = await fetchMode(accessToken)
      } catch (error) {
        console.error('fetch emails with current token failed:', error)
      }
    }

    if (!emails.length && user.gmail_refresh_token) {
      const refreshedToken = await refreshGmailAccessToken(user.gmail_refresh_token)

      if (refreshedToken) {
        accessToken = refreshedToken

        await supabaseAdmin
          .from('users')
          .update({ gmail_access_token: refreshedToken })
          .eq('telegram_id', resolvedUser.telegramId)

        try {
          emails = await fetchMode(refreshedToken)
        } catch (error) {
          console.error('fetch emails with refreshed token failed:', error)
        }
      }
    }

    if (!emails.length) {
      const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${resolvedUser.telegramId}`
      const reply = `I couldn't fetch your emails right now.\n\nTry reconnecting Gmail here:\n${connectUrl}`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }

    let reply = ''

    if (wantsSummary) {
      reply =
        `*Top 3 ${wantsUnread ? 'unread' : 'latest'} email summaries${user.gmail_email ? ` for ${user.gmail_email}` : ''}:*\n\n` +
        emails
          .map((mail: any, idx: number) => {
            const safeSnippet = (mail.snippet || '').replace(/\s+/g, ' ').trim()
            const shortSnippet = safeSnippet.length > 120 ? safeSnippet.slice(0, 117) + '...' : safeSnippet
            return `*${idx + 1}.* ${mail.subject}\nFrom: ${mail.from}\nSummary: ${shortSnippet || 'No preview available.'}`
          })
          .join('\n\n')
    } else {
      reply =
        `*Top 3 ${wantsUnread ? 'unread' : 'latest'} emails${user.gmail_email ? ` for ${user.gmail_email}` : ''}:*\n\n` +
        emails
          .map((mail: any, idx: number) => {
            const safeSnippet = (mail.snippet || '').replace(/\s+/g, ' ').trim()
            const shortSnippet = safeSnippet.length > 160 ? safeSnippet.slice(0, 157) + '...' : safeSnippet
            return `*${idx + 1}.* ${mail.subject}\nFrom: ${mail.from}` +
              (shortSnippet ? `\n${shortSnippet}` : '')
          })
          .join('\n\n')
    }

    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'connect_gmail') {
    const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${resolvedUser.telegramId}`
    const reply = `Connect your Gmail here:\n${connectUrl}`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'weather_live') {
    let reply = ''
    try {
      reply = await buildDeterministicWeatherReply(incomingText)
    } catch (error) {
      console.error('Weather handler failed:', error)
      reply = "I couldn't fetch the weather right now. Please try again in a moment."
}
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
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
    const sportsReply = sportsResult?.reply || 'I could not find the next RCB match.'
    await saveConversation(resolvedUser.telegramId, 'assistant', sportsReply)
    return { text: formatOutgoingText(params.channel, sportsReply), resolvedUser }
  }

  if (intent.type === 'set_reminder') {
    const parsedReminder = parseReminderIntent(incomingText)
    if (parsedReminder) {
      await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        parsedReminder.remindAtIso,
        parsedReminder.message,
        parsedReminder.kind === 'recurring' ? parsedReminder.pattern : undefined
      )

      const reply = buildReminderConfirmation(parsedReminder)
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  if (intent.type === 'list_show_all') {
    const lists = await getAllLists(resolvedUser.telegramId)
    const reply = !lists.length
      ? 'You do not have any lists yet.'
      : `Your lists:\n` + lists.map((l: any) => `- ${l.list_name}`).join('\n')

    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'list_show') {
    const listName = extractListNameFromText(incomingText)
    const list = await getList(resolvedUser.telegramId, listName)
    const reply = list
      ? formatList(list.list_name, list.items || [])
      : `I could not find a list called "${listName}".`

    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (intent.type === 'web_search') {
    const searchContext = await searchWeb(incomingText)
    let reply = ''
    try {
      reply = await askClaudeWithContext(incomingText, searchContext, resolvedUser.name)
    } catch {
      reply = buildDirectWebAnswer(incomingText, searchContext)
    }

    if (!reply || /i apologize|unable to provide|don't have access|couldn't fetch|web search failed/i.test(reply)) {
      reply = buildDirectWebAnswer(incomingText, searchContext)
    }

    const formatted = formatOutgoingText(params.channel, reply)
    await saveConversation(resolvedUser.telegramId, 'assistant', formatted)
    return { text: formatted, resolvedUser }
  }

  const history = await getConversationHistory(resolvedUser.telegramId)
  const memories = await getMemories(resolvedUser.telegramId)

  const rawClaude = await askClaude(
    incomingText,
    history,
    memories,
    resolvedUser.name
  )

  const parsed = parseClaudeResponse(rawClaude)
  let finalReply = rawClaude

  if (parsed.type === 'memory') {
    await saveMemory(resolvedUser.telegramId, parsed.fact)
    finalReply = parsed.replyText || 'Got it — I will remember that.'
  }

  if (parsed.type === 'reminder') {
    await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      parsed.remindAt,
      parsed.message,
      parsed.pattern
    )
    finalReply = parsed.replyText || `Done — I have set the reminder for ${parsed.message}.`
  }

  if (parsed.type === 'list_add') {
    const items = await addToList(resolvedUser.telegramId, parsed.listName, parsed.items)
    finalReply = parsed.replyText || formatList(parsed.listName, items)
  }

  if (parsed.type === 'list_show') {
    const list = await getList(resolvedUser.telegramId, parsed.listName)
    finalReply = list
      ? formatList(list.list_name, list.items || [])
      : `I could not find a list called "${parsed.listName}".`
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
    finalReply = !lists.length
      ? 'You do not have any lists yet.'
      : `Your lists:\n` + lists.map((l: any) => `- ${l.list_name}`).join('\n')
  }

  if (parsed.type === 'search') {
    const searchContext = await searchWeb(parsed.query)
    try {
      finalReply = await askClaudeWithContext(incomingText, searchContext, resolvedUser.name)
    } catch {
      finalReply = buildDirectWebAnswer(incomingText, searchContext)
    }

    if (!finalReply || /i apologize|unable to provide|don't have access|couldn't fetch|web search failed/i.test(finalReply)) {
      finalReply = buildDirectWebAnswer(incomingText, searchContext)
    }
  }

  const formatted = formatOutgoingText(params.channel, finalReply)
  await saveConversation(resolvedUser.telegramId, 'assistant', formatted)

  return {
    text: formatted,
    resolvedUser,
  }
}
















