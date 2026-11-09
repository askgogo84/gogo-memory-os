'use client'
// Listen (9 Nov, approved mock): one button under a Gogo reply. Ready → Preparing → Playing → Stop. Device voice first,
// AskGogo cloud voice when the device has none, never on its own. While playing, a window event tells any listening
// microphone on the page to ignore what it hears (the echo guard), so Gogo never answers its own voice.
import { useCallback, useEffect, useRef, useState } from 'react'
import { deviceLanguages, estimateSeconds, listenBlocked, parseVoiceSource, planListen, speechLocale, VOICE_SOURCE_KEY, type ListenPlan, type VoiceSource } from '@/lib/voice/listen'
import { speechText } from '@/lib/voice/speech-text'
import { ECHO_TAIL_MS } from '@/lib/voice/echo-guard'

type S = 'idle' | 'loading' | 'playing' | 'off'
const SPEAKING_EVENT = 'gogo:speaking'
let current: { stop: () => void } | null = null // one reply speaks at a time

function announce(until: number) { try { window.dispatchEvent(new CustomEvent(SPEAKING_EVENT, { detail: { until } })) } catch {} }
function readSource(): VoiceSource { try { return parseVoiceSource(window.localStorage.getItem(VOICE_SOURCE_KEY)) } catch { return 'auto' } }

function PlayIcon() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z" fill="currentColor" stroke="none"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/></svg> }
function StopIcon() { return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg> }
function LoadIcon() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="motion-safe:animate-spin"><path d="M12 4a8 8 0 1 0 8 8"/></svg> }
function MuteIcon() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z" fill="currentColor" stroke="none"/><path d="M16 9l5 6M21 9l-5 6"/></svg> }

