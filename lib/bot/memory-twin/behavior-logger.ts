import { supabaseAdmin } from '@/lib/supabase-admin'

export type MemoryTwinEventType =
  | 'message_received'
  | 'reminder_created'
  | 'note_saved'
  | 'task_created'
  | 'expense_logged'
  | 'contact_saved'
  | 'briefing_requested'
  | 'meeting_notes_created'
  | 'payment_intent'
  | 'referral_joined'
  | 'custom'

export type LogBehaviorEventParams = {
  telegramId: number
  eventType: MemoryTwinEventType
  payload?: Record<string, any>
  source?: 'whatsapp' | 'telegram' | 'web' | 'system'
}

export async function ensureMemoryConsent(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('user_consent_settings')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (data) return data

  const { data: inserted, error } = await supabaseAdmin
    .from('user_consent_settings')
    .insert({
      telegram_id: telegramId,
      memory_enabled: true,
      proactive_suggestions_enabled: true,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[memory-twin] consent insert failed:', error.message)
    return null
  }

  return inserted
}

export async function isMemoryEnabled(telegramId: number) {
  const consent = await ensureMemoryConsent(telegramId)
  return consent?.memory_enabled !== false
}

export async function logBehaviorEvent(params: LogBehaviorEventParams) {
  const enabled = await isMemoryEnabled(params.telegramId)
  if (!enabled) return null

  const { data, error } = await supabaseAdmin
    .from('user_behavior_events')
    .insert({
      telegram_id: params.telegramId,
      event_type: params.eventType,
      event_payload: params.payload || {},
      source: params.source || 'whatsapp',
    })
    .select('*')
    .single()

  if (error) {
    console.error('[memory-twin] event log failed:', error.message)
    return null
  }

  return data
}

export async function logReminderCreated(params: {
  telegramId: number
  message: string
  remindAtIso: string
  source?: 'whatsapp' | 'telegram' | 'web' | 'system'
}) {
  return logBehaviorEvent({
    telegramId: params.telegramId,
    eventType: 'reminder_created',
    source: params.source || 'whatsapp',
    payload: {
      message: params.message,
      remindAtIso: params.remindAtIso,
      hour: new Date(params.remindAtIso).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }),
    },
  })
}

export async function logMessageReceived(params: {
  telegramId: number
  text: string
  source?: 'whatsapp' | 'telegram' | 'web' | 'system'
}) {
  return logBehaviorEvent({
    telegramId: params.telegramId,
    eventType: 'message_received',
    source: params.source || 'whatsapp',
    payload: {
      text: params.text,
      length: params.text.length,
    },
  })
}
