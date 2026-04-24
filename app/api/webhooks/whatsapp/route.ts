import { NextRequest, NextResponse } from 'next/server'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { resolveUser } from '@/lib/bot/resolve-user'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDirectWhatsappPremiumReply } from '@/lib/bot/handlers/whatsapp-direct-premium'

export const dynamic = 'force-dynamic'

function normalizeWhatsAppNumber(value: string | null | undefined): string {
  return (value || '').replace(/^whatsapp:/, '').trim()
}

function emptyTwiml() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`
}

async function saveConversation(telegramId: number, role: 'user' | 'assistant', content: string) {
  await supabaseAdmin.from('conversations').insert({
    telegram_id: telegramId,
    role,
    content,
  })
}

async function saveMemory(telegramId: number, content: string) {
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content,
  })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  console.log('WhatsApp GET verify:', { mode, tokenPresent: !!token })

  if (
    mode === 'subscribe' &&
    token &&
    token === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new NextResponse(challenge || 'OK', { status: 200 })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    const fromRaw = String(formData.get('From') || '')
    const bodyRaw = String(formData.get('Body') || '')
    const profileName = String(formData.get('ProfileName') || 'Friend')
    const numMedia = Number(formData.get('NumMedia') || '0')

    const from = normalizeWhatsAppNumber(fromRaw)
    const text = bodyRaw.trim()

    console.log('WhatsApp inbound raw:', {
      fromRaw,
      from,
      bodyRaw,
      profileName,
      numMedia,
    })

    if (!from) {
      console.log('WhatsApp skipped: missing from')
      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    if (!text) {
      console.log('WhatsApp skipped: empty or media-only message')
      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    // Direct premium text override for WhatsApp-native UX.
    // This handles only exact menu/pricing/referral commands.
    // All real assistant tasks still go through processIncomingMessage below.
    const resolvedUser = await resolveUser({
      channel: 'whatsapp',
      externalUserId: from,
      userName: profileName,
    })

    const directReply = getDirectWhatsappPremiumReply(text, resolvedUser.name)

    if (directReply) {
      console.log('WhatsApp direct premium reply triggered:', text)

      await saveConversation(resolvedUser.telegramId, 'user', text)

      if (directReply.saveMemory) {
        await saveMemory(resolvedUser.telegramId, directReply.saveMemory)
      }

      await saveConversation(resolvedUser.telegramId, 'assistant', directReply.text)
      await sendWhatsAppMessage(from, directReply.text)

      return new NextResponse(emptyTwiml(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    console.log('WhatsApp before processIncomingMessage')

    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: from,
      text,
      userName: profileName,
      messageType: 'text',
    })

    console.log('WhatsApp processed reply:', result.text)

    await sendWhatsAppMessage(from, result.text)

    console.log('WhatsApp send complete')

    return new NextResponse(emptyTwiml(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  } catch (error: any) {
    console.error('WhatsApp webhook error:', error)

    return new NextResponse(emptyTwiml(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    })
  }
}
