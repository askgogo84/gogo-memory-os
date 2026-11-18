/** Sarvam speech adapters. These are invoked only by explicit per-surface feature flags. */
import { SarvamProviderError } from './sarvam'

type SpeechDeps = { apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number }
const HOST = 'https://api.sarvam.ai'
const MAX_STT_BYTES = 8 * 1024 * 1024
const LANGS = new Set(['en-IN','hi-IN','bn-IN','gu-IN','kn-IN','ml-IN','mr-IN','od-IN','pa-IN','ta-IN','te-IN'])
export function sarvamSpeechLanguage(input: string): string {
  if (/[\u0C80-\u0CFF]/u.test(input)) return 'kn-IN'
  if (/[\u0B80-\u0BFF]/u.test(input)) return 'ta-IN'
  if (/[\u0C00-\u0C7F]/u.test(input)) return 'te-IN'
  if (/[\u0D00-\u0D7F]/u.test(input)) return 'ml-IN'
  if (/[\u0900-\u097F]/u.test(input)) return 'hi-IN'
  if (/[\u0980-\u09FF]/u.test(input)) return 'bn-IN'
  if (/[\u0A80-\u0AFF]/u.test(input)) return 'gu-IN'
  if (/[\u0A00-\u0A7F]/u.test(input)) return 'pa-IN'
  return 'en-IN'
}
async function send(url: string, body: BodyInit, contentType: string | null, opts: SpeechDeps) {
  const key = opts.apiKey || process.env.SARVAM_API_KEY
  if (!key) throw new SarvamProviderError('key_missing')
  try {
    const headers: Record<string,string> = { 'api-subscription-key': key }
    if (contentType) headers['Content-Type'] = contentType
    const res = await (opts.fetcher || fetch)(HOST + url, {
      method:'POST', headers, body, cache:'no-store', redirect:'error',
      signal: AbortSignal.timeout(Math.max(500, Math.min(opts.timeoutMs || 20_000, 60_000))),
    })
    if (!res.ok) throw new SarvamProviderError('http_' + res.status)
    return await res.json() as any
  } catch (err) {
    if (err instanceof SarvamProviderError) throw err
    throw new SarvamProviderError('network_or_json')
  }
}
export async function sarvamTextToSpeech(text: string, options: SpeechDeps & {
  languageCode?: string; speaker?: string; model?: 'bulbul:v3' | 'bulbul:v4-flash'
} = {}): Promise<Buffer> {
  const input = text.trim()
  if (!input || input.length > 2500) throw new SarvamProviderError('tts_text_invalid')
  const model = options.model || 'bulbul:v3'
  const language_code = options.languageCode || sarvamSpeechLanguage(input)
  if (!LANGS.has(language_code)) throw new SarvamProviderError('tts_language_invalid')
  // v4 Flash uses its own persona ID format, whereas v3 accepts short speaker names.
  const speaker = options.speaker || (model === 'bulbul:v3' ? 'shubh' : 'shubh_enhi_ads')
  const resp = await send('/text-to-speech', JSON.stringify({
    text: input, language_code, model, speaker, output_audio_codec:'mp3',
  }), 'application/json', options)
  const encoded = resp?.audios?.[0]
  if (typeof encoded !== 'string' || encoded.length > 5_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new SarvamProviderError('tts_audio_invalid')
  const audio = Buffer.from(encoded, 'base64')
  if (!audio.length || audio.length > 4_000_000) throw new SarvamProviderError('tts_audio_size')
  return audio
}
export async function sarvamSpeechToText(audio: ArrayBuffer | Buffer, contentType = 'audio/ogg', opts: SpeechDeps & {
  mode?: 'transcribe' | 'translate' | 'verbatim' | 'translit' | 'codemix'; keyterms?: string[]; model?: 'saaras:v3' | 'saaras:v4'
} = {}): Promise<{ text: string; languageCode: string | null }> {
  const bytes = Buffer.isBuffer(audio) ? audio : Buffer.from(new Uint8Array(audio))
  if (!bytes.length || bytes.length > MAX_STT_BYTES) throw new SarvamProviderError('stt_audio_size')
  const allowed = /^(?:audio\/(?:ogg|opus|mpeg|mp3|mp4|aac|amr|wav|x-wav|webm|x-m4a)|video\/mp4)(?:;.*)?$/i
  if (!allowed.test(contentType)) throw new SarvamProviderError('stt_media_invalid')
  const form = new FormData()
  const extension = /(?:mpeg|mp3)/i.test(contentType) ? 'mp3' : /wav/i.test(contentType) ? 'wav'
    : /(?:mp4|m4a)/i.test(contentType) ? 'm4a' : /webm/i.test(contentType) ? 'webm' : 'ogg'
  form.append('file', new File([Uint8Array.from(bytes)], 'voice-note.' + extension, { type: contentType }))
  const model = opts.model || 'saaras:v4'
  form.append('model', model)
  // Saaras v4 defaults to transcribe; callers can explicitly request codemix,
  // translit, translate or verbatim for language-sensitive workflows.
  // Saaras v3 keeps the previous codemix default for backward compatibility.
  if (model === 'saaras:v3') form.append('mode', opts.mode || 'codemix')
  else if (opts.mode) form.append('mode', opts.mode)
  // Keyterms are supported only by Saaras v4 and must be one JSON-encoded multipart field.
  const hints = opts.keyterms || ['AskGogo', 'CreditIQ', 'Razorpay', 'ONDC', 'Bengaluru']
  if (model === 'saaras:v4') {
    if (hints.length > 50 || hints.some(k => !k.trim() || k.length > 64)) throw new SarvamProviderError('stt_keyterms_invalid')
    if (hints.length) form.append('keyterms', JSON.stringify([...new Set(hints)]))
  }
  const resp = await send('/speech-to-text', form, null, opts)
  const text = typeof resp?.transcript === 'string' ? resp.transcript.trim() : ''
  if (!text) throw new SarvamProviderError('stt_empty')
  return { text, languageCode: typeof resp.language_code === 'string' ? resp.language_code : null }
}
