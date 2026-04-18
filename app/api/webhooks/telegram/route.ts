import { NextRequest, NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkAndIncrementLimit } from '@/lib/limits'
import { transcribeVoice, downloadTelegramFile } from '@/lib/whisper'

export const dynamic = 'force-dynamic'

const BOT = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`
const BASE_URL = 'https://gogo-memory-os.vercel.app'

// ─── Telegram helpers ────────────────────────────────────────────────
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

// ─── User management ─────────────────────────────────────────────────
async function getOrCreateUser(telegramId: number, name: string, username?: string) {
  const { data: existing } = await supabaseAdmin
    .from('users').select('*').eq('telegram_id', telegramId).single()
  if (existing) return existing
  const { data: newUser } = await supabaseAdmin
    .from('users').insert({ telegram_id: telegramId, name, username }).select().single()
  return newUser
}

// ─── Conversation history ─────────────────────────────────────────────
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

// ─── Memory ──────────────────────────────────────────────────────────
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

// ─── Reminders ───────────────────────────────────────────────────────
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

// ─── Parse Claude response ────────────────────────────────────────────
function parseResponse(raw: string) {
  let memory: string | null = null
  let reminder: { remindAt: string; message: string; isRecurring: boolean; pattern: string | null } | null = null
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
    } else {
      filtered.push(line)
    }
  }

  return { reply: filtered.join('\n').trim(), memory, reminder }
}

// ─── Main webhook ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const update = await req.json()
    const message = update.message
    if (!message) return NextResponse.json({ ok: true })

    const chatId: number = message.chat.id
    const telegramId: number = message.from.id
    const name: string = message.from.first_name || 'Friend'
    const username: string = message.from.username || ''

    // Handle voice notes
    let text: string = message.text || ''
    let isVoice = false

    if (message.voice) {
      await sendTyping(chatId)
      try {
        const fileBuffer = await downloadTelegramFile(message.voice.file_id)
        const transcribed = await transcribeVoice(fileBuffer, 'audio/ogg')
        text = transcribed
        isVoice = true
        console.log(`🎤 Voice transcribed for ${telegramId}: "${text}"`)
      } catch (err) {
        console.error('Voice transcription failed:', err)
        await sendMessage(chatId, `❌ Couldn't transcribe your voice note. Please try again or type your message.`)
        return NextResponse.json({ ok: true })
      }
    }

    if (!text) return NextResponse.json({ ok: true })

    await sendTyping(chatId)
    await getOrCreateUser(telegramId, name, username)

    // ── Commands ─────────────────────────────────────────────────────
    if (text === '/start') {
      await sendMessage(chatId,
        `👋 Hey ${name}! I'm *AskGogo*, your personal AI assistant.\n\n` +
        `🧠 *Remember* — _"Remember my gym is at 7am"_\n` +
        `⏰ *Remind* — _"Remind me to call Bareen at 5pm"_\n` +
        `🔁 *Recurring* — _"Remind me every Monday at 9am to review goals"_\n` +
        `🎤 *Voice* — send a voice note, I understand it!\n` +
        `💬 *Ask* — anything, with full memory context\n\n` +
        `*Commands:*\n` +
        `/memory — see what I remember\n` +
        `/reminders — upcoming reminders\n` +
        `/dashboard — full web view\n` +
        `/upgrade — see plans & pricing\n` +
        `/help — show this menu`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/help') {
      await sendMessage(chatId,
        `*AskGogo Commands:*\n\n` +
        `/memory — view all saved memories\n` +
        `/reminders — view upcoming reminders\n` +
        `/dashboard — open web dashboard\n` +
        `/upgrade — view plans & pricing\n` +
        `/help — show this menu\n\n` +
        `🎤 *Voice notes supported!* Just send a voice message.\n` +
        `🔁 *Recurring reminders:* "every day at 8am", "every Monday at 9am"`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/memory') {
      const memories = await getMemories(telegramId)
      if (memories.length === 0) {
        await sendMessage(chatId, `🧠 No memories yet.\n\nTry: _"Remember that I prefer black coffee"_`)
      } else {
        await sendMessage(chatId,
          `🧠 *What I remember about you:*\n\n` +
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
        await sendMessage(chatId, `⏰ No upcoming reminders.\n\nTry: _"Remind me every Monday at 9am to review my goals"_`)
      } else {
        const list = data.map((r: {
          message: string
          remind_at: string
          is_recurring: boolean
          recurring_pattern: string
        }) => {
          const dt = new Date(r.remind_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          const tag = r.is_recurring ? ` 🔁 ${r.recurring_pattern}` : ''
          return `• ${r.message} — ${dt}${tag}`
        }).join('\n')
        await sendMessage(chatId, `⏰ *Upcoming reminders:*\n\n${list}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/dashboard') {
      await sendMessage(chatId,
        `📊 *Your AskGogo Dashboard*\n\n` +
        `👉 ${BASE_URL}/dashboard?id=${telegramId}`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/upgrade') {
      const { data: user } = await supabaseAdmin
        .from('users').select('tier').eq('telegram_id', telegramId).single()
      const currentTier = user?.tier || 'free'
      await sendMessage(chatId,
        `⚡ *AskGogo Plans*\n\n` +
        `${currentTier === 'free' ? '✅ ' : ''}*Free* — ₹0\n• 20 msgs/day • 10 memories\n\n` +
        `${currentTier === 'starter' ? '✅ ' : ''}*Starter* — ₹299/month\n• 100 msgs/day • Voice notes • 50 memories\n\n` +
        `${currentTier === 'pro' ? '✅ ' : ''}*Pro* — ₹999/month\n• Unlimited • 500 memories • Team reminders\n\n` +
        `👉 ${BASE_URL}/upgrade?id=${telegramId}`
      )
      return NextResponse.json({ ok: true })
    }

    // ── Usage limit check ─────────────────────────────────────────────
    const limitCheck = await checkAndIncrementLimit(telegramId)
    if (!limitCheck.allowed) {
      await sendMessage(chatId, limitCheck.upgradeMessage!)
      return NextResponse.json({ ok: true })
    }
    if (limitCheck.remaining === 3) {
      await sendMessage(chatId,
        `⚠️ Only *3 messages* left today on free plan.\nType /upgrade to get more.`
      )
    }

    // ── AI response ───────────────────────────────────────────────────
    const [history, memories] = await Promise.all([
      getHistory(telegramId),
      getMemories(telegramId),
    ])

    // If voice, prepend context so Claude knows
    const messageForClaude = isVoice
      ? `[Voice note transcribed]: ${text}`
      : text

    await saveMessage(telegramId, 'user', messageForClaude)
    const rawResponse = await askClaude(messageForClaude, history, memories, name)
    const { reply, memory, reminder } = parseResponse(rawResponse)

    if (memory) await saveMemory(telegramId, memory)
    if (reminder) {
      await saveReminder(
        telegramId, chatId,
        reminder.remindAt, reminder.message,
        reminder.isRecurring, reminder.pattern
      )
    }

    // Add voice indicator to reply
    const finalReply = isVoice ? `🎤 _Heard you!_\n\n${reply}` : reply

    await saveMessage(telegramId, 'assistant', reply)
    await sendMessage(chatId, finalReply)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}