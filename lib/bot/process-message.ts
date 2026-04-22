import { askClaude, askClaudeWithContext, type Message } from '@/lib/claude'
import { addToList, checkItem, clearList, formatList, getAllLists, getList } from '@/lib/lists'
import { checkAndIncrementLimit } from '@/lib/limits'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAuthUrl } from '@/lib/google-calendar'
import { fetchLatestEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { resolveUser, type Channel } from './resolve-user'
import { detectIntent } from './detect-intent'
import { parseClaudeResponse } from './parse-claude-response'
import { formatOutgoingText } from './format-response'
import { searchWeb } from '@/lib/web-search'
import { buildSportsReply } from './handlers/sports'
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

  if (intent.type === 'connect_calendar') {
    const url = getAuthUrl(resolvedUser.telegramId)
    const reply = `Connect your Google Calendar here:\n${url}`
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

    let accessToken = user.gmail_access_token

    if (!accessToken && user.gmail_refresh_token) {
      accessToken = await refreshGmailAccessToken(user.gmail_refresh_token)
    }

    if (!accessToken) {
      const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${resolvedUser.telegramId}`
      const reply = `I couldn't access your Gmail right now.\n\nReconnect it here:\n${connectUrl}`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }

    const emails = await fetchLatestEmails(accessToken, 5)

    if (!emails.length) {
      const reply = `I couldn't find any recent inbox emails right now.`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }

    const reply =
      `*Latest emails${user.gmail_email ? ` for ${user.gmail_email}` : ''}:*\n\n` +
      emails
        .map((mail: any, idx: number) =>
          `*${idx + 1}.* ${mail.subject}` +
          `\nFrom: ${mail.from}` +
          (mail.snippet ? `\n${mail.snippet}` : '')
        )
        .join('\n\n')

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
      reply = I couldn't fetch the weather right now. Please try again in a moment. 
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
    const sportsReply = buildSportsReply(incomingText) || 'I could not find the next RCB match.'
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

