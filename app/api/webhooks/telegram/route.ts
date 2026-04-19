import { NextRequest, NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkAndIncrementLimit } from '@/lib/limits'
import { transcribeVoice, downloadTelegramFile } from '@/lib/whisper'
import { addToList, getList, getAllLists, checkItem, clearList, formatList } from '@/lib/lists'

export const dynamic = 'force-dynamic'

const BOT = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const BASE_URL = 'https://app.askgogo.in'

async function sendMessage(chatId: number, text: string) {
  await fetch(`${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}

async function sendTyping(chatId: number) {
  await fetch(`${BOT}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  })
}

async function getOrCreateUser(telegramId: number, name: string, username?: string) {
  const { data: existing } = await supabaseAdmin
    .from('users').select('*').eq('telegram_id', telegramId).single()
  if (existing) return existing
  const { data: newUser } = await supabaseAdmin
    .from('users').insert({ telegram_id: telegramId, name, username }).select().single()
  return newUser
}

async function getHistory(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('conversations').select('role, content')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false }).limit(20)
  return (data || []).reverse() as { role: 'user' | 'assistant'; content: string }[]
}

async function saveMessage(telegramId: number, role: 'user' | 'assistant', content: string) {
  await supabaseAdmin.from('conversations').insert({ telegram_id: telegramId, role, content })
}

async function getMemories(telegramId: number): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('memories').select('content')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false }).limit(20)
  return (data || []).map((m: { content: string }) => m.content)
}

async function saveMemory(telegramId: number, content: string) {
  await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content })
}

async function saveReminder(
  telegramId: number,
  chatId: number,
  remindAt: string,
  message: string,
  isRecurring: boolean = false,
  recurringPattern: string | null = null
) {
  await supabaseAdmin.from('reminders').insert({
    telegram_id: telegramId,
    chat_id: chatId,
    message,
    remind_at: remindAt,
    sent: false,
    is_recurring: isRecurring,
    recurring_pattern: recurringPattern,
  })
}

