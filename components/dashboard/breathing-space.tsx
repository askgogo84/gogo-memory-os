'use client'

import { useEffect, useRef, useState } from 'react'

type Phase = { label: string; seconds: number; scale: number; hint: string }
type Mode = { key: 'balance' | 'box' | 'relax'; name: string; subtitle: string; sound: string; phases: Phase[] }

const MODES: Mode[] = [
  {
    key: 'balance',
    name: 'Balance',
    subtitle: '5–5 · steady and simple',
    sound: 'Warm drone · soft chime',
    phases: [
      { label: 'Inhale', seconds: 5, scale: 1, hint: 'Breathe in gently through your nose.' },
      { label: 'Exhale', seconds: 5, scale: 0.68, hint: 'Let the breath leave slowly.' },
    ],
  },
  {
    key: 'box',
    name: 'Stress reset',
    subtitle: '4–4–4–4 · grounded',
    sound: 'Low bowl · grounding pulse',
    phases: [
      { label: 'Inhale', seconds: 4, scale: 1, hint: 'Fill slowly and comfortably.' },
      { label: 'Hold', seconds: 4, scale: 1, hint: 'Stay soft. No straining.' },
      { label: 'Exhale', seconds: 4, scale: 0.68, hint: 'Release the air steadily.' },
      { label: 'Rest', seconds: 4, scale: 0.68, hint: 'Pause gently before the next breath.' },
    ],
  },
  {
    key: 'relax',
    name: 'Deep relax',
    subtitle: '4–7–8 · slow down',
    sound: 'Deep ambient pad · distant bell',
    phases: [
      { label: 'Inhale', seconds: 4, scale: 1, hint: 'Breathe in softly.' },
      { label: 'Hold', seconds: 7, scale: 1, hint: 'Keep your shoulders relaxed.' },
      { label: 'Exhale', seconds: 8, scale: 0.68, hint: 'Long, easy exhale.' },
    ],
  },
]

type AmbientHandle = { stop: () => void }

function startAmbientSound(modeKey: Mode['key']): AmbientHandle | null {
  if (typeof window === 'undefined') return null
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioCtx) return null

  const ctx: AudioContext = new AudioCtx()
  const master = ctx.createGain()
  const toneBus = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  const timers: number[] = []
  const persistent: OscillatorNode[] = []
  let stopped = false

  master.gain.setValueAtTime(0.0001, ctx.currentTime)
  master.gain.exponentialRampToValueAtTime(modeKey === 'relax' ? 0.018 : 0.021, ctx.currentTime + 1.8)
  filter.type = 'lowpass'
  filter.frequency.value = modeKey === 'box' ? 760 : modeKey === 'relax' ? 1050 : 1500
  filter.Q.value = 0.45
  toneBus.connect(filter)
  filter.connect(master)
  master.connect(ctx.destination)

  const preset = modeKey === 'balance'
    ? { freqs: [220, 277.18, 329.63], gains: [0.32, 0.19, 0.14], detunes: [0, -5, 4] }
    : modeKey === 'box'
      ? { freqs: [110, 146.83, 220], gains: [0.38, 0.18, 0.11], detunes: [0, 3, -4] }
      : { freqs: [82.41, 123.47, 164.81, 220], gains: [0.34, 0.18, 0.13, 0.08], detunes: [0, -4, 3, -7] }

  preset.freqs.forEach((freq, index) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = index === 0 ? 'sine' : 'triangle'
    osc.frequency.value = freq
    osc.detune.value = preset.detunes[index]
    gain.gain.value = preset.gains[index]
    osc.connect(gain)
    gain.connect(toneBus)
    osc.start()
    persistent.push(osc)
  })

  // Very slow movement keeps the pad alive without turning it into a melody.
  const lfo = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  lfo.type = 'sine'
  lfo.frequency.value = modeKey === 'box' ? 0.125 : modeKey === 'relax' ? 0.045 : 0.07
  lfoGain.gain.value = modeKey === 'box' ? 0.005 : 0.0035
  lfo.connect(lfoGain)
  lfoGain.connect(master.gain)
  lfo.start()
  persistent.push(lfo)

  const ring = (frequency: number, duration = 3.4, level = 0.055) => {
    if (stopped || ctx.state === 'closed') return
    const now = ctx.currentTime
    const bellGain = ctx.createGain()
    const bell = ctx.createOscillator()
    const shimmer = ctx.createOscillator()
    const shimmerGain = ctx.createGain()

    bell.type = 'sine'
    shimmer.type = 'sine'
    bell.frequency.setValueAtTime(frequency, now)
    shimmer.frequency.setValueAtTime(frequency * 2.01, now)
    bellGain.gain.setValueAtTime(0.0001, now)
    bellGain.gain.exponentialRampToValueAtTime(level, now + 0.035)
    bellGain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    shimmerGain.gain.setValueAtTime(level * 0.24, now)
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.72)

    bell.connect(bellGain)
    shimmer.connect(shimmerGain)
    bellGain.connect(master)
    shimmerGain.connect(master)
    bell.start(now)
    shimmer.start(now)
    bell.stop(now + duration + 0.05)
    shimmer.stop(now + duration + 0.05)
  }

  if (modeKey === 'balance') {
    const timer = window.setInterval(() => ring(659.25, 2.8, 0.032), 14000)
    timers.push(timer)
  } else if (modeKey === 'box') {
    // A quiet bowl-like pulse every box cycle. The low fundamental helps this
    // feel grounded rather than melodic.
    const timer = window.setInterval(() => ring(174.61, 4.2, 0.045), 16000)
    timers.push(timer)
  } else {
    const timer = window.setInterval(() => ring(440, 5.2, 0.027), 19000)
    timers.push(timer)
  }

  return {
    stop() {
      if (stopped) return
      stopped = true
      timers.forEach((timer) => window.clearInterval(timer))
      try {
        master.gain.cancelScheduledValues(ctx.currentTime)
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime)
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7)
        window.setTimeout(() => {
          persistent.forEach((osc) => { try { osc.stop() } catch {} })
          void ctx.close()
        }, 760)
      } catch {
        void ctx.close()
      }
    },
  }
}

