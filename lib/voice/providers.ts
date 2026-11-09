// Voice provider abstraction (8 Nov). One catalogue of speech engines with their licence, where they run, what
// languages they actually cover and what hardware they need; one router that picks an engine for a request or says
// why none fits. Nothing here sends audio anywhere: it decides. The working OpenAI TTS (createVoiceNote) and Whisper
// (transcribeVoice) paths are unchanged; they are listed here as the cloud providers so callers can move onto the
// router behind GOGO_VOICE_ROUTER without behaviour changing.
//
// Rules the router enforces (tests: scripts/verify-voice-router-nov8.mts):
//   - Production (commercialUse) never selects an engine whose licence is not cleared for commercial use. Woof is
//     non-commercial; Piper voices carry their own licences and stay uncleared until each voice is checked.
//   - privacy 'local_only' never selects a cloud engine, and says so instead of falling back.
//   - A language is claimed only at the level the source states ('full' | 'partial'); nothing is inferred from English
//     demos. Kannada is not claimed by any local engine here.
//   - Phone calls stay on the existing telephony stack (Bolna/Plivo): the router never swaps that engine.

export type VoiceKind = 'tts' | 'stt'
export type VoiceRuntime = 'cloud' | 'server_local' | 'browser' | 'device'
export type VoicePlatform = 'whatsapp' | 'dashboard' | 'desktop' | 'android' | 'phone_call'
export type PrivacyPreference = 'local_only' | 'local_preferred' | 'cloud_ok'
export type LanguageCode = 'en' | 'hi' | 'kn' | 'ta' | 'te' | 'ml' | 'mr' | 'bn' | 'hinglish'
export type LanguageSupport = 'full' | 'partial'

export type VoiceLicence = {
  /** SPDX-ish id or the vendor's licence name, as published. */
  id: string
  /** true = cleared for AskGogo's commercial use; false = not allowed; null = not yet verified (treated as not allowed). */
  commercial: boolean | null
  attribution?: string
  source: string
  note?: string
}

export type VoiceCapability = {
  id: string
  kind: VoiceKind
  label: string
  runtime: VoiceRuntime
  licence: VoiceLicence
  languages: Partial<Record<LanguageCode, LanguageSupport>>
  /** Rough resident memory needed to run, MB; 0 for cloud. */
  memoryMb: number
  needsWebGPU?: boolean
  streaming: boolean
  /** Typical time to first audio on the target runtime, ms. null = not measured; never invented. */
  firstAudioMs: number | null
}

/** The interfaces engines implement. The router only reads capabilities; these are what callers invoke after it picks. */
export interface SpeechSynthesizer { capability: VoiceCapability; synthesize(text: string, opts: { language: LanguageCode; voice?: string; signal?: AbortSignal }): Promise<{ audio: ArrayBuffer | Uint8Array; mime: string }> }
export interface SpeechRecognizer { capability: VoiceCapability; transcribe(audio: ArrayBuffer | Uint8Array, opts: { language?: LanguageCode; signal?: AbortSignal }): Promise<{ text: string; language?: string }> }

const OPENAI_SUPPORTED = 'https://platform.openai.com/docs/guides/text-to-speech'

/** The catalogue. Licence facts as published on 8 Nov 2026; see the PR for sources. */
export const VOICE_CATALOGUE: readonly VoiceCapability[] = [
  {
    id: 'openai-tts', kind: 'tts', label: 'OpenAI TTS (gpt-4o-mini-tts, tts-1)', runtime: 'cloud',
    licence: { id: 'openai-terms', commercial: true, source: OPENAI_SUPPORTED, note: 'current production voice notes' },
    // Vendor lists these languages; quality on Indian names, INR and Hinglish not yet measured, so non-English is partial.
    languages: { en: 'full', hi: 'partial', kn: 'partial', ta: 'partial', te: 'partial', ml: 'partial', mr: 'partial', bn: 'partial', hinglish: 'partial' },
    memoryMb: 0, streaming: true, firstAudioMs: null,
  },
  {
    id: 'openai-whisper', kind: 'stt', label: 'OpenAI Whisper', runtime: 'cloud',
    licence: { id: 'openai-terms', commercial: true, source: 'https://platform.openai.com/docs/guides/speech-to-text', note: 'current production voice-note transcription' },
    languages: { en: 'full', hi: 'partial', kn: 'partial', ta: 'partial', te: 'partial', ml: 'partial', mr: 'partial', bn: 'partial', hinglish: 'partial' },
    memoryMb: 0, streaming: false, firstAudioMs: null,
  },
  {
    id: 'browser-speech', kind: 'tts', label: "The device's own voices (Web Speech API)", runtime: 'browser',
    licence: { id: 'platform', commercial: true, source: 'https://developer.mozilla.org/docs/Web/API/SpeechSynthesis', note: 'voices come from the OS; languages depend on the device' },
    languages: { en: 'full', hi: 'partial' }, memoryMb: 0, streaming: true, firstAudioMs: null,
  },
  {
    id: 'kokoro-82m', kind: 'tts', label: 'Kokoro 82M (ONNX)', runtime: 'browser',
    licence: { id: 'apache-2.0', commercial: true, source: 'https://huggingface.co/hexgrad/Kokoro-82M', note: 'NVIDIA ONNX build also Apache-2.0 (huggingface.co/nvidia/kokoro-82M-onnx-opt)' },
    // Model card: English full; Hindi among "partial support". No Kannada.
    languages: { en: 'full', hi: 'partial' }, memoryMb: 350, needsWebGPU: false, streaming: false, firstAudioMs: null,
  },
  {
    id: 'piper', kind: 'tts', label: 'Piper (ONNX, CPU)', runtime: 'server_local',
    licence: { id: 'GPL-3.0 engine; per-voice model licences', commercial: null, source: 'https://huggingface.co/rhasspy/piper-voices', note: 'rhasspy/piper moved to OHF-Voice/piper1-gpl; each voice has its own MODEL_CARD licence, unverified here' },
    languages: { en: 'full' }, memoryMb: 120, streaming: true, firstAudioMs: null,
  },
  {
    id: 'underdog-woof', kind: 'tts', label: 'Underdog Woof', runtime: 'browser',
    licence: { id: 'underdog-non-commercial-1.0', commercial: false, attribution: 'Voice by Underdog Woof', source: 'https://huggingface.co/ConwayResearch/Underdog-Woof', note: 'commercial use needs a licence from Underdog (license@conway.tech); no training on its audio' },
    languages: { en: 'full' }, memoryMb: 60, streaming: false, firstAudioMs: null,
  },
]

