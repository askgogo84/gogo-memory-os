import { NextRequest, NextResponse } from 'next/server'
import { buildMeetingNotesReply } from '@/lib/bot/handlers/meeting-notes'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { resolveUser } from '@/lib/bot/resolve-user'

export const dynamic = 'force-dynamic'
export const maxDuration = 90 // Whisper takes ~10-20s for 2min audio. AssemblyAI removed (too slow for sync)

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

    const digits = phone.replace(/\D/g, '')
    const e164 = digits.startsWith('91') ? '+' + digits
      : digits.length === 10 ? '+91' + digits
      : '+' + digits

    const mins = Math.floor(duration / 60), secs = duration % 60
    const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
    const fileSizeMB = (audio.size / 1024 / 1024).toFixed(1)

    console.log(`[meeting-upload] phone=${e164} title=${title} duration=${durStr} size=${fileSizeMB}MB type=${audio.type}`)

    await sendWhatsAppMessage(e164,
      `🎙️ *Preparing meeting notes...*\n\n` +
      `*${title}*${attendees ? `\nAttendees: ${attendees}` : ''}\n` +
      `Duration: ${durStr} · Size: ${fileSizeMB}MB\n\n` +
      `Transcribing now… your minutes will arrive in ~60 seconds ⏳`
    )

    const arrayBuffer = await audio.arrayBuffer()
    console.log(`[meeting-upload] Buffer size: ${arrayBuffer.byteLength} bytes`)

    let transcript = ''
    try {
      transcript = await transcribeWithWhisper(arrayBuffer, audio.type || 'audio/webm', audio.name)
      console.log(`[meeting-upload] Transcript length: ${transcript.length} chars, preview: ${transcript.slice(0, 100)}`)
    } catch (transcribeErr: any) {
      console.error(`[meeting-upload] Whisper error:`, transcribeErr?.message)
      await sendWhatsAppMessage(e164,
        `⚠️ *Could not transcribe your recording*\n\n` +
        `Error: ${transcribeErr?.message?.slice(0, 100) || 'Unknown'}\n\n` +
        `Please send the audio file directly to this chat with caption *meeting notes*.`
      )
      return NextResponse.json({ ok: false, reason: 'transcription_error' })
    }

    if (!transcript || transcript.trim().length < 20) {
      console.log(`[meeting-upload] Transcript too short: "${transcript}"`)
      await sendWhatsAppMessage(e164,
        `⚠️ *Recording was too short or unclear*\n\n` +
        `The audio was only ${durStr} — try recording a longer meeting (at least 30 seconds).\n\n` +
        `Tips:\n• Speak clearly near the phone\n• Record in a quieter space`
      )
      return NextResponse.json({ ok: false, reason: 'transcription_too_short' })
    }

    const resolvedUser = await resolveUser({ channel: 'whatsapp', externalUserId: e164 })

    // Use Whisper only on upload path — AssemblyAI polling (up to 3min) exceeds Vercel timeout
    // Speaker diarization note: send audio as WhatsApp voice note for full diarization
    const { summaryReply, transcriptChunks } = await buildMeetingNotesReply({
      telegramId: resolvedUser.telegramId,
      transcript,
      caption: title + (attendees ? ` | Attendees: ${attendees}` : '')
    })

    // Send summary first, then full transcript
    await sendWhatsAppMessage(e164, summaryReply)
    for (const chunk of transcriptChunks) {
      await sendWhatsAppMessage(e164, chunk)
    }
    console.log(`[meeting-upload] Success! Notes + ${transcriptChunks.length} transcript chunk(s) sent to ${e164}`)

    return NextResponse.json({ ok: true })

  } catch (err: any) {
    console.error('[meeting-upload] Unexpected error:', err?.message, err?.stack?.slice(0, 300))
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function transcribeWithWhisper(arrayBuffer: ArrayBuffer, mimeType: string, originalName: string): Promise<string> {
  const OpenAI = (await import('openai')).default
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  // Browser records as audio/webm;codecs=opus
  // Whisper accepts: mp3, mp4, m4a, wav, ogg, webm — send as webm with correct name
  const uint8Array = new Uint8Array(arrayBuffer)

  // Force filename to meeting.webm so Whisper treats it correctly
  const file = new File([uint8Array], 'meeting.webm', { type: 'audio/webm' })

  console.log(`[meeting-upload] Calling Whisper: size=${uint8Array.length} mimeType=${mimeType}`)

  const response = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    // No language lock — let Whisper auto-detect (supports Hindi, Kannada etc)
    response_format: 'text',
    // No prompt — prompt text leaks into output when audio is unclear
  })

  const text = typeof response === 'string' ? response : (response as any).text || ''
  console.log(`[meeting-upload] Whisper result length: ${text.length}, preview: ${text.slice(0, 150)}`)
  return text
}
