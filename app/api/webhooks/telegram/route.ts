import { NextRequest, NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

async function sendMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}

async function sendTyping(chatId: number) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
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
  return (data || []).map(m => m.content)
}

async function saveMemory(telegramId: number, content: string) {
  await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content })
}

async function saveReminder(telegramId: number, chatId: number, remindAt: string, message: string) {
  await supabaseAdmin.from('reminders').insert({
    telegram_id: telegramId, chat_id: chatId, message, remind_at: remindAt, sent: false,
  })
}

function parseResponse(raw: string) {
  let memory: string | null = null
  let reminder: { remindAt: string; message: string } | null = null
  const filtered: string[] = []

  for (const line of raw.split('\n')) {
    if (line.startsWith('MEMORY:')) {
      memory = line.replace('MEMORY:', '').trim()
    } else if (line.startsWith('REMINDER:')) {
      const parts = line.replace('REMINDER:', '').trim().split('|')
      if (parts.length === 2) {
        reminder = { remindAt: parts[0].trim(), message: parts[1].trim() }
      }
    } else {
      filtered.push(line)
    }
  }

  return { reply: filtered.join('\n').trim(), memory, reminder }
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
    const text: string = message.text || ''

    if (!text) return NextResponse.json({ ok: true })

    await sendTyping(chatId)

    if (text === '/start') {
      await getOrCreateUser(telegramId, name, username)
      await sendMessage(chatId,
        `👋 Hey ${name}! I'm *AskGogo*, your personal AI assistant.\n\n` +
        `I can:\n🧠 *Remember* things you tell me\n` +
        `⏰ *Remind* you at the right time\n` +
        `💬 *Answer* anything with full context\n\n` +
        `Try: _"Remember that my wife's birthday is May 15"_\n` +
        `Or: _"Remind me to call Bareen tomorrow at 9am"_`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/memory') {
      const memories = await getMemories(telegramId)
      if (memories.length === 0) {
        await sendMessage(chatId, `🧠 No memories yet. Tell me something like _"Remember that I prefer meetings after 10am"_`)
      } else {
        await sendMessage(chatId, `🧠 *What I remember:*\n\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/reminders') {
      const { data } = await supabaseAdmin
        .from('reminders').select('message, remind_at')
        .eq('telegram_id', telegramId).eq('sent', false)
        .order('remind_at', { ascending: true }).limit(10)
      if (!data || data.length === 0) {
        await sendMessage(chatId, `⏰ No upcoming reminders.`)
      } else {
        const list = data.map(r => {
          const dt = new Date(r.remind_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          return `• ${r.message} — ${dt}`
        }).join('\n')
        await sendMessage(chatId, `⏰ *Upcoming reminders:*\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    await getOrCreateUser(telegramId, name, username)
    const [history, memories] = await Promise.all([
      getHistory(telegramId),
      getMemories(telegramId),
    ])

    await saveMessage(telegramId, 'user', text)
    const rawResponse = await askClaude(text, history, memories, name)
    const { reply, memory, reminder } = parseResponse(rawResponse)

    if (memory) await saveMemory(telegramId, memory)
    if (reminder) await saveReminder(telegramId, chatId, reminder.remindAt, reminder.message)

    await saveMessage(telegramId, 'assistant', reply)
    await sendMessage(chatId, reply)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}