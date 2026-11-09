import { supabaseAdmin } from '@/lib/supabase-admin'

// Numerical counters preserve existing callers, but are NOT delivery receipts.
// In particular, a lost HTTP acknowledgement is not a definite Expo rejection.
export type AgentPushEvidence = 'no_devices' | 'device_lookup_failed' | 'provider_accepted'
  | 'provider_rejected' | 'partial' | 'outcome_unknown'
export type AgentPushResult = { sent: number; failed: number; evidenceState: AgentPushEvidence }

export async function sendAgentPush(
  telegramId: string,
  input: { title: string; body: string; path?: string; data?: Record<string, unknown> },
): Promise<AgentPushResult> {
  let rows: Array<{ expo_push_token?: string | null }> = []
  try {
    const { data, error } = await supabaseAdmin.from('agent_devices')
      .select('id,expo_push_token').eq('telegram_id', String(telegramId))
      .eq('enabled', true).not('expo_push_token', 'is', null)
    if (error) {
      console.error('AGENT_PUSH_DEVICE_READ_FAILED:', error.message)
      return { sent: 0, failed: 0, evidenceState: 'device_lookup_failed' }
    }
    rows = data || []
  } catch (err: any) {
    console.error('AGENT_PUSH_DEVICE_READ_FAILED:', err?.message || err)
    return { sent: 0, failed: 0, evidenceState: 'device_lookup_failed' }
  }

  const tokens = rows.map(x => String(x.expo_push_token || '').trim()).filter(Boolean)
  if (!tokens.length) return { sent: 0, failed: 0, evidenceState: 'no_devices' }
  const messages = tokens.slice(0, 20).map(to => ({
    to,
    sound: 'default',
    title: String(input.title || 'Gogo update').slice(0, 120),
    body: String(input.body || '').slice(0, 500),
    data: { path: input.path || '/agent', ...(input.data || {}) },
    channelId: 'gogo-updates',
    priority: 'high',
  }))

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    })
    // A response without confirmed tickets cannot prove what Expo accepted.
    if (!response.ok) {
      console.error('AGENT_PUSH_SEND_FAILED:', response.status)
      return { sent: 0, failed: messages.length, evidenceState: 'outcome_unknown' }
    }

    let payload: any
    try {
      payload = await response.json()
    } catch (err: any) {
      console.error('AGENT_PUSH_ACK_UNREADABLE:', err?.message || err)
      return { sent: 0, failed: messages.length, evidenceState: 'outcome_unknown' }
    }
    if (!Array.isArray(payload?.data)) {
      console.error('AGENT_PUSH_ACK_MALFORMED')
      return { sent: 0, failed: messages.length, evidenceState: 'outcome_unknown' }
    }

    let sent = 0, failed = 0, unknown = 0
    for (let i = 0; i < messages.length; i++) {
      const ticket = payload.data[i]
      // Expo acknowledgement is ticket acceptance, NOT handset delivery.
      if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id.trim()) {
        sent++
      } else if (ticket?.status === 'error') {
        failed++
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          // A secondary cleanup failure must not erase provider ticket evidence.
          try {
            const { error } = await supabaseAdmin.from('agent_devices')
              .update({ enabled: false, updated_at: new Date().toISOString() })
              .eq('telegram_id', String(telegramId)).eq('expo_push_token', messages[i].to)
            if (error) console.error('AGENT_PUSH_TOKEN_DISABLE_FAILED:', error.message)
          } catch (err: any) {
            console.error('AGENT_PUSH_TOKEN_DISABLE_FAILED:', err?.message || err)
          }
        }
      } else {
        failed++
        unknown++
      }
    }
    const evidenceState: AgentPushEvidence = unknown > 0 ? 'outcome_unknown'
      : sent > 0 && failed > 0 ? 'partial'
      : sent > 0 ? 'provider_accepted' : 'provider_rejected'
    return { sent, failed, evidenceState }
  } catch (err: any) {
    // The request may have been accepted before the response was lost.
    // No retry is performed here or authorized by this outcome.
    console.error('AGENT_PUSH_SEND_FAILED:', err?.message || err)
    return { sent: 0, failed: messages.length, evidenceState: 'outcome_unknown' }
  }
}