const RUNTIMES_FOR: Record<VoicePlatform, VoiceRuntime[]> = {
  whatsapp: ['server_local', 'cloud'], // audio is made on the server and sent as a voice note
  dashboard: ['browser', 'cloud'],
  desktop: ['device', 'browser', 'cloud'],
  android: ['device', 'cloud'],
  phone_call: [], // the call stack keeps its own streaming engine
}

export type RouteRequest = {
  kind: VoiceKind
  language: LanguageCode
  platform: VoicePlatform
  privacy: PrivacyPreference
  /** AskGogo production is commercial use. Only a research harness sets this false. */
  commercialUse: boolean
  hardware?: { memoryMb?: number; webgpu?: boolean }
  /** Accept engines whose support for the language is 'partial'. Default true for cloud fallback, false otherwise. */
  allowPartial?: boolean
  /** Which engines are installed/configured right now (keys, cached weights). Missing = unavailable. */
  available: Partial<Record<string, boolean>>
  catalogue?: readonly VoiceCapability[]
}

export type Rejection = { id: string; reason: 'kind' | 'licence' | 'privacy' | 'platform' | 'hardware' | 'language' | 'unavailable' }
export type RouteResult =
  | { ok: true; chosen: VoiceCapability; fallbacks: VoiceCapability[]; rejected: Rejection[] }
  | { ok: false; reason: 'telephony_unchanged' | 'no_engine'; detail: string; rejected: Rejection[] }

/** Picks a speech engine, or explains why none fits. Pure. */
export function routeVoice(req: RouteRequest): RouteResult {
  const cat = req.catalogue || VOICE_CATALOGUE
  if (req.platform === 'phone_call') return { ok: false, reason: 'telephony_unchanged', detail: 'Phone calls keep the existing Bolna/Plivo streaming voice until full-duplex latency, barge-in and cost are measured better.', rejected: [] }
  const rejected: Rejection[] = []
  const fits: { c: VoiceCapability; support: LanguageSupport }[] = []
  for (const c of cat) {
    if (c.kind !== req.kind) { rejected.push({ id: c.id, reason: 'kind' }); continue }
    if (req.commercialUse && c.licence.commercial !== true) { rejected.push({ id: c.id, reason: 'licence' }); continue }
    if (req.privacy === 'local_only' && c.runtime === 'cloud') { rejected.push({ id: c.id, reason: 'privacy' }); continue }
    if (!RUNTIMES_FOR[req.platform].includes(c.runtime)) { rejected.push({ id: c.id, reason: 'platform' }); continue }
    const mem = req.hardware?.memoryMb
    if ((mem !== undefined && c.memoryMb > 0 && c.memoryMb > mem * 0.25) || (c.needsWebGPU && !req.hardware?.webgpu)) { rejected.push({ id: c.id, reason: 'hardware' }); continue }
    const support = c.languages[req.language]
    const allowPartial = req.allowPartial ?? c.runtime === 'cloud'
    if (!support || (support === 'partial' && !allowPartial)) { rejected.push({ id: c.id, reason: 'language' }); continue }
    if (!req.available[c.id]) { rejected.push({ id: c.id, reason: 'unavailable' }); continue }
    fits.push({ c, support })
  }
  if (!fits.length) {
    const why = req.privacy === 'local_only' ? 'No local engine fits this language and device; cloud is off by your privacy setting, so nothing will be spoken.' : 'No engine fits this request.'
    return { ok: false, reason: 'no_engine', detail: why, rejected }
  }
  const local = (r: VoiceRuntime) => r !== 'cloud'
  fits.sort((a, b) => {
    if (req.privacy === 'local_preferred' || req.privacy === 'local_only') { const d = Number(local(b.c.runtime)) - Number(local(a.c.runtime)); if (d) return d }
    const s = Number(b.support === 'full') - Number(a.support === 'full'); if (s) return s
    return (a.c.firstAudioMs ?? 1e9) - (b.c.firstAudioMs ?? 1e9)
  })
  return { ok: true, chosen: fits[0].c, fallbacks: fits.slice(1).map(f => f.c), rejected }
}

export function voiceRouterEnabled(env: Record<string, string | undefined> = process.env) { return env.GOGO_VOICE_ROUTER === '1' }
