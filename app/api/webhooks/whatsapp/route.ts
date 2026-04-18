import { NextRequest, NextResponse } from 'next/server'
import { askClaude } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkAndIncrementLimit } from '@/lib/limits'
import { sendWhatsApp } from '@/lib/whatsapp'
import { addToList, getList, getAllLists, checkItem, clearList, formatList } from '@/lib/lists'

export const dynamic = 'force-dynamic'

// WhatsApp uses same logic but different send function
async function getOrCreateWhatsAppUser(whatsappId: string, name: string) {
  const { data: existing } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('whatsapp_id', whatsappId)
    .single()

  if (existing) return existing

  // Use negative number for whatsapp "telegram_id" so it doesn't collide
  const fakeTgId = -Math.abs(parseInt(whatsappId.replace(/\D/g, '').slice(-10)))

  const { data: newUser } = await supabaseAdmin
    .from('users')
    .insert({
      telegram_id: fakeTgId,
      whatsapp_id: whatsappId,
      name,
      platform: 'whatsapp',
    })
    .select()
    .single()

  return newUser
}

async function getHistory(userId: number) {
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('role, content')
    .eq('telegram_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
  return (data || []).reverse() as { role: 'user' | 'assistant'; content: string }[]
}

async function saveMessage(userId: number, role: 'user' | 'assistant', content: string) {
  await supabaseAdmin.from('conversations').insert({ telegram_id: userId, role, content })
}

async function getMemories(userId: number): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('content')
    .eq('telegram_id', userId)
    .order('created_at', { ascending: false })
    .limit(20)
  return (data || []).map((m: { content: string }) => m.content)
}

async function saveMemory(userId: number, content: string) {
  await supabaseAdmin.from('memories').insert({ telegram_id: userId, content })
}

async function saveReminder(
  userId: number,
  whatsappId: string,
  remindAt: string,
  message: string,
  isRecurring: boolean = false,
  recurringPattern: string | null = null
) {
  await supabaseAdmin.from('reminders').insert({
    telegram_id: userId,
    chat_id: 0, // unused for whatsapp
    whatsapp_to: whatsappId,
    message,
    remind_at: remindAt,
    sent: false,
    is_recurring: isRecurring,
    recurring_pattern: recurringPattern,
  })
}

