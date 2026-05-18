/**
 * Meeting Transcription Service
 * - Speaker diarization (who said what)
 * - 100+ languages auto-detected
 * - Translates to English for storage/search
 * - Falls back to Whisper if AssemblyAI key not set
 */

import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export interface SpeakerSegment {
  speaker: string   // "Speaker A", "Speaker B" etc
  text: string
  start: number     // ms
  end: number       // ms
}

export interface TranscriptionResult {
  rawTranscript: string           // Original language, plain text
  englishTranscript: string       // Translated to English (same as raw if already English)
  detectedLanguage: string        // e.g. "hi" (Hindi), "kn" (Kannada), "en" (English)
  speakerSegments: SpeakerSegment[]
  speakerCount: number
  formattedWithSpeakers: string   // "Speaker A: ...\nSpeaker B: ..."
  durationSeconds: number
  usedDiarization: boolean
}

// ── AssemblyAI transcription with speaker diarization ────────────────────────

async function transcribeWithAssemblyAI(audioBuffer: ArrayBuffer, contentType: string): Promise<TranscriptionResult | null> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY
  if (!apiKey) {
    console.log('[meeting-transcription] No ASSEMBLYAI_API_KEY, falling back to Whisper')
    return null
  }

  try {
    // Step 1: Upload audio to AssemblyAI
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': contentType || 'audio/ogg',
      },
      body: audioBuffer,
    })

    if (!uploadRes.ok) throw new Error(`AssemblyAI upload failed: ${uploadRes.status}`)
    const { upload_url } = await uploadRes.json()

    // Step 2: Request transcription with speaker diarization
    const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true,          // who said what
        language_detection: true,      // auto-detect language
        // NOT setting language_code = auto-detect 100+ languages
      }),
    })

    if (!transcriptRes.ok) throw new Error(`AssemblyAI transcript request failed: ${transcriptRes.status}`)
    const { id } = await transcriptRes.json()

    // Step 3: Poll for completion (max 3 minutes)
    let attempts = 0
    while (attempts < 36) {
      await new Promise(r => setTimeout(r, 5000)) // poll every 5s
      attempts++

      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { authorization: apiKey },
      })
      const data = await pollRes.json()

      if (data.status === 'completed') {
        return processAssemblyAIResult(data)
      }

      if (data.status === 'error') {
        console.error('[meeting-transcription] AssemblyAI error:', data.error)
        return null
      }

      console.log(`[meeting-transcription] AssemblyAI status: ${data.status} (attempt ${attempts})`)
    }

    console.error('[meeting-transcription] AssemblyAI timed out after 3 minutes')
    return null

  } catch (err) {
    console.error('[meeting-transcription] AssemblyAI failed:', err)
    return null
  }
}

function processAssemblyAIResult(data: any): TranscriptionResult {
  const rawTranscript = data.text || ''
  const detectedLanguage = data.language_code || 'en'

  // Build speaker segments
  const speakerSegments: SpeakerSegment[] = []
  const utterances = data.utterances || []

  for (const u of utterances) {
    speakerSegments.push({
      speaker: `Speaker ${u.speaker}`,
      text: u.text,
      start: u.start,
      end: u.end,
    })
  }

  const speakerCount = new Set(speakerSegments.map(s => s.speaker)).size

  // Format with speakers
  const formattedWithSpeakers = speakerSegments.length > 0
    ? speakerSegments.map(s => `*${s.speaker}:* ${s.text}`).join('\n')
    : rawTranscript

  const durationSeconds = data.audio_duration || 0

  return {
    rawTranscript,
    englishTranscript: rawTranscript, // will translate below if needed
    detectedLanguage,
    speakerSegments,
    speakerCount,
    formattedWithSpeakers,
    durationSeconds,
    usedDiarization: speakerSegments.length > 0,
  }
}

// ── Translate to English if needed ───────────────────────────────────────────

async function translateToEnglish(text: string, fromLanguage: string): Promise<string> {
  if (!text || fromLanguage === 'en') return text

  try {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 4000,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator. Translate the following meeting transcript to English. Preserve speaker labels (Speaker A:, Speaker B:) exactly. Preserve names, company names, product names, and technical terms. Return only the translated text, nothing else.',
        },
        {
          role: 'user',
          content: text.slice(0, 8000),
        },
      ],
    })
    return res.choices[0]?.message?.content?.trim() || text
  } catch {
    return text // fallback to original
  }
}

// ── Whisper fallback (no speaker diarization) ─────────────────────────────────

async function transcribeWithWhisper(audioBuffer: ArrayBuffer, contentType: string): Promise<TranscriptionResult> {
  const { toFile } = await import('openai')
  const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('mp3') ? 'mp3' : contentType.includes('wav') ? 'wav' : 'ogg'
  const file = await toFile(Buffer.from(audioBuffer), `audio.${ext}`, { type: contentType || 'audio/ogg' })

  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    // no language = auto-detect
  })

  const rawTranscript = result.text || ''

  return {
    rawTranscript,
    englishTranscript: rawTranscript,
    detectedLanguage: 'auto',
    speakerSegments: [],
    speakerCount: 1,
    formattedWithSpeakers: rawTranscript,
    durationSeconds: 0,
    usedDiarization: false,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function transcribeMeeting(params: {
  audioBuffer: ArrayBuffer
  contentType: string
  isMeeting: boolean  // true = use diarization, false = skip for speed
}): Promise<TranscriptionResult> {
  let result: TranscriptionResult | null = null

  // Try AssemblyAI for meetings (has speaker diarization)
  if (params.isMeeting) {
    result = await transcribeWithAssemblyAI(params.audioBuffer, params.contentType)
  }

  // Fall back to Whisper
  if (!result) {
    result = await transcribeWithWhisper(params.audioBuffer, params.contentType)
  }

  // Translate to English if not already English
  const nonEnglish = result.detectedLanguage && result.detectedLanguage !== 'en' && result.detectedLanguage !== 'auto'
  if (nonEnglish) {
    console.log(`[meeting-transcription] Detected ${result.detectedLanguage}, translating to English...`)
    const toTranslate = result.formattedWithSpeakers || result.rawTranscript
    result.englishTranscript = await translateToEnglish(toTranslate, result.detectedLanguage)
  } else {
    result.englishTranscript = result.formattedWithSpeakers || result.rawTranscript
  }

  return result
}

// ── Language display names ────────────────────────────────────────────────────

export function getLanguageLabel(code: string): string {
  const labels: Record<string, string> = {
    hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu',
    ml: 'Malayalam', mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi',
    bn: 'Bengali', ur: 'Urdu', en: 'English', ar: 'Arabic',
    zh: 'Chinese', fr: 'French', de: 'German', es: 'Spanish',
    ja: 'Japanese', ko: 'Korean', pt: 'Portuguese', ru: 'Russian',
    auto: 'Auto-detected',
  }
  return labels[code] || code.toUpperCase()
}
// deploy trigger Mon May 18 05:36:44 UTC 2026
// reconnect trigger Mon May 18 07:12:18 UTC 2026
// deploy 1779088577
