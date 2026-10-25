import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Channel } from '../resolve-user'

// AskGogo side of CreditIQ account linking. A user redeems a 6-digit code
// generated in the CreditIQ app: "link creditiq 123456". We verify the code
// against the CreditIQ consumer, and on success persist the WhatsApp↔consumer
// link so future CreditIQ alerts can reach this number.
//
// Security posture:
// - WhatsApp-only (the sender key IS the WhatsApp number).
// - Server-side throttle: lockout is checked BEFORE any redeem call, and every
//   failed redeem is registered via the wa_link_register_fail RPC (which owns
//   the attempt-count → locked_until logic in Postgres).
// - Failures are ALWAYS generic — we never reveal whether a code was wrong,
//   already used, or expired (avoids oracle for brute-forcing).

const CREDITIQ_REDEEM_URL = 'https://www.creditiq.app/api/wa/redeem'

const GENERIC_FAILURE =
  `❌ That code didn't work — it may be wrong, already used, or expired.\n\n` +
  `Generate a fresh code in the CreditIQ app and try again.`

const LOCKOUT_NOTE = `\n\nFor security, further attempts are paused for ~15 minutes.`

type HandleCreditIqLinkParams = {
  channel: Channel
  senderKey: string | null
  code: string
}

// True when the sender currently has a live lockout window.
async function isLockedNow(senderKey: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('wa_link_throttle')
    .select('locked_until')
    .eq('sender', senderKey)
    .maybeSingle()
  if (!data?.locked_until) return false
  return new Date(data.locked_until).getTime() > Date.now()
}

// Register a failed attempt, then re-read the throttle row to decide (independent
// of the RPC's return shape) whether the sender is now locked out.
async function registerFailAndReply(senderKey: string): Promise<string> {
  const { error } = await supabaseAdmin.rpc('wa_link_register_fail', { p_sender: senderKey })
  if (error) console.error('CREDITIQ_LINK_REGISTER_FAIL_RPC_FAILED:', error)
  const locked = await isLockedNow(senderKey)
  return locked ? GENERIC_FAILURE + LOCKOUT_NOTE : GENERIC_FAILURE
}

export async function handleCreditIqLink({ channel, senderKey, code }: HandleCreditIqLinkParams): Promise<string> {
  // WhatsApp-only — the sender key is the WhatsApp number.
  if (channel !== 'whatsapp') {
    return 'Please link your CreditIQ account from WhatsApp.'
  }
  // No resolvable WhatsApp number → never redeem; fail generically.
  if (!senderKey) {
    return GENERIC_FAILURE
  }

  // Lockout check FIRST — before any redeem attempt.
  const { data: throttle } = await supabaseAdmin
    .from('wa_link_throttle')
    .select('locked_until')
    .eq('sender', senderKey)
    .maybeSingle()

  if (throttle?.locked_until) {
    const lockedUntilMs = new Date(throttle.locked_until).getTime()
    if (lockedUntilMs > Date.now()) {
      const mins = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 60000))
      return `🔒 Too many attempts. Please try again in about ${mins} min.`
    }
  }

  // Verify the code against the CreditIQ consumer.
  let res: Response
  try {
    res = await fetch(CREDITIQ_REDEEM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wa-secret': process.env.WA_LINK_SECRET || '',
      },
      body: JSON.stringify({ code }),
    })
  } catch (err) {
    // Network/redeem error is a failed attempt (counts toward throttle).
    console.error('CREDITIQ_LINK_FETCH_FAILED:', err)
    return registerFailAndReply(senderKey)
  }

  if (res.status === 200) {
    let payload: any = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    if (payload?.ok && payload?.consumer_user_id) {
      // Success: persist the link and clear the throttle for this sender.
      const { error: upsertError } = await supabaseAdmin
        .from('wa_creditiq_links')
        .upsert({ sender: senderKey, consumer_user_id: payload.consumer_user_id }, { onConflict: 'sender' })
      if (upsertError) console.error('CREDITIQ_LINK_UPSERT_FAILED:', upsertError)

      const { error: throttleDeleteError } = await supabaseAdmin
        .from('wa_link_throttle')
        .delete()
        .eq('sender', senderKey)
      if (throttleDeleteError) console.error('CREDITIQ_LINK_THROTTLE_CLEAR_FAILED:', throttleDeleteError)

      console.log('CREDITIQ_LINK_SUCCESS:', { sender: senderKey })
      return `✅ Your CreditIQ account is now linked. You'll get your CreditIQ alerts and updates right here on WhatsApp.`
    }
  }

  // Any non-success (non-200, or 200 without ok/consumer_user_id) → register a
  // failed attempt and return the generic message. Never reveal which case.
  return registerFailAndReply(senderKey)
}
