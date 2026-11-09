// Listen button (9 Nov, approved mock): reads one Gogo reply aloud on the dashboard, only when tapped.
// Pure planning here; the component and the /api/dashboard/voice route do the playing. Rules:
//   - privacy 'local' never sends text to the cloud; a language the device cannot speak says so instead.
//   - 'auto' prefers the device voice (text stays on the phone) and falls back to the cloud voice.
//   - A language is claimed only at the catalogue's level: Hindi is 'partial' and is labelled so.
//   - Nothing here speaks on its own, and nothing here sends, books or pays.
import { routeVoice, VOICE_CATALOGUE, type LanguageCode, type LanguageSupport } from './providers'

export type VoiceSource = 'auto' | 'local' | 'cloud'
export const VOICE_SOURCE_KEY = 'gogo.voice.source'
export const VOICE_SOURCES: { id: VoiceSource; title: string; detail: string }[] = [
  { id: 'auto', title: 'Best available', detail: "Your device's voice first; AskGogo's cloud voice when the device has none for the language." },
  { id: 'local', title: 'On this device only', detail: 'Text never leaves your phone to be spoken. Some languages will not play.' },
  { id: 'cloud', title: 'AskGogo voice', detail: 'Same voice as WhatsApp voice notes. Sent to the speech service to be read.' },
]
export function parseVoiceSource(v: unknown): VoiceSource { return v === 'local' || v === 'cloud' ? v : 'auto' }

/** Script-based guess, good enough to pick a voice. Latin text with Hindi function words is Hinglish. */
export function detectSpeechLanguage(text: string): LanguageCode {
  const t = String(text || '')
  const dev = (t.match(/[ऀ-ॿ]/g) || []).length
  const kan = (t.match(/[ಀ-೿]/g) || []).length
  const letters = (t.match(/\p{L}/gu) || []).length || 1
  if (kan / letters > 0.3) return 'kn'
  if (dev / letters > 0.3) return 'hi'
  if (/\b(?:hai|nahi|kya|karo|kar do|bhai|theek|accha|kal|aaj|abhi|mujhe|tumhe|hum|aap)\b/i.test(t) && (t.match(/\b(?:hai|nahi|kya|karo|bhai|theek|accha|kal|aaj|abhi|mujhe|aap)\b/gi) || []).length >= 2) return 'hinglish'
  return 'en'
}

/** BCP-47 tags the device voices cover → which of our language codes have a device voice. */
export function deviceLanguages(voiceLangs: readonly string[]): Set<LanguageCode> {
  const out = new Set<LanguageCode>()
  for (const raw of voiceLangs) {
    const l = String(raw || '').toLowerCase().replace('_', '-')
    if (l.startsWith('en')) out.add('en')
    if (l.startsWith('hi')) { out.add('hi'); out.add('hinglish') }
    if (l.startsWith('kn')) out.add('kn')
    if (l.startsWith('ta')) out.add('ta'); if (l.startsWith('te')) out.add('te'); if (l.startsWith('ml')) out.add('ml'); if (l.startsWith('mr')) out.add('mr'); if (l.startsWith('bn')) out.add('bn')
  }
  return out
}

export type ListenPlan =
  | { engine: 'browser' | 'cloud'; language: LanguageCode; support: LanguageSupport; label: string | null }
  | { engine: null; language: LanguageCode; reason: 'no_device_voice' | 'no_engine' | 'empty'; message: string }

const LANG_NAME: Record<LanguageCode, string> = { en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali', hinglish: 'Hinglish' }

/** Which engine reads this text, under this privacy choice, on this device. Pure. */
export function planListen(input: { text: string; source: VoiceSource; deviceLangs: ReadonlySet<LanguageCode>; cloudAvailable: boolean }): ListenPlan {
  const language = detectSpeechLanguage(input.text)
  if (!String(input.text || '').trim()) return { engine: null, language, reason: 'empty', message: 'Nothing to read.' }
  const privacy = input.source === 'local' ? 'local_only' : input.source === 'cloud' ? 'cloud_ok' : 'local_preferred'
  const available: Record<string, boolean> = {
    'browser-speech': input.source !== 'cloud' && input.deviceLangs.has(language),
    'openai-tts': input.source !== 'local' && input.cloudAvailable,
  }
  // The catalogue lists the device voice for en/hi only; a device that reports a voice for the language can speak it.
  const catalogue = VOICE_CATALOGUE.map(c => c.id === 'browser-speech' ? { ...c, languages: { ...c.languages, [language]: c.languages[language] || 'partial' } } : c)
  const r = routeVoice({ kind: 'tts', language, platform: 'dashboard', privacy, commercialUse: true, allowPartial: true, available, catalogue })
  if (!r.ok) {
    if (input.source === 'local') return { engine: null, language, reason: 'no_device_voice', message: `No voice on this device for ${LANG_NAME[language]}. Change Voice to "Best available" to use the AskGogo voice.` }
    return { engine: null, language, reason: 'no_engine', message: 'Listening is not available right now.' }
  }
  const support = r.chosen.languages[language] || 'partial'
  const engine = r.chosen.runtime === 'cloud' ? 'cloud' : 'browser'
  const label = language === 'en' ? null : `${LANG_NAME[language]} · ${support}`
  return { engine, language, support, label }
}

/** Rough spoken length, for "about 9 sec" next to the button. */
export function estimateSeconds(text: string): number { const words = String(text || '').trim().split(/\s+/).filter(Boolean).length; return Math.max(1, Math.round(words / 2.6)) }

/** The BCP-47 tag to ask the device for. */
export function speechLocale(language: LanguageCode): string {
  return ({ en: 'en-IN', hi: 'hi-IN', hinglish: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN', te: 'te-IN', ml: 'ml-IN', mr: 'mr-IN', bn: 'bn-IN' } as Record<LanguageCode, string>)[language]
}

export type ListenBlocked = Extract<ListenPlan, { engine: null }>
export function listenBlocked(p: ListenPlan | null | undefined): p is ListenBlocked { return !!p && p.engine === null }