function parseResponse(raw: string) {
  let memory: string | null = null
  let reminder: {
    remindAt: string
    message: string
    isRecurring: boolean
    pattern: string | null
  } | null = null
  let listAction: {
    type: string
    listName: string
    items?: string[]
    itemText?: string
  } | null = null
  const filtered: string[] = []

  for (const line of raw.split('\n')) {
    if (line.startsWith('MEMORY:')) {
      memory = line.replace('MEMORY:', '').trim()
    } else if (line.startsWith('REMINDER:')) {
      const parts = line.replace('REMINDER:', '').trim().split('|')
      if (parts.length >= 2) {
        const isRecurring = parts.length >= 3 && parts[2].trim() !== ''
        reminder = {
          remindAt: parts[0].trim(),
          message: parts[1].trim(),
          isRecurring,
          pattern: isRecurring ? parts[2].trim() : null,
        }
      }
    } else if (line.startsWith('LIST_ADD:')) {
      const parts = line.replace('LIST_ADD:', '').trim().split('|')
      if (parts.length >= 2) {
        listAction = {
          type: 'add',
          listName: parts[0].trim(),
          items: parts[1].split(',').map(s => s.trim()).filter(Boolean),
        }
      }
    } else if (line.startsWith('LIST_SHOW:')) {
      listAction = { type: 'show', listName: line.replace('LIST_SHOW:', '').trim() }
    } else if (line.startsWith('LIST_CLEAR:')) {
      listAction = { type: 'clear', listName: line.replace('LIST_CLEAR:', '').trim() }
    } else if (line.startsWith('LIST_CHECK:')) {
      const parts = line.replace('LIST_CHECK:', '').trim().split('|')
      if (parts.length >= 2) {
        listAction = { type: 'check', listName: parts[0].trim(), itemText: parts[1].trim() }
      }
    } else if (line.startsWith('LIST_ALL')) {
      listAction = { type: 'all', listName: '' }
    } else {
      filtered.push(line)
    }
  }

  return { reply: filtered.join('\n').trim(), memory, reminder, listAction }
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json()
    const message = update.message
    if (!message) return NextResponse.json({ ok: true })

    const chatId: number = message.chat.id
    const telegramId: number = message.from.id
    const name: string = message.from.first_name || 'Friend'
    const username: string = message.from.username || ''

    let text: string = message.text || ''
    let isVoice = false

    if (message.voice) {
      await sendTyping(chatId)
      try {
        const fileBuffer = await downloadTelegramFile(message.voice.file_id)
        const transcribed = await transcribeVoice(fileBuffer)
        text = transcribed
        isVoice = true
      } catch (err) {
        console.error('Voice transcription failed:', err)
        await sendMessage(chatId, 'Could not transcribe your voice note. Please try again or type your message.')
        return NextResponse.json({ ok: true })
      }
    }

    if (!text) return NextResponse.json({ ok: true })

    await sendTyping(chatId)
    await getOrCreateUser(telegramId, name, username)

    if (text === '/start') {
      await sendMessage(chatId,
        `Hey ${name}! I'm *AskGogo*, your personal AI assistant.\n\n` +
        `*Remember* -- _"Remember my gym is at 7am"_\n` +
        `*Remind* -- _"Remind me to call Divya at 5pm"_\n` +
        `*Recurring* -- _"Remind me every Monday at 9am to review goals"_\n` +
        `*Lists* -- _"Add milk to shopping"_\n` +
        `*Voice* -- send a voice note, I understand it!\n` +
        `*Ask* -- anything, with full memory context\n\n` +
        `Commands:\n` +
        `/memory -- see what I remember\n` +
        `/reminders -- upcoming reminders\n` +
        `/lists -- all your lists\n` +
        `/dashboard -- full web view\n` +
        `/upgrade -- see plans and pricing\n` +
        `/help -- show this menu`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/help') {
      await sendMessage(chatId,
        `*AskGogo Commands:*\n\n` +
        `/memory -- view all saved memories\n` +
        `/reminders -- view upcoming reminders\n` +
        `/lists -- view all your lists\n` +
        `/dashboard -- open web dashboard\n` +
        `/upgrade -- view plans and pricing\n` +
        `/help -- show this menu\n\n` +
        `Voice notes supported -- just send a voice message.\n` +
        `Recurring reminders -- "every day at 8am", "every Monday at 9am"\n` +
        `Lists -- "add milk to shopping", "show my todo"`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/memory') {
      const memories = await getMemories(telegramId)
      if (memories.length === 0) {
        await sendMessage(chatId, 'No memories yet.\n\nTry: _"Remember that I prefer black coffee"_')
      } else {
        await sendMessage(chatId,
          `*What I remember about you:*\n\n` +
          memories.map((m, i) => `${i + 1}. ${m}`).join('\n')
        )
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/reminders') {
      const { data } = await supabaseAdmin
        .from('reminders').select('message, remind_at, is_recurring, recurring_pattern')
        .eq('telegram_id', telegramId).eq('sent', false)
        .order('remind_at', { ascending: true }).limit(10)

      if (!data || data.length === 0) {
        await sendMessage(chatId, 'No upcoming reminders.\n\nTry: _"Remind me every Monday at 9am to review my goals"_')
      } else {
        const list = data.map((r: {
          message: string
          remind_at: string
          is_recurring: boolean
          recurring_pattern: string
        }) => {
          const dt = new Date(r.remind_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          const tag = r.is_recurring ? ` (repeats ${r.recurring_pattern})` : ''
          return `- ${r.message} -- ${dt}${tag}`
        }).join('\n')
        await sendMessage(chatId, `*Upcoming reminders:*\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/lists') {
      const lists = await getAllLists(telegramId)
      if (lists.length === 0) {
        await sendMessage(chatId, 'No lists yet.\n\nTry: _"Add milk to shopping"_ or _"Add call mom to todo"_')
      } else {
        const summary = lists.map((l: { list_name: string; items: unknown[] }) =>
          `- *${l.list_name}* -- ${(l.items || []).length} items`
        ).join('\n')
        await sendMessage(chatId, `*Your lists:*\n\n${summary}\n\nSay _"show shopping"_ to see items.`)
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/dashboard') {
      await sendMessage(chatId,
        `*Your AskGogo Dashboard*\n\n` +
        `${BASE_URL}/dashboard?id=${telegramId}`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/upgrade') {
      const { data: user } = await supabaseAdmin
        .from('users').select('tier').eq('telegram_id', telegramId).single()
      const currentTier = user?.tier || 'free'
      await sendMessage(chatId,
        `*AskGogo Plans*\n\n` +
        `${currentTier === 'free' ? '(current) ' : ''}*Free* -- Rs 0\n20 msgs/day, 10 memories\n\n` +
        `${currentTier === 'starter' ? '(current) ' : ''}*Starter* -- Rs 149/month\n150 msgs/day, voice notes, 50 memories\n\n` +
        `${currentTier === 'pro' ? '(current) ' : ''}*Pro* -- Rs 299/month\nUnlimited, 500 memories, all features\n\n` +
        `Upgrade here: ${BASE_URL}/upgrade?id=${telegramId}`
      )
      return NextResponse.json({ ok: true })
    }

    const limitCheck = await checkAndIncrementLimit(telegramId)
    if (!limitCheck.allowed) {
      await sendMessage(chatId, limitCheck.upgradeMessage!)
      return NextResponse.json({ ok: true })
    }
    if (limitCheck.remaining === 3) {
      await sendMessage(chatId, 'Only 3 messages left today on free plan. Type /upgrade to get more.')
    }

    const [history, memories] = await Promise.all([
      getHistory(telegramId),
      getMemories(telegramId),
    ])

    const messageForClaude = isVoice ? `[Voice note]: ${text}` : text

    await saveMessage(telegramId, 'user', messageForClaude)
    const rawResponse = await askClaude(messageForClaude, history, memories, name)
    const { reply, memory, reminder, listAction } = parseResponse(rawResponse)

    if (memory) await saveMemory(telegramId, memory)
    if (reminder) {
      await saveReminder(
        telegramId, chatId,
        reminder.remindAt, reminder.message,
        reminder.isRecurring, reminder.pattern
      )
    }

    let listReply = ''
    if (listAction) {
      if (listAction.type === 'add' && listAction.items) {
        const items = await addToList(telegramId, listAction.listName, listAction.items)
        listReply = `\n\nAdded ${listAction.items.length} items to *${listAction.listName}* (${items.length} total)`
      } else if (listAction.type === 'show') {
        const list = await getList(telegramId, listAction.listName)
        listReply = list ? `\n\n${formatList(listAction.listName, list.items)}` : `\n\nNo list named *${listAction.listName}* yet.`
      } else if (listAction.type === 'clear') {
        await clearList(telegramId, listAction.listName)
        listReply = `\n\nCleared *${listAction.listName}* list.`
      } else if (listAction.type === 'check' && listAction.itemText) {
        const items = await checkItem(telegramId, listAction.listName, listAction.itemText)
        listReply = items ? `\n\nToggled in *${listAction.listName}*` : `\n\nNo list named *${listAction.listName}*`
      } else if (listAction.type === 'all') {
        const lists = await getAllLists(telegramId)
        if (lists.length === 0) {
          listReply = `\n\nYou have no lists yet. Try: _"Add milk to shopping"_`
        } else {
          const summary = lists.map((l: { list_name: string; items: unknown[] }) =>
            `- *${l.list_name}* -- ${(l.items || []).length} items`
          ).join('\n')
          listReply = `\n\n*Your lists:*\n\n${summary}`
        }
      }
    }

    const finalReply = (isVoice ? `_Heard you via voice note_\n\n${reply}` : reply) + listReply

    await saveMessage(telegramId, 'assistant', reply)
    await sendMessage(chatId, finalReply)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}