function parseResponse(raw: string) {
  let memory: string | null = null
  let reminder: { remindAt: string; message: string; isRecurring: boolean; pattern: string | null } | null = null
  let listAction: { type: string; listName: string; items?: string[]; itemText?: string } | null = null
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
    // Twilio sends form-encoded data, not JSON
    const formData = await req.formData()
    const from = formData.get('From')?.toString() || ''
    const body = formData.get('Body')?.toString() || ''
    const profileName = formData.get('ProfileName')?.toString() || 'Friend'

    if (!from || !body) {
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // Extract phone number (from is like "whatsapp:+919876543210")
    const whatsappNumber = from.replace('whatsapp:', '')
    console.log(`📱 WhatsApp [${whatsappNumber}] ${profileName}: ${body}`)

    // Get or create user
    const user = await getOrCreateWhatsAppUser(whatsappNumber, profileName)
    if (!user) {
      await sendWhatsApp(whatsappNumber, 'Welcome! Creating your account...')
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    const userId = user.telegram_id

    // Handle /start
    if (body === '/start' || body.toLowerCase() === 'hi' || body.toLowerCase() === 'hello') {
      await sendWhatsApp(whatsappNumber,
        `👋 Hey ${profileName}! I'm *AskGogo*, your personal AI assistant on WhatsApp.\n\n` +
        `🧠 *Remember* — _"Remember my gym is at 7am"_\n` +
        `⏰ *Remind* — _"Remind me to call Divya at 5pm"_\n` +
        `📋 *Lists* — _"Add milk to shopping"_\n` +
        `🎤 *Voice* — send a voice note!\n\n` +
        `Commands: /memory /reminders /lists /help`
      )
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    if (body === '/help') {
      await sendWhatsApp(whatsappNumber,
        `*AskGogo Commands:*\n\n/memory — saved memories\n/reminders — upcoming reminders\n/lists — all your lists\n/help — this menu\n\nOr just talk naturally!`
      )
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    if (body === '/memory') {
      const memories = await getMemories(userId)
      if (memories.length === 0) {
        await sendWhatsApp(whatsappNumber, `🧠 No memories yet. Try: _"Remember my coffee is black"_`)
      } else {
        await sendWhatsApp(whatsappNumber, `🧠 *What I remember:*\n\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`)
      }
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    if (body === '/lists') {
      const lists = await getAllLists(userId)
      if (lists.length === 0) {
        await sendWhatsApp(whatsappNumber, `📋 No lists yet. Try: _"Add milk to shopping"_`)
      } else {
        const summary = lists.map(l => `• *${l.list_name}* — ${(l.items || []).length} items`).join('\n')
        await sendWhatsApp(whatsappNumber, `📋 *Your lists:*\n\n${summary}`)
      }
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    if (body === '/reminders') {
      const { data } = await supabaseAdmin
        .from('reminders')
        .select('message, remind_at, is_recurring, recurring_pattern')
        .eq('telegram_id', userId)
        .eq('sent', false)
        .order('remind_at', { ascending: true })
        .limit(10)
      if (!data || data.length === 0) {
        await sendWhatsApp(whatsappNumber, `⏰ No upcoming reminders.`)
      } else {
        const list = data.map((r: any) => {
          const dt = new Date(r.remind_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
          const tag = r.is_recurring ? ` 🔁` : ''
          return `• ${r.message} — ${dt}${tag}`
        }).join('\n')
        await sendWhatsApp(whatsappNumber, `⏰ *Upcoming:*\n\n${list}`)
      }
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    // Usage limit
    const limitCheck = await checkAndIncrementLimit(userId)
    if (!limitCheck.allowed) {
      await sendWhatsApp(whatsappNumber, limitCheck.upgradeMessage!)
      return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

    // AI reply
    const [history, memories] = await Promise.all([
      getHistory(userId),
      getMemories(userId),
    ])

    await saveMessage(userId, 'user', body)
    const rawResponse = await askClaude(body, history, memories, profileName)
    const { reply, memory, reminder, listAction } = parseResponse(rawResponse)

    if (memory) await saveMemory(userId, memory)
    if (reminder) {
      await saveReminder(userId, whatsappNumber, reminder.remindAt, reminder.message, reminder.isRecurring, reminder.pattern)
    }

    let listReply = ''
    if (listAction) {
      if (listAction.type === 'add' && listAction.items) {
        const items = await addToList(userId, listAction.listName, listAction.items)
        listReply = `\n\n✅ Added ${listAction.items.length} items to *${listAction.listName}* (${items.length} total)`
      } else if (listAction.type === 'show') {
        const list = await getList(userId, listAction.listName)
        listReply = list ? `\n\n${formatList(listAction.listName, list.items)}` : `\n\n📋 No list named *${listAction.listName}* yet.`
      } else if (listAction.type === 'clear') {
        await clearList(userId, listAction.listName)
        listReply = `\n\n🗑️ Cleared *${listAction.listName}* list.`
      } else if (listAction.type === 'check' && listAction.itemText) {
        const items = await checkItem(userId, listAction.listName, listAction.itemText)
        listReply = items ? `\n\n✓ Toggled in *${listAction.listName}*` : `\n\n❌ No list`
      } else if (listAction.type === 'all') {
        const lists = await getAllLists(userId)
        if (lists.length === 0) {
          listReply = `\n\n📋 No lists yet.`
        } else {
          const summary = lists.map((l: any) => `• *${l.list_name}* — ${(l.items || []).length} items`).join('\n')
          listReply = `\n\n📋 *Your lists:*\n\n${summary}`
        }
      }
    }

    const finalReply = reply + listReply
    await saveMessage(userId, 'assistant', reply)
    await sendWhatsApp(whatsappNumber, finalReply)

    return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  } catch (error) {
    console.error('WhatsApp webhook error:', error)
    return new Response('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }
}