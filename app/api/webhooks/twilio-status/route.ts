import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { deliveryRpc } from '@/lib/services/reminder-delivery'
import { deliveryCallbackUrl } from '@/lib/services/delivery-callback'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN || ''
  const base = (process.env.TWILIO_STATUS_CALLBACK_URL || '').trim()
  const signature = req.headers.get('x-twilio-signature') || ''
  const params: Record<string, string> = {}
  try {
    for (const [k, v] of (await req.formData()).entries()) params[k] = typeof v === 'string' ? v : ''
  } catch { return new NextResponse('Bad Request', { status: 400 }) }
  const url = new URL(req.url)
  const token = url.searchParams.get('delivery_token') || undefined
  const chunk = Number(url.searchParams.get('chunk') || 1)
  const chunks = Number(url.searchParams.get('chunks') || 1)
  if (token && (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(token) ||
    !Number.isInteger(chunk) || !Number.isInteger(chunks) || chunk < 1 || chunks < chunk || chunks > 1000)) {
    return new NextResponse('Bad Request', { status: 400 })
  }
  // Only configured public URL plus validated correlation fields. SDK validation
  // includes every form parameter; no proxy-host reconstruction is trusted.
  const callbackUrl = base ? deliveryCallbackUrl(base, token, chunk, chunks) : ''
  if (!authToken || !signature || !callbackUrl || !twilio.validateRequest(authToken, signature, callbackUrl, params)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  const sid = (params.MessageSid || params.SmsSid || '').trim()
  const status = (params.MessageStatus || params.SmsStatus || '').trim()
  if (!sid || !status) return new NextResponse('Bad Request', { status: 400 })
  const key = createHash('sha256').update(JSON.stringify([sid, status, params.ErrorCode || '', token || '', chunk, chunks])).digest('hex')
  try {
    await deliveryRpc('ingest_delivery_callback', { p_key: key, p_sid: sid, p_status: status, p_error: params.ErrorCode || null,
      p_token: token || null, p_chunk: token ? chunk : null, p_chunks: token ? chunks : null })
  } catch { return new NextResponse('Persistence unavailable', { status: 503 }) }
  try { await deliveryRpc('reconcile_reminder_receipt', { p_sid: sid }) }
  catch { /* Durable event remains for the existing minute worker to reconcile. */ }
  return new NextResponse('', { status: 200 })
}