export function BreathingSpace() {
  const [open, setOpen] = useState(false)
  const [modeIndex, setModeIndex] = useState(0)
  const [phaseIndex, setPhaseIndex] = useState(0)
  const [remaining, setRemaining] = useState(MODES[0].phases[0].seconds)
  const [running, setRunning] = useState(false)
  const [soundOn, setSoundOn] = useState(true)
  const [cycles, setCycles] = useState(0)
  const ambientRef = useRef<AmbientHandle | null>(null)

  const mode = MODES[modeIndex]
  const phase = mode.phases[phaseIndex]

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      setRemaining((value) => {
        if (value > 1) return value - 1
        setPhaseIndex((current) => {
          const next = (current + 1) % mode.phases.length
          if (next === 0) setCycles((count) => count + 1)
          return next
        })
        return 0
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running, mode.phases.length])

  useEffect(() => {
    if (!running) return
    setRemaining(phase.seconds)
  }, [phaseIndex, modeIndex, running, phase.seconds])

  useEffect(() => () => ambientRef.current?.stop(), [])

  const stop = () => {
    setRunning(false)
    ambientRef.current?.stop()
    ambientRef.current = null
  }

  const close = () => {
    stop()
    setOpen(false)
    setPhaseIndex(0)
    setCycles(0)
    setRemaining(MODES[modeIndex].phases[0].seconds)
  }

  const start = () => {
    setPhaseIndex(0)
    setRemaining(mode.phases[0].seconds)
    setCycles(0)
    setRunning(true)
    if (soundOn && !ambientRef.current) ambientRef.current = startAmbientSound(mode.key)
  }

  const toggleSound = () => {
    setSoundOn((current) => {
      const next = !current
      if (!next) {
        ambientRef.current?.stop()
        ambientRef.current = null
      } else if (running && !ambientRef.current) {
        ambientRef.current = startAmbientSound(mode.key)
      }
      return next
    })
  }

  const changeMode = (index: number) => {
    stop()
    setModeIndex(index)
    setPhaseIndex(0)
    setCycles(0)
    setRemaining(MODES[index].phases[0].seconds)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group fixed right-5 top-5 z-40 grid h-14 w-14 place-items-center rounded-full border border-gogo-ink/10 bg-gogo-surface/82 shadow-[0_12px_35px_rgba(62,35,18,0.12)] backdrop-blur-xl transition hover:-translate-y-0.5 lg:right-7 lg:top-6"
        aria-label="Open breathing space"
        title="Breathe with Gogo"
      >
        <span className="absolute inset-1 rounded-full bg-gogo-plum/8 transition group-hover:bg-gogo-plum/14" />
        <img src="/gogo-figure.png" alt="" className="gogo-float relative h-10 w-10 rounded-full object-cover" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#1b120f]/88 px-3 py-3 backdrop-blur-2xl sm:px-4 sm:py-5">
          <div className="relative mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1180px] flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_50%_45%,rgba(196,151,193,.28),transparent_28%),radial-gradient(circle_at_78%_15%,rgba(231,174,102,.22),transparent_32%),linear-gradient(145deg,#291710,#4a2c1f_45%,#6f5940)] text-white shadow-2xl sm:min-h-[calc(100vh-2.5rem)] sm:rounded-[32px]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(9,5,4,.12)_58%,rgba(9,5,4,.35)_100%)]" />

            <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-8 sm:py-5">
              <button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/10 text-xl text-white/90 backdrop-blur" aria-label="Close breathing space">←</button>
              <div className="min-w-0 px-2 text-center">
                <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/55 sm:text-[10px] sm:tracking-[0.22em]">Breathe with Gogo</div>
                <div className="mt-1 hidden text-sm font-semibold text-white/85 sm:block">A quiet minute, whenever you need one.</div>
              </div>
              <button type="button" onClick={toggleSound} className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/10 text-white/90 backdrop-blur" aria-label={soundOn ? 'Mute ambient sound' : 'Turn on ambient sound'} title={soundOn ? 'Sound on' : 'Sound off'}>{soundOn ? '♪' : '×'}</button>
            </header>

            <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-5 text-center sm:px-8 sm:py-8">
              <div className="mb-4 max-w-[92vw] rounded-2xl border border-white/15 bg-white/88 px-4 py-3 text-left text-[#3e2312] shadow-lg sm:mb-5 sm:max-w-none">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#714c77]">AskGogo</div>
                <div className="mt-1 text-[13px] font-semibold sm:text-sm">{running ? phase.hint : 'Get comfortable. Let your shoulders soften. Begin when you’re ready.'}</div>
              </div>

              <div className="relative grid h-[220px] w-[220px] place-items-center sm:h-[300px] sm:w-[300px]">
                <div className="absolute inset-0 rounded-full border border-white/25 bg-white/5" />
                <div
                  className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle_at_40%_35%,#ffd7df_0%,#d998e0_34%,#7867ed_68%,#3f3c92_100%)] shadow-[0_0_65px_rgba(230,143,210,.38)]"
                  style={{
                    transform: `scale(${running ? phase.scale : 0.72})`,
                    transitionProperty: 'transform',
                    transitionDuration: `${running ? phase.seconds : 1.2}s`,
                    transitionTimingFunction: 'ease-in-out',
                  }}
                />
                <div className="absolute inset-[31%] overflow-hidden rounded-full border border-white/30 bg-white/10 shadow-inner">
                  <img src="/gogo-figure.png" alt="Gogo meditating" className="h-full w-full object-cover" />
                </div>
                <div className="relative z-10 mt-[184px] rounded-full border border-white/15 bg-black/20 px-4 py-2 text-xs font-semibold text-white/90 backdrop-blur sm:mt-[250px] sm:text-sm">
                  {running ? `${phase.label} · ${remaining || phase.seconds}s` : mode.name}
                </div>
              </div>

              <div className="mt-6 min-h-12 sm:mt-8">
                {running ? (
                  <div>
                    <div className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{phase.label}</div>
                    <div className="mt-1 text-xs text-white/60 sm:text-sm">Cycle {cycles + 1} · breathe only as comfortably as feels natural.</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{mode.name}</div>
                    <div className="mt-1 text-xs text-white/60 sm:text-sm">{mode.subtitle}</div>
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">{mode.sound}</div>
                  </div>
                )}
              </div>

              <div className="mt-5 grid w-full max-w-[720px] grid-cols-1 gap-2 sm:mt-7 sm:grid-cols-3">
                {MODES.map((item, index) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => changeMode(index)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${index === modeIndex ? 'border-white/45 bg-white/18' : 'border-white/14 bg-black/10 hover:bg-white/10'}`}
                  >
                    <div className="text-xs font-bold text-white/90">{item.name}</div>
                    <div className="mt-0.5 text-[10px] text-white/50">{item.subtitle}</div>
                    <div className="mt-1 text-[9px] text-white/35">{item.sound}</div>
                  </button>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-center gap-3 sm:mt-6">
                {!running ? (
                  <button type="button" onClick={start} className="min-w-36 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#3e2312] shadow-lg transition hover:scale-[1.02]">Begin</button>
                ) : (
                  <button type="button" onClick={stop} className="min-w-36 rounded-full border border-white/30 bg-black/15 px-6 py-3 text-sm font-bold text-white backdrop-blur">Pause</button>
                )}
              </div>
            </main>

            <footer className="relative z-10 px-5 pb-4 text-center text-[10px] text-white/45 sm:px-6 sm:pb-5 sm:text-[10.5px]">If you feel light-headed or uncomfortable, stop and return to normal breathing.</footer>
          </div>
        </div>
      )}
    </>
  )
}
