// Real voice-note replies and two-voice podcasts (Muse parity cases 12 and 13).
//
// 11 Oct live test: "reply as a voice note" got a text block titled "Voice Note Transcript" and no
// audio. Gogo now synthesises speech with OpenAI text-to-speech, stores the MP3 in the private
// user-documents bucket, and sends WhatsApp a short-lived signed link to it.
import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'

const BUCKET = 'user-documents'
const MAX_SPEECH_CHARS = 3500

/** The person asked for the answer as audio ("reply as a voice note", "send it as audio"). */
export function wantsVoiceReply(text: string): boolean {
  const t = String(text || '')
  return /\b(?:reply|respond|answer|tell\s+me|send(?:\s+(?:it|me|this))?|explain|read\s+it)\b[^.?!]{0,40}\b(?:as|in|with|via|through)\s+(?:an?\s+)?(?:voice\s*-?\s*note|voice\s+message|audio(?:\s+note|\s+message)?)\b/i.test(t)
    || /\bvoice\s*-?\s*note\s+(?:reply|answer)\b/i.test(t)
}

/** A request to generate a podcast episode ("make a 5-minute two-voice podcast debating X"). */
export function podcastRequest(text: string): { topic: string; minutes: number } | null {
  const t = String(text || '').trim()
  if (!/\b(?:make|create|generate|record|produce)\b[^.?!]{0,40}\bpodcast\b/i.test(t)) return null
  const topic = t.match(/\b(?:debating|about|on|discussing|covering)\s+(.+?)[.!?]*$/i)?.[1]?.trim() || ''
  if (topic.length < 3) return null
  const minutes = Math.min(5, Math.max(1, Number(t.match(/\b(\d{1,2})\s*-?\s*min(?:ute)?s?\b/i)?.[1] || 3)))
  return { topic: topic.slice(0, 200), minutes }
}

/** Text as it should be spoken: no links, markdown, bullets or emoji clutter. */
export function speechText(text: string): string {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`#>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_SPEECH_CHARS)
}

async function speak(openai: OpenAI, input: string, voice: string): Promise<Buffer> {
  const models = [process.env.GOGO_TTS_MODEL || 'gpt-4o-mini-tts', 'tts-1']
  let lastError: unknown
  for (const model of models) {
    try {
      const res = await openai.audio.speech.create({ model, voice: voice as any, input, response_format: 'mp3' } as any)
      return Buffer.from(await res.arrayBuffer())
    } catch (error) { lastError = error }
  }
  throw lastError instanceof Error ? lastError : new Error('tts_failed')
}

async function storeAudio(telegramId: number | string, audio: Buffer): Promise<string> {
  const path = `${telegramId}/voice-replies/${randomUUID()}.mp3`
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, audio, { contentType: 'audio/mpeg', upsert: false })
  if (error) throw new Error(`voice_upload_failed:${error.message}`)
  const { data, error: signError } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600)
  if (signError || !data?.signedUrl) throw new Error(`voice_sign_failed:${signError?.message || 'unknown'}`)
  return data.signedUrl
}

/** Synthesise a voice note of `text`; returns a signed MP3 link, or null if it could not be made. */
export async function createVoiceNote(telegramId: number | string, text: string): Promise<string | null> {
  const input = speechText(text)
  if (!input || !process.env.OPENAI_API_KEY) return null
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const audio = await speak(openai, input, 'alloy')
    return await storeAudio(telegramId, audio)
  } catch (error: any) {
    console.error('VOICE_NOTE_FAILED:', String(error?.message || error).slice(0, 160))
    return null
  }
}

type PodcastLine = { speaker: 'A' | 'B'; text: string }

/** Parse the script the model returns; keeps only well-formed alternating lines. */
export function parsePodcastScript(raw: string): PodcastLine[] {
  const json = String(raw || '').match(/\[[\s\S]*\]/)?.[0]
  if (!json) return []
  try {
    const lines = JSON.parse(json)
    return (Array.isArray(lines) ? lines : [])
      .map((l: any) => ({ speaker: l?.speaker === 'B' ? 'B' : 'A', text: speechText(String(l?.text || '')).slice(0, 900) } as PodcastLine))
      .filter((l) => l.text.length > 0)
      .slice(0, 24)
  } catch { return [] }
}

/** Write a balanced two-host debate, voice each line, and return the script and a signed MP3 link. */
export async function createPodcast(telegramId: number | string, topic: string, minutes: number): Promise<{ script: PodcastLine[]; url: string | null }> {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.OPENAI_API_KEY) return { script: [], url: null }
  const words = minutes * 150
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-5', max_tokens: 3000,
    messages: [{ role: 'user', content: `Write a balanced, factual two-host podcast debate for listeners in India on: ${JSON.stringify(topic)}. About ${words} words in total, 10 to 18 turns. Host A argues for, host B argues against; both stay civil, concrete and accurate, and say "we don't know" rather than inventing numbers. No sound effects or stage directions. Return ONLY a JSON array like [{"speaker":"A","text":"..."},{"speaker":"B","text":"..."}].` }],
  })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
  const script = parsePodcastScript(raw)
  if (!script.length) return { script, url: null }
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const parts = await Promise.all(script.map((l) => speak(openai, l.text, l.speaker === 'A' ? 'alloy' : 'onyx')))
    // MP3 frames are self-contained, so joining whole files plays back as one episode.
    return { script, url: await storeAudio(telegramId, Buffer.concat(parts)) }
  } catch (error: any) {
    console.error('PODCAST_AUDIO_FAILED:', String(error?.message || error).slice(0, 160))
    return { script, url: null }
  }
}
