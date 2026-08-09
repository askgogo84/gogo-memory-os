import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Twilio message status-callback receiver for reminder delivery-truth.
// This endpoint ONLY annotates reminders.delivery_status. It never writes
// sent, sent_at, or remind_at — a callback can never send, un-send, or drop a
// reminder. It is inert until the reminders send path attaches a statusCallback
// (gated by TWILIO_STATUS_CALLBACK_URL), so its mere existence is behaviourless.
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN || ''
  // Validate against the EXACT url we configured Twilio to call — the same value
  // used as the statusCallback on send — so there is no host/proto reconstruction
  // to get wrong behind Vercel's proxy.
  const callbackUrl = (process.env.TWILIO_STATUS_CALLBACK_URL || '').trim()
  const signature = req.headers.get('x-twilio-signature') || ''

  // Parse the form body once; needed both for signature validation and lookup.
  const params: Record<string, string> = {}
  try {
    const form = await req.formData()
    for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // Twilio signature validation. Missing/invalid signature → 403, write nothing.
  const valid =
    !!authToken &&
    !!signature &&
    !!callbackUrl &&
    twilio.validateRequest(authToken, signature, callbackUrl, params)
  if (!valid) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const messageSid = (params.MessageSid || params.SmsSid || '').trim()
  const messageStatus = (params.MessageStatus || params.SmsStatus || '').trim()
  if (!messageSid || !messageStatus) {
    return new NextResponse('', { status: 200 })
  }

  // Terminal delivery failures are the 63016-class silent drop made visible.
  if (messageStatus === 'undelivered' || messageStatus === 'failed') {
    console.error('REMINDER_DELIVERY_FAILURE:', {
      messageSid,
      messageStatus,
      errorCode: params.ErrorCode || '',
      to: params.To || '',
    })
  }

  try {
    // Map SID -> reminder row; record the status verbatim. Never touch sent/sent_at/remind_at.
    const { data, error } = await supabaseAdmin
      .from('reminders')
      .update({ delivery_status: messageStatus })
      .eq('twilio_sid', messageSid)
      .select('id')

    if (error) {
      console.error('TWILIO_STATUS_UPDATE_FAILED:', messageSid, error.message)
      return new NextResponse('', { status: 200 })
    }

    // No matching row is legitimate and must be silent: callbacks arrive for
    // non-reminder messages, and a queued/sent callback can beat markReminderSent
    // writing the SID (delivered/failed arrive later and will match).
    if (!data || !data.length) {
      return new NextResponse('', { status: 200 })
    }
  } catch (e: any) {
    console.error('TWILIO_STATUS_UPDATE_THREW:', messageSid, e?.message || e)
    return new NextResponse('', { status: 200 })
  }

  return new NextResponse('', { status: 200 })
}
