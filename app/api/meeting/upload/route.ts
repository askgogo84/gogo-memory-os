import { NextRequest, NextResponse } from 'next/server'
import { buildMeetingNotesReply } from '@/lib/bot/handlers/meeting-notes'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { resolveUser } from '@/lib/bot/resolve-user'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const audio     = form.get('audio') as File | null
    const phone     = (form.get('phone') as string || '').trim()
    const title     = (form.get('title') as string || 'Meeting').trim()
    const attendees = (form.get('attendees') as string || '').trim()
    const duration  = parseInt(form.get('duration') as string || '0', 10)

    if (!audio || !phone) {
      return NextResponse.json({ error: 'audio and phone required' }, { status: 400 })
    }

    // Normalize to E.164
    const digits = phone.replace(/\D/g, '')
    const e164 = digits.startsWith('91') ? '+' + digits
      : digits.length === 10 ? '+91' + digits
      : '+' + digits

    const mins = Math.floor(duration / 60), secs = duration % 60
    const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

    const fileSizeMB = (audio.size / 1024 / 1024).toFixed(1)
    console.log(`[meeting-upload] phone=${e164} title=${title} duration=${durStr} size=${fileSizeMB}MB type=${audio.type}`)

    // Immediate acknowledgment
    await sendWhatsAppMessage(e164,
      `🎙️ *Preparing meeting notes...*\n\n` +
      `*${title}*${attendees ? `\nAttendees: ${attendees}` : ''}\n` +
      `Duration: ${durStr} · Size: ${fileSizeMB}MB\n\n` +
      `Transcribing now… your minutes will arrive in ~60 seconds ⏳`
    )

    // Transcribe with Whisper
    const buffer = Buffer.from(await audio.arrayBuffer())
    console.log(`[meeting-upload] Buffer size: ${buffer.length} bytes`)

    let transcript = ''
    try {
      transcript = await transcribeWithWhisper(buffer, audio.type || 'audio/webm', audio.name)
      console.log(`[meeting-upload] Transcript length: ${transcript.length} chars, preview: ${transcript.slice(0, 100)}`)
    } catch (transcribeErr: any) {
      console.error(`[meeting-upload] Whisper error:`, transcribeErr?.message)
      await sendWhatsAppMessage(e164,
        `⚘️ *Could not transcribe your recording*\n\n` +
        `Error: ${transcribeErr?.message?.slice(0, 100) || 'Unknown'}\n\n` +
        `Please try recording again or send the audio file directly to this chat with caption *meeting notes*.`
      )
      return NextResponse.json({ ok: false, reason: 'transcription_error' })
    }

    if (!transcript || transcript.trim().length < 20) {
      console.log(`[meeting-upload] Transcript too short: "${transcript}"`)
      await sendWhatsAppMessage(e164,
        `⚘️ *Recording was too short or unclear*\n\n` +
        `The audio was only ${durStr} — try recording a longer meeting (at least 30 seconds).\n\n` +
        `Tips for better results:\n` +
        `• Speak clearly near the phone\n` +
        `• Record in a quieter space\n` +
        `• Minimum 30 seconds of speech`
      )
      return NextResponse.json({ ok: false, reason: 'transcription_too_short' })
    }

    // Build meeting notes via existing handler
    const resolvedUser = await resolveUser({ channel: 'whatsapp', externalUserId: e164 })
    const notes = await buildMeetingNotesReply({
      telegramId: resolvedUser.telegramId,
      transcript,
      caption: title + (attendees ? ` | Attendees: ${attendees}` : '')
    })

    await sendWhatsAppMessage(e164, notes)
    console.log(`[meeting-upload] Success! Notes sent to ${e164}`)

    return NextResponse.json({ ok: true })

  } catch (err: any) {
    console.error('[meeting-upload] Unexpected error:', err?.message, err?.stack?.slice(0, 300))
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function transcribeWithWhisper(buffer: Buffer, mimeType: string, originalName: string): Promise<string> {
  const OpenAI = (await import('openai')).default
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
    : mimeType.includes('ogg') ? 'ogg'
    : mimeType.includes('wav') ? 'wav'
    : 'webm'

  const filename = originalName || `meeting.${ext}`
  const file = new File([buffer], filename, { type: mimeType })

  console.log(`[meeting-upload] Calling Whisper: filename=${filename} size=${buffer.length}`)

  const response = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'en',
    response_format: 'text',
    prompt: 'This is a meeting recording. Transcribe all speech accurately.'
  })

  return typeof response === 'string' ? response : (response as any).text || ''
}