export function ListenButton({ text }: { text: string }) {
  const spoken = speechText(text)
  const [state, setState] = useState<S>('idle')
  const [plan, setPlan] = useState<ListenPlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const total = estimateSeconds(spoken)

  // Plan once the device voices are known (Chrome loads them late).
  useEffect(() => {
    if (!spoken) return
    const compute = () => {
      let langs: string[] = []
      try { langs = (window.speechSynthesis?.getVoices?.() || []).map(v => v.lang) } catch {}
      const p = planListen({ text: spoken, source: readSource(), deviceLangs: deviceLanguages(langs), cloudAvailable: true })
      setPlan(p); setState(s => s === 'idle' || s === 'off' ? (p.engine ? 'idle' : 'off') : s)
    }
    compute()
    try { window.speechSynthesis?.addEventListener?.('voiceschanged', compute) } catch {}
    const onStorage = (e: StorageEvent) => { if (e.key === VOICE_SOURCE_KEY) compute() }
    window.addEventListener('storage', onStorage)
    return () => { try { window.speechSynthesis?.removeEventListener?.('voiceschanged', compute) } catch {}; window.removeEventListener('storage', onStorage) }
  }, [spoken])

  const clearTimer = () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null } }
  const finish = useCallback(() => { clearTimer(); announce(Date.now() + ECHO_TAIL_MS); setState('idle'); setElapsed(0); if (current && current.stop === stopRef.current) current = null }, [])
  const stopRef = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    try { window.speechSynthesis?.cancel?.() } catch {}
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.src = '' } catch {}; audioRef.current = null }
    finish()
  }, [finish])
  stopRef.current = stop

  useEffect(() => () => { if (current?.stop === stopRef.current) stop() }, [stop])

  const startTimer = () => { clearTimer(); const t0 = Date.now(); timerRef.current = window.setInterval(() => setElapsed(Math.min(total, Math.round((Date.now() - t0) / 1000))), 500) }

  const play = async () => {
    if (!plan?.engine) return
    setError(null)
    if (current) current.stop()
    current = { stop }
    if (plan.engine === 'browser') {
      try {
        const u = new SpeechSynthesisUtterance(spoken)
        u.lang = speechLocale(plan.language)
        const voice = (window.speechSynthesis.getVoices() || []).find(v => v.lang.toLowerCase().replace('_', '-').startsWith(u.lang.slice(0, 2)))
        if (voice) u.voice = voice
        u.onend = finish; u.onerror = () => { setError("Couldn't play on this device."); finish() }
        announce(Date.now() + total * 1000 + 2000)
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(u)
        setState('playing'); startTimer()
      } catch { setError("Couldn't play on this device."); finish() }
      return
    }
    setState('loading')
    try {
      const r = await fetch('/api/dashboard/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: spoken }) })
      if (current?.stop !== stop) return // cancelled while preparing
      if (!r.ok) { setError(r.status === 503 ? 'The AskGogo voice is not available right now.' : "Couldn't prepare the audio."); finish(); return }
      const url = URL.createObjectURL(await r.blob())
      const a = new Audio(url); audioRef.current = a
      a.onended = () => { URL.revokeObjectURL(url); finish() }
      a.onerror = () => { URL.revokeObjectURL(url); setError("Couldn't play the audio."); finish() }
      a.onloadedmetadata = () => announce(Date.now() + (Number.isFinite(a.duration) ? a.duration * 1000 : total * 1000) + 2000)
      await a.play()
      setState('playing'); startTimer()
    } catch { setError("Couldn't prepare the audio."); finish() }
  }

  if (!spoken) return null
  const blocked = listenBlocked(plan) ? plan : null
  const base = 'inline-flex min-h-[44px] items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium transition'
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return <div className="mt-3 flex flex-wrap items-center gap-2.5" data-listen>
    {state === 'off' || !plan?.engine
      ? <span className={`${base} cursor-default border-[#2a2a2a] text-[#a8a8a4]`} aria-disabled="true"><MuteIcon/>{blocked?.reason === 'no_device_voice' ? 'No voice on this device' : 'Listen unavailable'}</span>
      : state === 'loading'
        ? <button type="button" onClick={stop} aria-busy="true" className={`${base} border-[#2f2f2f] bg-[#161616] text-[#f2efea]`}><LoadIcon/>Preparing…</button>
        : state === 'playing'
          ? <><button type="button" onClick={stop} className={`${base} border-[#4cd0bd] bg-[#123d38] text-[#f2efea]`}><StopIcon/>Stop</button>
              <span className="h-1 min-w-[80px] flex-1 overflow-hidden rounded bg-[#2a2a2a]" aria-hidden="true"><span className="block h-full bg-[#4cd0bd]" style={{ width: `${Math.min(100, Math.round(100 * elapsed / Math.max(1, total)))}%` }}/></span>
              <span className="text-[12.5px] tabular-nums text-[#a8a8a4]">{fmt(elapsed)} / {fmt(total)}</span></>
          : <><button type="button" onClick={play} className={`${base} border-[#2f2f2f] bg-[#161616] text-[#f2efea] hover:border-[#4cd0bd]`}><PlayIcon/>Listen</button>
              <span className="text-[12.5px] text-[#a8a8a4]">about {total} sec</span></>}
    {plan && 'label' in plan && plan.label && <span className="rounded-full bg-[#3a2a10] px-2 py-0.5 text-[12px] text-[#e2b04a]">{plan.label}</span>}
    {blocked?.reason === 'no_device_voice' && <span className="text-[12.5px] text-[#a8a8a4]">{blocked.message}</span>}
    {error && <span role="alert" className="text-[12.5px] text-[#d96c5f]">{error}</span>}
  </div>
}

/** Settings → Voice: where the voice is made. Stored per device; the Listen button reads it. */
export function VoiceSourceSetting() {
  const [source, setSource] = useState<VoiceSource>('auto')
  useEffect(() => { setSource(readSource()) }, [])
  const choose = (s: VoiceSource) => { setSource(s); try { window.localStorage.setItem(VOICE_SOURCE_KEY, s) } catch {} }
  return <div role="radiogroup" aria-label="Where the voice is made" className="mt-3 flex flex-col gap-2">
    {([['auto', 'Best available', "Your device's voice first; AskGogo's cloud voice when the device has none for the language."], ['local', 'On this device only', 'Text never leaves your phone to be spoken. Some languages will not play.'], ['cloud', 'AskGogo voice', 'Same voice as WhatsApp voice notes. Sent to the speech service to be read.']] as const).map(([id, title, detail]) =>
      <button key={id} type="button" role="radio" aria-checked={source === id} onClick={() => choose(id)} className={`flex min-h-[48px] items-start gap-3 rounded-[12px] border p-3 text-left ${source === id ? 'border-[#4cd0bd] bg-[#123d38]' : 'border-[#2a2a2a] bg-[#161616]'}`}>
        <span aria-hidden="true" className={`mt-0.5 h-[18px] w-[18px] shrink-0 rounded-full border-2 ${source === id ? 'border-[6px] border-[#4cd0bd]' : 'border-[#2f2f2f]'}`}/>
        <span className="min-w-0"><span className="block text-[15px] font-semibold text-[#f2efea]">{title}</span><span className="block text-[13px] text-[#a8a8a4]">{detail}</span></span>
      </button>)}
  </div>
}
