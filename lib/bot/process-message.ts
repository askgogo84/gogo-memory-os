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
import { getLatestFollowupState, saveFollowupState } from './handlers/followup-state'
import { buildEmailActionReply } from './handlers/email-actions'
import { styleReplyByIntent } from './handlers/response-style'
import { buildAmPmClarificationReply, getAmbiguousReminderTime, buildReminderConfirmation, parseReminderIntent } from './handlers/reminders'
import { buildAmPmReminderSetReply, buildReminderFromAmPmChoice, isAmPmChoice } from './handlers/reminder-ampm-followup'
import { editLatestReminder } from './handlers/edit-reminder'
import { buildMorningBriefing } from './handlers/morning-briefing'
import { setBriefingTime } from './handlers/briefing-settings'
import { buildDeterministicWeatherReply, buildDeterministicGoldReply, buildDeterministicIplStandingsReply } from './handlers/deterministic'
import { buildDirectWebAnswer } from './handlers/web-answer'
import { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'
import { buildCalendarActionReply, createCalendarConflictEvent, isCalendarAction } from './handlers/calendar-actions'
import { isCalendarConflictMoveCommand, moveCalendarConflictEvent } from './handlers/calendar-conflict-followup'
import { buildPlanMyDayReply, createDayPlanReminders, isPlanMyDayIntent } from './handlers/plan-my-day'
import { handleNutritionText, isNutritionLogText } from './handlers/nutrition'
import { isMediaMemoryCommand, buildMediaMemoryReply, saveMediaMemory, detectPlatformFromText } from '@/lib/services/media-memory'
import { indexMemory } from '@/lib/services/memory-index'
import { detectPreferenceSave, isPreferenceList, detectPreferenceForget, savePreference, listPreferences, forgetPreference, getPreferenceBlock, MAX_RULES } from '@/lib/bot/handlers/preferences'
import { detectFriendReminder, normalizePhoneNumber, resolveFriendContact, saveFriendContact, countTodayFriendReminders, createFriendReminder, getPendingFriend, pendingFriendMarker, FRIEND_DAILY_CAP, cap0 } from '@/lib/bot/handlers/friend-reminders'
import { detectShareIntent, hasTopic, resolveRecipientTelegramId, grantShare } from '@/lib/bot/handlers/shared-memory'
import { isFollowupReminderText, parseFollowupReminder, buildFollowupConfirmation } from '@/lib/services/followup-reminder'
import { isTranslationRequest, translateText, buildTranslationReply, parseTargetLanguage } from '@/lib/services/translator'
import { detectReelUrl, detectInstagramPreviewCard, detectLinkedInPreviewCard } from '@/lib/services/reel-saver'

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
  mediaUrl?: string
  mediaType?: string
}

