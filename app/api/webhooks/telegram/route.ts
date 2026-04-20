import { NextRequest, NextResponse } from 'next/server'
import { askClaude, askClaudeWithContext } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { checkAndIncrementLimit } from '@/lib/limits'
import { transcribeVoice, downloadTelegramFile } from '@/lib/whisper'
import { addToList, getList, getAllLists, checkItem, clearList, formatList } from '@/lib/lists'
import { webSearch } from '@/lib/web-search'

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
    telegram_id: telegramId, chat_id: chatId, message,
    remind_at: remindAt, sent: false,
    is_recurring: isRecurring, recurring_pattern: recurringPattern,
  })
}

function parseResponse(raw: string) {
  let memory: string | null = null
  let reminder: { remindAt: string; message: string; isRecurring: boolean; pattern: string | null } | null = null
  let listAction: { type: string; listName: string; items?: string[]; itemText?: string } | null = null
  let searchQuery: string | null = null
  const filtered: string[] = []

  for (const line of raw.split('\n')) {
    if (line.startsWith('MEMORY:')) {
      memory = line.replace('MEMORY:', '').trim()
    } else if (line.startsWith('REMINDER:')) {
      const parts = line.replace('REMINDER:', '').trim().split('|')
      if (parts.length >= 2) {
        const isRecurring = parts.length >= 3 && parts[2].trim() !== ''
        reminder = { remindAt: parts[0].trim(), message: parts[1].trim(), isRecurring, pattern: isRecurring ? parts[2].trim() : null }
      }
    } else if (line.startsWith('LIST_ADD:')) {
      const parts = line.replace('LIST_ADD:', '').trim().split('|')
      if (parts.length >= 2) {
        listAction = { type: 'add', listName: parts[0].trim(), items: parts[1].split(',').map(s => s.trim()).filter(Boolean) }
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
    } else if (line.startsWith('SEARCH:')) {
      searchQuery = line.replace('SEARCH:', '').trim()
    } else {
      filtered.push(line)
    }
  }
  return { reply: filtered.join('\n').trim(), memory, reminder, listAction, searchQuery }
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

    // === VOICE NOTES ===
    if (message.voice) {
      await sendTyping(chatId)
      try {
        const fileBuffer = await downloadTelegramFile(message.voice.file_id)
        const transcribed = await transcribeVoice(fileBuffer)
        text = transcribed
        isVoice = true
      } catch (err) {
        console.error('Voice failed:', err)
        await sendMessage(chatId, 'Could not transcribe voice note. Please type instead.')
        return NextResponse.json({ ok: true })
      }
    }

    // === IMAGE ANALYSIS + EXPENSE TRACKING ===
    if (message.photo && message.photo.length > 0) {
      await sendTyping(chatId)
      try {
        const photoId = message.photo[message.photo.length - 1].file_id
        const fileBuffer = await downloadTelegramFile(photoId)
        const base64Image = fileBuffer.toString('base64')
        const caption = message.caption || 'What is in this image? Analyze it and extract any useful info.'

        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

        const visionResponse = await client.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Image } },
              { type: 'text', text: `You are AskGogo, a helpful AI assistant. The user sent this image${caption !== 'What is in this image? Analyze it and extract any useful info.' ? ' with caption: "' + caption + '"' : ''}. Analyze it and respond helpfully.

If this is a RECEIPT or BILL:
- Extract each item with its price
- Show the total amount
- Identify the store/merchant name
- On the FIRST LINE output: EXPENSE: [total_amount] | [category] | [merchant_name]
  Categories: food, transport, shopping, bills, health, entertainment, other
  Example: EXPENSE: 450 | food | Swiggy

If this is a BUSINESS CARD: extract name, phone, email, company, designation.
If this is a DOCUMENT or TEXT: summarize the key points.
Otherwise: describe what you see.

Keep reply concise, 3-5 sentences max.` }
            ]
          }],
        })

        let imageReply = visionResponse.content[0].type === 'text' ? visionResponse.content[0].text : 'Could not analyze the image.'

        // Check if receipt/expense was detected
        const firstLine = imageReply.split('\n')[0]
        if (firstLine.startsWith('EXPENSE:')) {
          const parts = firstLine.replace('EXPENSE:', '').trim().split('|')
          if (parts.length >= 3) {
            try {
              await supabaseAdmin.from('expenses').insert({
                telegram_id: telegramId,
                amount: parseFloat(parts[0].trim()) || 0,
                category: parts[1].trim(),
                description: parts[2].trim(),
                source: 'receipt_photo',
              })
            } catch (e) {
              console.error('Expense insert failed:', e)
            }
          }
          const cleanReply = imageReply.split('\n').slice(1).join('\n').trim()
          imageReply = cleanReply + `\n\n_Expense of Rs ${parts[0]?.trim()} logged under ${parts[1]?.trim()}_`
        }

        await getOrCreateUser(telegramId, name, username)
        await saveMessage(telegramId, 'user', `[Photo]: ${caption}`)
        await saveMessage(telegramId, 'assistant', imageReply)
        await sendMessage(chatId, imageReply)
        return NextResponse.json({ ok: true })
      } catch (err) {
        console.error('Image analysis failed:', err)
        await sendMessage(chatId, 'Could not analyze the image. Please try again.')
        return NextResponse.json({ ok: true })
      }
    }

    // === DOCUMENT ANALYSIS ===
    if (message.document) {
      await sendTyping(chatId)
      try {
        const doc = message.document
        const fileName = doc.file_name || 'document'
        const mimeType = doc.mime_type || ''
        const caption = message.caption || `Analyze this document: ${fileName}`

        if (doc.file_size && doc.file_size > 10 * 1024 * 1024) {
          await sendMessage(chatId, 'File is too large. Please send documents under 10MB.')
          return NextResponse.json({ ok: true })
        }

        const fileBuffer = await downloadTelegramFile(doc.file_id)
        let extractedText = ''

        if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) {
          const pdfParse = (await import('pdf-parse')).default
          const pdfData = await pdfParse(fileBuffer)
          extractedText = pdfData.text.slice(0, 8000)
        } else if (
          mimeType === 'text/plain' ||
          fileName.endsWith('.txt') ||
          fileName.endsWith('.csv') ||
          fileName.endsWith('.json') ||
          fileName.endsWith('.md')
        ) {
          extractedText = fileBuffer.toString('utf-8').slice(0, 8000)
        } else if (
          mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          fileName.endsWith('.docx')
        ) {
          const JSZip = (await import('jszip')).default
          const zip = await JSZip.loadAsync(fileBuffer)
          const xmlContent = await zip.file('word/document.xml')?.async('text')
          if (xmlContent) {
            extractedText = xmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
          }
        } else if (
          mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          fileName.endsWith('.xlsx') ||
          fileName.endsWith('.xls')
        ) {
          const XLSX = (await import('xlsx')).default
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' })
          const sheetName = workbook.SheetNames[0]
          const sheet = workbook.Sheets[sheetName]
          extractedText = XLSX.utils.sheet_to_csv(sheet).slice(0, 8000)
        } else {
          await sendMessage(chatId, `I can read PDF, Word (.docx), Excel (.xlsx), text, CSV, and JSON files. This file type (${mimeType || fileName}) is not supported yet.`)
          return NextResponse.json({ ok: true })
        }

        if (!extractedText || extractedText.trim().length < 10) {
          await sendMessage(chatId, 'Could not extract text from this document. It might be image-based or encrypted.')
          return NextResponse.json({ ok: true })
        }

        const Anthropic = (await import('@anthropic-ai/sdk')).default
        const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

        const docResponse = await client.messages.create({
          model: 'claude-sonnet-4-5',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: `You are AskGogo, a helpful AI assistant. The user sent a document called "${fileName}". Their request: "${caption}"\n\nDocument content:\n${extractedText}\n\nProvide a helpful analysis. If they asked to summarize, give a clear summary. If they asked a specific question, answer it from the document. Keep response concise but thorough.`
          }],
        })

        const docReply = docResponse.content[0].type === 'text'
          ? docResponse.content[0].text
          : 'Could not analyze the document.'

        await getOrCreateUser(telegramId, name, username)
        await saveMessage(telegramId, 'user', `[Document: ${fileName}]: ${caption}`)
        await saveMessage(telegramId, 'assistant', docReply)
        await sendMessage(chatId, docReply)
        return NextResponse.json({ ok: true })
      } catch (err) {
        console.error('Document analysis failed:', err)
        await sendMessage(chatId, 'Could not read this document. Please try a different format (PDF, Word, Excel, or text).')
        return NextResponse.json({ ok: true })
      }
    }

    if (!text) return NextResponse.json({ ok: true })
    await sendTyping(chatId)
    await getOrCreateUser(telegramId, name, username)

    // === COMMANDS ===
    if (text === '/start') {
      await sendMessage(chatId,
        `Hey ${name}! I'm *AskGogo*, your personal AI assistant.\n\n` +
        `*Remember* -- _"Remember my gym is at 7am"_\n` +
        `*Remind* -- _"Remind me to call Divya at 5pm"_\n` +
        `*Lists* -- _"Add milk to shopping"_\n` +
        `*Voice* -- send a voice note!\n` +
        `*Photo* -- send a photo or receipt!\n` +
        `*Docs* -- send PDF, Word, or Excel!\n` +
        `*Search* -- _"Search latest AI news"_\n\n` +
        `Commands:\n/memory /reminders /lists /calendar /briefing /expenses\n/dashboard /upgrade /trial /help`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/help') {
      await sendMessage(chatId,
        `*AskGogo Commands:*\n\n` +
        `/memory -- saved memories\n/reminders -- upcoming\n/lists -- your lists\n` +
        `/calendar -- Google Calendar\n/briefing -- daily 7am briefing\n` +
        `/expenses -- view tracked expenses\n` +
        `/dashboard -- web view\n/upgrade -- plans\n/trial -- 7-day free Pro\n/help -- this menu\n\n` +
        `Also: voice notes, photos, documents, web search, and natural language for everything.`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/memory') {
      const memories = await getMemories(telegramId)
      if (memories.length === 0) {
        await sendMessage(chatId, 'No memories yet. Try: _"Remember I prefer black coffee"_')
      } else {
        await sendMessage(chatId, `*What I remember:*\n\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`)
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/reminders') {
      const { data } = await supabaseAdmin
        .from('reminders').select('message, remind_at, is_recurring, recurring_pattern')
        .eq('telegram_id', telegramId).eq('sent', false)
        .order('remind_at', { ascending: true }).limit(10)
      if (!data || data.length === 0) {
        await sendMessage(chatId, 'No upcoming reminders.')
      } else {
        const list = data.map((r: any) => {
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
        await sendMessage(chatId, 'No lists yet. Try: _"Add milk to shopping"_')
      } else {
        const summary = lists.map((l: any) => `- *${l.list_name}* -- ${(l.items || []).length} items`).join('\n')
        await sendMessage(chatId, `*Your lists:*\n\n${summary}\n\nSay _"show shopping"_ to see items.`)
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/expenses') {
      const { data: expenses } = await supabaseAdmin
        .from('expenses')
        .select('amount, category, description, date')
        .eq('telegram_id', telegramId)
        .order('created_at', { ascending: false })
        .limit(15)

      if (!expenses || expenses.length === 0) {
        await sendMessage(chatId, 'No expenses tracked yet.\n\nSend a photo of any receipt and I will extract and log it automatically!')
        return NextResponse.json({ ok: true })
      }

      let total = 0
      const lines = expenses.map((e: any) => {
        total += parseFloat(e.amount) || 0
        return `- Rs ${e.amount} | ${e.category} | ${e.description} (${e.date})`
      })

      await sendMessage(chatId,
        `*Recent Expenses:*\n\n${lines.join('\n')}\n\n*Total:* Rs ${total.toFixed(0)}\n\n_Send receipt photos to track more!_`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/briefing') {
      const { data: user } = await supabaseAdmin
        .from('users').select('briefing_enabled')
        .eq('telegram_id', telegramId).single()

      const isEnabled = user?.briefing_enabled || false
      const newState = !isEnabled

      await supabaseAdmin.from('users')
        .update({ briefing_enabled: newState })
        .eq('telegram_id', telegramId)

      if (newState) {
        await sendMessage(chatId,
          `*Daily briefing enabled!*\n\n` +
          `Every morning at 7:00 AM IST you will get:\n` +
          `- Today's reminders\n- Pending list items\n- Memory stats\n\n` +
          `Type /briefing again to disable.`
        )
      } else {
        await sendMessage(chatId, 'Daily briefing disabled. Type /briefing to re-enable.')
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/calendar') {
      const { data: user } = await supabaseAdmin
        .from('users').select('google_calendar_connected, google_refresh_token')
        .eq('telegram_id', telegramId).single()

      if (user?.google_calendar_connected && user?.google_refresh_token) {
        const { refreshAccessToken, getTodayEvents } = await import('@/lib/google-calendar')
        const accessToken = await refreshAccessToken(user.google_refresh_token)
        if (accessToken) {
          const events = await getTodayEvents(accessToken)
          if (events.length === 0) {
            await sendMessage(chatId, '*Calendar:* No events today!')
          } else {
            const list = events.map((e: any) => {
              const start = e.start?.dateTime
                ? new Date(e.start.dateTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
                : 'All day'
              return `- ${start} -- ${e.summary || 'Untitled'}`
            }).join('\n')
            await sendMessage(chatId, `*Today's calendar:*\n\n${list}`)
          }
        } else {
          await sendMessage(chatId, `Calendar connection expired. Reconnect:\n${BASE_URL}/api/calendar/connect?id=${telegramId}`)
        }
      } else {
        await sendMessage(chatId,
          `*Connect Google Calendar*\n\nLink your calendar to sync events:\n\n` +
          `${BASE_URL}/api/calendar/connect?id=${telegramId}`
        )
      }
      return NextResponse.json({ ok: true })
    }

    if (text === '/dashboard') {
      await sendMessage(chatId, `*Your Dashboard*\n\n${BASE_URL}/dashboard?id=${telegramId}`)
      return NextResponse.json({ ok: true })
    }

    if (text === '/trial') {
      const { data: user } = await supabaseAdmin
        .from('users').select('trial_started_at, tier')
        .eq('telegram_id', telegramId).single()

      if (user?.trial_started_at) {
        await sendMessage(chatId, `You've already used your 7-day trial.\n\nUpgrade: ${BASE_URL}/upgrade?id=${telegramId}&plan=pro`)
        return NextResponse.json({ ok: true })
      }
      if (user?.tier === 'pro' || user?.tier === 'starter') {
        await sendMessage(chatId, 'You are already on a paid plan!')
        return NextResponse.json({ ok: true })
      }

      const trialEnds = new Date()
      trialEnds.setDate(trialEnds.getDate() + 7)

      await supabaseAdmin.from('users').update({
        tier: 'pro', is_trial: true,
        trial_started_at: new Date().toISOString(),
        trial_ends_at: trialEnds.toISOString(),
        tier_expires_at: trialEnds.toISOString(),
      }).eq('telegram_id', telegramId)

      await sendMessage(chatId,
        `*7-day Pro trial activated!*\n\n` +
        `You now have:\n- Unlimited messages\n- Voice notes\n- Lists\n- Image analysis\n- Document analysis\n- Web search\n- Expense tracking\n- Calendar sync\n- Daily briefings\n- Priority AI\n\n` +
        `Trial ends: ${trialEnds.toLocaleDateString('en-IN')}\n\nType /upgrade to see plans.`
      )
      return NextResponse.json({ ok: true })
    }

    if (text === '/upgrade') {
      const { data: user } = await supabaseAdmin
        .from('users').select('tier, is_trial, trial_ends_at, trial_started_at')
        .eq('telegram_id', telegramId).single()
      const currentTier = user?.tier || 'free'
      const isTrial = user?.is_trial || false

      let trialLine = ''
      if (isTrial && user?.trial_ends_at) {
        const ends = new Date(user.trial_ends_at).toLocaleDateString('en-IN')
        trialLine = `\n_Trial active (ends ${ends})_\n`
      }

      await sendMessage(chatId,
        `*AskGogo Plans*\n${trialLine}\n` +
        `${currentTier === 'free' && !isTrial ? '(current) ' : ''}*Free* -- Rs 0\n20 msgs/day, 10 memories\n\n` +
        `*Starter* -- Rs 149/month\n150 msgs/day, voice, 50 memories\n\n` +
        `*Pro* -- Rs 299/month\nUnlimited, all features\n\n` +
        `*Lifetime* -- Rs 9,999 one-time\nAll features forever\n\n` +
        `${!user?.trial_started_at ? 'Free trial: /trial\n\n' : ''}` +
        `Pay:\nStarter: ${BASE_URL}/upgrade?id=${telegramId}&plan=starter\n` +
        `Pro: ${BASE_URL}/upgrade?id=${telegramId}&plan=pro\n` +
        `Lifetime: ${BASE_URL}/upgrade?id=${telegramId}&plan=lifetime`
      )
      return NextResponse.json({ ok: true })
    }

    // === LIMIT CHECK ===
    const limitCheck = await checkAndIncrementLimit(telegramId)
    if (!limitCheck.allowed) {
      await sendMessage(chatId, limitCheck.upgradeMessage!)
      return NextResponse.json({ ok: true })
    }
    if (limitCheck.remaining === 3) {
      await sendMessage(chatId, 'Only 3 messages left today. Type /upgrade to get more.')
    }

    // === AI RESPONSE ===
    const [history, memories] = await Promise.all([getHistory(telegramId), getMemories(telegramId)])
    const messageForClaude = isVoice ? `[Voice note]: ${text}` : text

    await saveMessage(telegramId, 'user', messageForClaude)
    const rawResponse = await askClaude(messageForClaude, history, memories, name)
    const { reply, memory, reminder, listAction, searchQuery } = parseResponse(rawResponse)

    if (memory) await saveMemory(telegramId, memory)
    if (reminder) await saveReminder(telegramId, chatId, reminder.remindAt, reminder.message, reminder.isRecurring, reminder.pattern)

    // Handle web search
    let searchReply = ''
    if (searchQuery) {
      await sendTyping(chatId)
      const searchResults = await webSearch(searchQuery)
      searchReply = await askClaudeWithContext(messageForClaude, searchResults, name)
    }

    // Handle list actions
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
        if (lists.length === 0) { listReply = `\n\nNo lists yet.` }
        else {
          const summary = lists.map((l: any) => `- *${l.list_name}* -- ${(l.items || []).length} items`).join('\n')
          listReply = `\n\n*Your lists:*\n\n${summary}`
        }
      }
    }

    // Build final reply
    let finalReply = ''
    if (searchReply) {
      finalReply = searchReply + listReply
    } else {
      finalReply = (isVoice ? `_Heard you via voice note_\n\n${reply}` : reply) + listReply
    }

    await saveMessage(telegramId, 'assistant', searchReply || reply)
    await sendMessage(chatId, finalReply)

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ ok: true })
  }
}