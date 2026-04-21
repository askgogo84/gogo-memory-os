import { askClaude, askClaudeWithContext, type Message } from '@/lib/claude'
import { addToList, checkItem, clearList, formatList, getAllLists, getList } from '@/lib/lists'
import { checkAndIncrementLimit } from '@/lib/limits'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAuthUrl } from '@/lib/google-calendar'
import { resolveUser, type Channel } from './resolve-user'
import { detectIntent } from './detect-intent'
import { parseClaudeResponse } from './parse-claude-response'
import { formatOutgoingText } from './format-response'
import { searchWeb } from '@/lib/web-search'
import { buildSportsReply } from './handlers/sports'
import { buildReminderConfirmation, parseReminderIntent } from './handlers/reminders'

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

async function createReminder(telegramId: number, remindAt: string, message: string, pattern?: string) {
  const payload: any = {
    telegram_id: telegramId,
    message,
    remind_at: remindAt,
    sent: false,
  }

  if (pattern) payload.recurring_pattern = pattern

  await supabaseAdmin.from('reminders').insert(payload)
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

  if (intent.type === 'connect_gmail') {
    const reply =
      `Gmail connect is the next integration step.\n\n` +
      `For now I have rewired the bot core first so Gmail can plug into the same shared processor cleanly.`
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
    const reply = await askClaudeWithContext(
      incomingText,
      searchContext,
      resolvedUser.name
    )

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
      parsed.remindAt,
      parsed.message,
      parsed.pattern
    )
    finalReply =
      parsed.replyText ||
      `Done — I have set the reminder for ${parsed.message}.`
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
    finalReply = updated
      ? formatList(parsed.listName, updated)
      : `I could not find that list item.`
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
    finalReply = await askClaudeWithContext(
      incomingText,
      searchContext,
      resolvedUser.name
    )
  }

  const formatted = formatOutgoingText(params.channel, finalReply)
  await saveConversation(resolvedUser.telegramId, 'assistant', formatted)

  return {
    text: formatted,
    resolvedUser,
  }
}