async function getConversationHistory(telegramId: number): Promise<Message[]> {
  // Fetch most recent 20 messages (descending), then reverse for chronological order
  const { data } = await supabaseAdmin
    .from('conversations')
    .select('role, content')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(20)

  return ((data || []) as any[])
    .filter((x) => x.role === 'user' || x.role === 'assistant')
    .map((x) => ({ role: x.role, content: x.content }))
    .reverse() // restore chronological order for Claude context
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

async function saveMemory(telegramId: number, content: string, topic: string | null = null) {
  const { data } = await supabaseAdmin
    .from('memories')
    .insert({ telegram_id: telegramId, content })
    .select('id')
    .single()
  // Awaited semantic index (survives serverless response). Never blocks the save on failure.
  if (data?.id) {
    await indexMemory({ telegramId, sourceId: String(data.id), content, topic })
  }
}

function parseTopicSave(text: string): { topic: string; fact: string } | null {
  let m = text.match(/^\s*remember\s+(?:for|in|to)\s+(?:my\s+)?(.+?)\s+(?:bucket|space|topic)\s*[:,\-]?\s*(.+)$/i)
  if (m) return { topic: m[1].trim().toLowerCase(), fact: m[2].trim() }
  m = text.match(/^\s*(?:save|add)\s+to\s+(?:my\s+)?(.+?)\s+(?:bucket|space|topic)\s*[:,\-]?\s*(.+)$/i)
  if (m) return { topic: m[1].trim().toLowerCase(), fact: m[2].trim() }
  m = text.match(/^\s*remember\s+for\s+(.+?)\s*:\s*(.+)$/i)
  if (m) return { topic: m[1].trim().toLowerCase(), fact: m[2].trim() }
  return null
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

// Read the user's saved timezone so every reminder row records the zone its
// remind_at was computed against (reminders.timezone was previously always null).
async function resolveReminderTimezone(telegramId: number): Promise<string> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('timezone')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  return data?.timezone || 'Asia/Kolkata'
}

async function createReminder(
  telegramId: number,
  chatId: number,
  remindAt: string,
  message: string,
  pattern?: string,
  whatsappTo?: string | null
) {
  const timezone = await resolveReminderTimezone(telegramId)
  if (pattern) {
    const duplicate = await findDuplicateRecurringReminder(telegramId, pattern)
    if (duplicate?.id) {
      const updatePayload: any = { remind_at: remindAt, sent: false, timezone }
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

  const payload: any = { telegram_id: telegramId, chat_id: chatId, message, remind_at: remindAt, sent: false, timezone }
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

function isFreshFollowupState(state: any, maxMinutes = 10) {
  if (!state?.created_at && !state?.payload?.created_at) return true
  const raw = state.created_at || state.payload.created_at
  const createdAt = new Date(raw).getTime()
  if (!Number.isFinite(createdAt)) return true
  return Date.now() - createdAt <= maxMinutes * 60 * 1000
}

export async function processIncomingMessage(params: ProcessIncomingParams): Promise<ProcessIncomingResult> {
  console.log('PIM:start', { channel: params.channel, externalUserId: params.externalUserId, text: params.text })
  const resolvedUser = await resolveUser({ channel: params.channel, externalUserId: params.externalUserId, userName: params.userName })

  const incomingText = (params.text || '').trim()
  const intent = detectIntent(incomingText)
  console.log('PIM:intent', intent)

  // Topic digest schedule (#18): "send me my <topic> bucket every friday"
  {
    const dm = incomingText.match(/^\s*(?:send|message|give|dm|email)\s+me\s+(?:my\s+)?(.+?)\s+(?:bucket|digest|summary|notes)\s+(every\s+.+|daily|weekly)\s*$/i)
    if (dm) {
      const topic = dm[1].trim().toLowerCase()
      const rec = dm[2].trim()
      const parsed = parseReminderIntent(`remind me ${rec}`)
      const pattern = parsed ? (parsed as any).pattern : undefined
      let reply: string
      if (parsed && parsed.remindAtIso && pattern) {
        await createReminder(resolvedUser.telegramId, resolvedUser.telegramId, parsed.remindAtIso, `[topic_digest] ${topic}`, pattern)
        reply = `📂 Done — I'll send your *${topic}* digest ${rec}.`
      } else {
        reply = `Give me a schedule like "every Friday" or "every day". E.g. *send me my ${topic} bucket every friday*.`
      }
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  // ── Friend reminders (1C) — must run before self-reminder handling ──────────
  // (a) reply with a phone number after we asked "what's their number?"
  {
    const maybeNumber = normalizePhoneNumber(incomingText)
    if (maybeNumber && !detectFriendReminder(incomingText)) {
      const pending = await getPendingFriend(resolvedUser.telegramId)
      if (pending) {
        await saveConversation(resolvedUser.telegramId, 'user', incomingText)
        await saveFriendContact(resolvedUser.telegramId, pending.name, maybeNumber)
        const { whenHuman } = await createFriendReminder({ ownerTelegramId: resolvedUser.telegramId, senderName: resolvedUser.name, recipientWhatsapp: maybeNumber, rest: pending.rest })
        const reply = `Saved ${cap0(pending.name)}'s number. I'll remind ${cap0(pending.name)} ${whenHuman}.\n\n(If they've never messaged AskGogo, they may need to send it a "hi" first for delivery.)`
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        return { text: formatOutgoingText(params.channel, reply), resolvedUser }
      }
    }
  }
  // (b) "remind <name> to <task>" where <name> != me
  {
    const friend = detectFriendReminder(incomingText)
    if (friend) {
      await saveConversation(resolvedUser.telegramId, 'user', incomingText)
      const used = await countTodayFriendReminders(resolvedUser.telegramId)
      if (used >= FRIEND_DAILY_CAP) {
        const reply = `You've hit today's friend-reminder limit (${FRIEND_DAILY_CAP}/day).`
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        return { text: formatOutgoingText(params.channel, reply), resolvedUser }
      }
      const contact = await resolveFriendContact(resolvedUser.telegramId, friend.name)
      if (contact) {
        const { whenHuman } = await createFriendReminder({ ownerTelegramId: resolvedUser.telegramId, senderName: resolvedUser.name, recipientWhatsapp: contact, rest: friend.rest })
        const reply = `Done — I'll remind ${cap0(friend.name)} ${whenHuman}.`
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        return { text: formatOutgoingText(params.channel, reply), resolvedUser }
      }
      await saveConversation(resolvedUser.telegramId, 'user', pendingFriendMarker(friend.name, friend.rest))
      const reply = `What's ${cap0(friend.name)}'s WhatsApp number? Send it with country code (e.g. +91 98765 43210) and I'll set the reminder.`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  // Pending reminder context — runs FIRST before any other handler
  {
    const _hist = await getConversationHistory(resolvedUser.telegramId)
    const _lastBot = [..._hist].reverse().find((m: Message) => m.role === 'assistant')?.content || ''
    const _pm = _lastBot.match(/<!--PENDING:(.*?)-->/)
    if (_pm) {
      try {
        const _ctx = JSON.parse(_pm[1])
        const _raw = incomingText.trim().replace(/[.,]/g, '').trim()
        const _isTime = /^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(_raw)
        if (_isTime && _ctx.task) {
          const _t = /[aApP][mM]$/.test(_raw) ? _raw : _raw + ' AM'
          const _day = _ctx.day ? `on the ${_ctx.day}th of every month ` : ''
          const _full = `Remind me to ${_ctx.task} ${_day}at ${_t}`
          console.log('[pending] Completing:', _full)
          const _r = parseReminderIntent(_full)
          if (_r) {
            await createReminder(resolvedUser.telegramId, resolvedUser.telegramId, _r.remindAtIso, _r.message,
              _r.kind === 'recurring' ? _r.pattern : undefined,
              params.channel === 'whatsapp' ? resolvedUser.whatsappId : null)
            const _reply = buildReminderConfirmation(_r)
            await saveConversation(resolvedUser.telegramId, 'user', incomingText)
            await saveConversation(resolvedUser.telegramId, 'assistant', _reply)
            return { text: formatOutgoingText(params.channel, _reply), resolvedUser }
          }
        }
      } catch (_e) { console.log('[pending] failed:', _e) }
    }
  }

  if (isUsageCommand(incomingText)) {
    const reply = await getUsageStatusReply(resolvedUser.telegramId)
    await saveConversation(resolvedUser.telegramId, 'user', incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  if (isAmPmChoice(incomingText)) {
    const latestAmPm = await getLatestFollowupState(resolvedUser.telegramId, 'reminder_ampm')
    if (latestAmPm?.payload?.originalText && isFreshFollowupState(latestAmPm)) {
      const parsed = buildReminderFromAmPmChoice(latestAmPm.payload.originalText, incomingText)
      if (parsed) {
        await createReminder(
          resolvedUser.telegramId,
          resolvedUser.telegramId,
          parsed.remindAtIso,
          parsed.message,
          parsed.kind === 'recurring' ? parsed.pattern : undefined,
          params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
        )
        const reply = styleReplyByIntent('set_reminder', buildAmPmReminderSetReply(parsed))
        await saveConversation(resolvedUser.telegramId, 'user', incomingText)
        await saveConversation(resolvedUser.telegramId, 'assistant', reply)
        return { text: formatOutgoingText(params.channel, reply), resolvedUser }
      }
    }
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

      const reply = `Ã¢ÂÂ *Match reminder set*\n\n${latestSportsFollowup.payload.match_label}\n${lower.includes('2 hours before') ? '2 hours before the match' : '1 hour before the match'}`
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
    await saveFollowupState(resolvedUser.telegramId, 'reminder_ampm', {
      originalText: incomingText,
      channel: params.channel,
      created_at: new Date().toISOString(),
    })
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

  // ── Translation requests ────────────────────────────────────────────────────
  if (isTranslationRequest(incomingText)) {
    const targetLang = parseTargetLanguage(incomingText)
    const result = await translateText({ text: incomingText, targetLanguage: targetLang })
    const reply = buildTranslationReply(result)
    await saveConversation(resolvedUser.telegramId, 'user', incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  // ── Conditional follow-up reminders ("remind me if no reply in 3 days") ──────
  if (isFollowupReminderText(incomingText)) {
    const followup = parseFollowupReminder(incomingText)
    if (followup) {
      await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        followup.remindAtIso,
        followup.message,
        followup.pattern,
        params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
      )
      const reply = buildFollowupConfirmation(followup)
      await saveConversation(resolvedUser.telegramId, 'user', incomingText)
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
      eagerReminder.kind === 'recurring' ? eagerReminder.pattern : undefined,
      params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
    )
    const reply = styleReplyByIntent('set_reminder', buildReminderConfirmation(eagerReminder))
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  // Reminder intent detected but no specific time parsed - ask only for time
  if (!eagerReminder && intent.type === 'set_reminder') {
    const lower = incomingText.toLowerCase()
    const hasDate = /\b(\d{1,2})(st|nd|rd|th)\b|every month|monthly|every week|weekly|every day|daily/i.test(lower)
    const dayMatch = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/)
    const dayNum = dayMatch?.[1] || ''

    // Extract the task/label cleanly - remove trigger words and date/time fragments
    const cleanedInput = incomingText
      .replace(/(?:set |a )?remind(?:er)?(?:\s+me)?/gi, '')
      // Remove all recurrence patterns including day names
      .replace(/\b(every\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
      .replace(/\b(on the |every month|monthly|every week|weekly|every day|daily|\d{1,2}(?:st|nd|rd|th)(?: of every month)?|of every month|every)\b/gi, '')
      .replace(/\b(to|about|for|on|at|by)\b/gi, '')
      .replace(/\s+/g, ' ').trim()
    const about = cleanedInput.length > 2 ? cleanedInput : null

    // Store pending context in reply so next message can complete the reminder
    const pendingCtx = JSON.stringify({ task: about, day: dayNum, recurrence: hasDate ? 'monthly' : null })

    let reply: string
    if (hasDate && about && dayNum) {
      reply = `Got it \u2014 *${about}* on the ${dayNum}th of every month.\n\nWhat time should I remind you?\n_e.g. \"10 AM\" or \"9:30 AM\"_\n\n<!--PENDING:${pendingCtx}-->`
    } else if (hasDate && about) {
      reply = `Got it \u2014 *${about}*.\n\nWhat time should I remind you?\n_e.g. \"10 AM\" or \"6 PM\"_\n\n<!--PENDING:${pendingCtx}-->`
    } else if (about) {
      reply = `Got it \u2014 *${about}*.\n\nWhat time and when?\n_e.g. \"9 AM daily\", \"every Monday 10 AM\", \"in 2 hours\"_\n\n<!--PENDING:${pendingCtx}-->`
    } else {
      reply = `Sure! When should I remind you?\n\n\u2022 _\"Remind me at 7 AM tomorrow\"_\n\u2022 _\"15th of every month at 10 AM\"_\n\u2022 _\"Every Monday at 9 AM\"_`
    }
    const cleanReply = reply.replace(/\s*<!--PENDING:.*?-->/s, '').trim()
    await saveConversation(resolvedUser.telegramId, 'assistant', reply) // keep tag in DB for context
    return { text: formatOutgoingText(params.channel, cleanReply), resolvedUser }
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
    const reply = `Ã°ÂÂÂ *Connect Google Calendar*\n\nThis lets AskGogo include your schedule in Today briefing and help you plan reminders better.\n\n${url}\n\nAfter connecting, come back and type:\nToday`
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
      const reply = `Ã°ÂÂÂ¬ *Connect Gmail*\n\nTo show unread emails and draft replies, connect Gmail once.\n\n${connectUrl}\n\nAfter connecting, come back and type:\nshow my unread emails`
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
      const reply = `Ã°ÂÂÂ¬ *Gmail needs reconnecting*\n\nI couldnÃ¢ÂÂt fetch your emails right now.\n\nReconnect Gmail here:\n${connectUrl}\n\nThen type:\nshow my unread emails`
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
    const reply = `Ã°ÂÂÂ¬ *Connect Gmail*\n\nConnect once to unlock email summaries and reply drafts.\n\n${connectUrl}`
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

  // ── Media Memory (my instagram saves, my youtube notes, find reel about X) ──
  if (intent.type === 'media_memory' || isMediaMemoryCommand(incomingText)) {
    const mediaReply = await buildMediaMemoryReply(resolvedUser.telegramId, incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', mediaReply)
    return { text: formatOutgoingText(params.channel, mediaReply), resolvedUser }
  }

  // ── Instagram / LinkedIn preview card (WhatsApp link preview, numMedia=0) ──
  // Catches "Creator on Instagram: caption" forwarded cards that bypass the image branch
  const isIGPreview = detectInstagramPreviewCard(incomingText) || detectLinkedInPreviewCard(incomingText)
  if (isIGPreview) {
    const detectedUrl = detectReelUrl(incomingText) || undefined
    const platform = detectPlatformFromText(incomingText, detectedUrl)
    const { reply: mediaReply } = await saveMediaMemory({
      telegramId: resolvedUser.telegramId,
      platform,
      bodyText: incomingText,
      detectedUrl,
    })
    await saveConversation(resolvedUser.telegramId, 'user', `[${platform}] ${incomingText}`)
    await saveConversation(resolvedUser.telegramId, 'assistant', mediaReply)
    return { text: formatOutgoingText(params.channel, mediaReply), resolvedUser }
  }

  // ── YouTube / social URL sent as plain text ──────────────────
  const textReelUrl = detectReelUrl(incomingText)
  if (textReelUrl && /youtu\.?be|youtube\.com/i.test(textReelUrl)) {
    const platform = detectPlatformFromText(incomingText, textReelUrl)
    const { reply: mediaReply } = await saveMediaMemory({
      telegramId: resolvedUser.telegramId,
      platform,
      bodyText: incomingText,
      detectedUrl: textReelUrl,
    })
    await saveConversation(resolvedUser.telegramId, 'user', `[youtube] ${incomingText}`)
    await saveConversation(resolvedUser.telegramId, 'assistant', mediaReply)
    return { text: formatOutgoingText(params.channel, mediaReply), resolvedUser }
  }

  // ── Nutrition ──────────────────────────────────────────────
  if (intent.type === 'nutrition_log' || intent.type === 'nutrition_query') {
    const nutritionReply = await handleNutritionText({ telegramId: resolvedUser.telegramId, text: incomingText, whatsappId: resolvedUser.whatsappId })

    // Handle visual card signals
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
    if (nutritionReply.startsWith('__SEND_DAILY_CARD__')) {
      const tid = nutritionReply.replace('__SEND_DAILY_CARD__', '')
      const cardUrl = `${APP_URL}/api/nutrition/daily-card/${tid}`
      return { text: '📊 Your daily nutrition card 👆', mediaUrl: cardUrl, mediaType: 'image/png', resolvedUser }
    }
    if (nutritionReply.startsWith('__SEND_WEEKLY_CARD__')) {
      const tid = nutritionReply.replace('__SEND_WEEKLY_CARD__', '')
      const cardUrl = `${APP_URL}/api/nutrition/weekly-card/${tid}`
      return { text: '📊 Your weekly nutrition card 👆', mediaUrl: cardUrl, mediaType: 'image/png', resolvedUser }
    }

    await saveConversation(resolvedUser.telegramId, 'assistant', nutritionReply)
    return { text: formatOutgoingText(params.channel, nutritionReply), resolvedUser }
  }

  if (intent.type === 'web_search') {
    const searchContext = await searchWeb(incomingText)
    let reply = ''
    try { reply = await askClaudeWithContext(incomingText, searchContext, resolvedUser.name) } catch { reply = buildDirectWebAnswer(incomingText, searchContext) }
    if (!reply || /i apologize|unable to provide|don't have access|couldn't fetch|web search failed/i.test(reply)) reply = buildDirectWebAnswer(incomingText, searchContext)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  // Briefing content flags (#20): "briefing should include meetings and tasks"
  {
    const m = incomingText.match(/^\s*(?:set (?:my )?)?briefing (?:should )?(?:include|show|content(?:\s+to)?)\s+(.+)$/i)
    if (m) {
      const content = m[1].trim().toLowerCase()
      await supabaseAdmin.from('users').update({ briefing_content: content }).eq('telegram_id', resolvedUser.telegramId)
      const reply = `Got it \u2014 your daily briefing will now show: *${content}*. (Say "reset briefing" to show everything again.)`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
    if (/^\s*reset briefing\s*$/i.test(incomingText)) {
      await supabaseAdmin.from('users').update({ briefing_content: 'default' }).eq('telegram_id', resolvedUser.telegramId)
      const reply = 'Briefing reset \u2014 it will show everything again.'
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  // Weekly brief toggle + preview (1E)
  {
    const l = incomingText.trim().toLowerCase()
    if (/^(preview|show|test)\s+(my\s+)?weekly (brief|briefing)$/.test(l)) {
      const nowIso = new Date().toISOString()
      const weekIso = new Date(Date.now() + 7 * 864e5).toISOString()
      const { data: wkRows } = await supabaseAdmin
        .from('reminders')
        .select('message, remind_at')
        .eq('telegram_id', resolvedUser.telegramId)
        .eq('sent', false)
        .gte('remind_at', nowIso)
        .lte('remind_at', weekIso)
        .order('remind_at', { ascending: true })
        .limit(6)
      const rows = wkRows || []
      const fmt = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso))
      const reply = rows.length
        ? `🗓️ *Week ahead* (${rows.length} upcoming):\n${rows.map((r: any) => `• ${fmt(r.remind_at)} — ${r.message || 'Reminder'}`).join('\n')}`
        : '🗓️ *Week ahead*: nothing scheduled in the next 7 days.'
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
    if (/\b(enable|turn on|start|add)\b.*\bweekly (brief|briefing)/.test(l)) {
      await supabaseAdmin.from('users').update({ weekly_brief: true }).eq('telegram_id', resolvedUser.telegramId)
      const reply = '🗓️ Weekly brief is on — you\'ll get a week-ahead summary with your Sunday briefing.'
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
    if (/\b(disable|turn off|stop|remove)\b.*\bweekly (brief|briefing)/.test(l)) {
      await supabaseAdmin.from('users').update({ weekly_brief: false }).eq('telegram_id', resolvedUser.telegramId)
      const reply = 'Weekly brief turned off.'
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  // Preference rules (1D): standing instructions injected into Claude's prompt.
  if (intent.type === 'general_chat' || intent.type === 'save_memory') {
    const prefForget = detectPreferenceForget(incomingText)
    if (prefForget) {
      const n = await forgetPreference(resolvedUser.telegramId, prefForget)
      const reply = n ? `Removed ${n} preference${n > 1 ? 's' : ''}.` : `No matching preference found for "${prefForget}".`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
    if (isPreferenceList(incomingText)) {
      const rules = await listPreferences(resolvedUser.telegramId)
      const reply = rules.length
        ? `📌 *Your standing preferences*\n${rules.map((r, i) => `${i + 1}. ${r.rule_text}`).join('\n')}\n\nSay "forget rule about X" to remove one.`
        : `You haven't set any preferences yet. Try:\n• always keep my lists in capitals\n• from now on address me as boss`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
    const prefRule = detectPreferenceSave(incomingText)
    if (prefRule) {
      const res = await savePreference(resolvedUser.telegramId, prefRule)
      const reply = res.capped
        ? `You've hit the ${MAX_RULES}-preference limit. Remove one first ("forget rule about ...").`
        : `Got it — I'll always keep this in mind: "${prefRule}".`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  // Share a topic bucket (1.5): "share my <topic> bucket with <name>"
  {
    const share = detectShareIntent(incomingText)
    if (share) {
      let reply: string
      if (!(await hasTopic(resolvedUser.telegramId, share.topic))) {
        reply = `You don't have a "${share.topic}" bucket yet. Save to it first, e.g. remember for ${share.topic}: <something>.`
      } else {
        const { telegramId: rid, hasContact } = await resolveRecipientTelegramId(resolvedUser.telegramId, share.name)
        if (!hasContact) reply = `I don't have ${cap0(share.name)}'s number yet. Do a friend reminder once (remind ${share.name} to ...) so I save it, then share.`
        else if (!rid) reply = `${cap0(share.name)} isn't on AskGogo yet — ask them to message the bot first, then share.`
        else {
          await grantShare(resolvedUser.telegramId, rid, share.topic)
          reply = `Shared your *${share.topic}* bucket with ${cap0(share.name)}. They can now ask me about it.`
        }
      }
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  // Topic bucket save (1.5): "remember for <topic>: <fact>" / "save to <topic> bucket: <fact>"
  {
    const ts = parseTopicSave(incomingText)
    if (ts) {
      await saveMemory(resolvedUser.telegramId, ts.fact, ts.topic)
      const reply = `Got it \u2014 saved to your *${ts.topic}* bucket: "${ts.fact}".`
      await saveConversation(resolvedUser.telegramId, 'assistant', reply)
      return { text: formatOutgoingText(params.channel, reply), resolvedUser }
    }
  }

  // Deterministic memory save: "remember X" / "remember that X" always persists
  // (and, via awaited indexMemory inside saveMemory, always gets embedded for search).
  if (intent.type === 'save_memory') {
    const fact = incomingText
      .replace(/^\s*(?:please\s+)?remember(?:\s+that)?\s+/i, '')
      .replace(/^\s*save this memory[:\s]*/i, '')
      .trim() || incomingText.trim()
    await saveMemory(resolvedUser.telegramId, fact)
    const reply = `Got it \u2014 I'll remember that ${fact}.`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  const history = await getConversationHistory(resolvedUser.telegramId)
  const memories = await getMemories(resolvedUser.telegramId)
  const preferenceBlock = await getPreferenceBlock(resolvedUser.telegramId)
  const rawClaude = await askClaude(incomingText, history, memories, resolvedUser.name, preferenceBlock)
  const parsed = parseClaudeResponse(rawClaude)
  let finalReply = rawClaude

  if (parsed.type === 'memory') {
    await saveMemory(resolvedUser.telegramId, parsed.fact)
    finalReply = parsed.replyText || 'Got it Ã¢ÂÂ I will remember that.'
  }

  if (parsed.type === 'reminder') {
    await createReminder(resolvedUser.telegramId, resolvedUser.telegramId, parsed.remindAt, parsed.message, parsed.pattern, params.channel === 'whatsapp' ? resolvedUser.whatsappId : null)
    finalReply = parsed.replyText || `Done Ã¢ÂÂ I have set the reminder for ${parsed.message}.`
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

