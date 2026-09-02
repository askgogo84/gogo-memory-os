'use client'

import { useEffect, useRef, useState } from 'react'

type Phase = { label: string; seconds: number; scale: number; hint: string }
type Mode = { key: string; name: string; subtitle: string; phases: Phase[] }

const MODES: Mode[] = [
  {
    key: 'balance',
    name: 'Balance',
    subtitle: '5–5 · steady and simple',
    phases: [
      { label: 'Inhale', seconds: 5, scale: 1, hint: 'Breathe in gently through your nose.' },
      { label: 'Exhale', seconds: 5, scale: 0.68, hint: 'Let the breath leave slowly.' },
    ],
  },
  {
    key: 'box',
    name: 'Stress reset',
    subtitle: '4–4–4–4 · grounded',
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
    phases: [
      { label: 'Inhale', seconds: 4, scale: 1, hint: 'Breathe in softly.' },
      { label: 'Hold', seconds: 7, scale: 1, hint: 'Keep your shoulders relaxed.' },
      { label: 'Exhale', seconds: 8, scale: 0.68, hint: 'Long, easy exhale.' },
    ],
  },
]

function startAmbientSound() {
  if (typeof window === 'undefined') return null
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioCtx) return null

  const ctx: AudioContext = new AudioCtx()
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.0001, ctx.currentTime)
  master.gain.exponentialRampToValueAtTime(0.022, ctx.currentTime + 1.8)
  master.connect(ctx.destination)

  const freqs = [220, 277.18, 329.63]
  const oscillators = freqs.map((freq, index) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    osc.detune.value = index === 1 ? -5 : index === 2 ? 4 : 0
    gain.gain.value = index === 0 ? 0.34 : 0.2
    osc.connect(gain)
    gain.connect(master)
    osc.start()
    return osc
  })

  const lfo = ctx.createOscillator()
  const lfoGain = ctx.createGain()
  lfo.type = 'sine'
  lfo.frequency.value = 0.075
  lfoGain.gain.value = 0.004
  lfo.connect(lfoGain)
  lfoGain.connect(master.gain)
  lfo.start()

  return {
    stop() {
      try {
        master.gain.cancelScheduledValues(ctx.currentTime)
        master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime)
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6)
        window.setTimeout(() => {
          oscillators.forEach((osc) => { try { osc.stop() } catch {} })
          try { lfo.stop() } catch {}
          void ctx.close()
        }, 650)
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
  const ambientRef = useRef<ReturnType<typeof startAmbientSound>>(null)

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
    if (soundOn && !ambientRef.current) ambientRef.current = startAmbientSound()
  }

  const toggleSound = () => {
    setSoundOn((current) => {
      const next = !current
      if (!next) {
        ambientRef.current?.stop()
        ambientRef.current = null
      } else if (running && !ambientRef.current) {
        ambientRef.current = startAmbientSound()
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
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#1b120f]/88 px-4 py-5 backdrop-blur-2xl">
          <div className="relative mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-[1180px] flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_50%_45%,rgba(196,151,193,.28),transparent_28%),radial-gradient(circle_at_78%_15%,rgba(231,174,102,.22),transparent_32%),linear-gradient(145deg,#291710,#4a2c1f_45%,#6f5940)] text-white shadow-2xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(9,5,4,.12)_58%,rgba(9,5,4,.35)_100%)]" />

            <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8">
              <button type="button" onClick={close} className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/10 text-xl text-white/90 backdrop-blur" aria-label="Close breathing space">←</button>
              <div className="text-center">
                <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/55">Breathe with Gogo</div>
                <div className="mt-1 text-sm font-semibold text-white/85">A quiet minute, whenever you need one.</div>
              </div>
              <button type="button" onClick={toggleSound} className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/10 text-white/90 backdrop-blur" aria-label={soundOn ? 'Mute ambient sound' : 'Turn on ambient sound'} title={soundOn ? 'Sound on' : 'Sound off'}>{soundOn ? '♪' : '×'}</button>
            </header>

            <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-8 text-center sm:px-8">
              <div className="mb-5 rounded-2xl border border-white/15 bg-white/88 px-4 py-3 text-left text-[#3e2312] shadow-lg">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#714c77]">AskGogo</div>
                <div className="mt-1 text-sm font-semibold">{running ? phase.hint : 'Get comfortable. Let your shoulders soften. Begin when you’re ready.'}</div>
              </div>

              <div className="relative grid h-[250px] w-[250px] place-items-center sm:h-[300px] sm:w-[300px]">
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
                <div className="relative z-10 mt-[210px] rounded-full border border-white/15 bg-black/20 px-4 py-2 text-sm font-semibold text-white/90 backdrop-blur sm:mt-[250px]">
                  {running ? `${phase.label} · ${remaining || phase.seconds}s` : mode.name}
                </div>
              </div>

              <div className="mt-8 min-h-12">
                {running ? (
                  <div>
                    <div className="text-3xl font-semibold tracking-[-0.04em]">{phase.label}</div>
                    <div className="mt-1 text-sm text-white/60">Cycle {cycles + 1} · breathe only as comfortably as feels natural.</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-3xl font-semibold tracking-[-0.04em]">{mode.name}</div>
                    <div className="mt-1 text-sm text-white/60">{mode.subtitle}</div>
                  </div>
                )}
              </div>

              <div className="mt-7 flex flex-wrap justify-center gap-2">
                {MODES.map((item, index) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => changeMode(index)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${index === modeIndex ? 'border-white/45 bg-white/18' : 'border-white/14 bg-black/10 hover:bg-white/10'}`}
                  >
                    <div className="text-xs font-bold text-white/90">{item.name}</div>
                    <div className="mt-0.5 text-[10px] text-white/50">{item.subtitle}</div>
                  </button>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-center gap-3">
                {!running ? (
                  <button type="button" onClick={start} className="min-w-36 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#3e2312] shadow-lg transition hover:scale-[1.02]">Begin</button>
                ) : (
                  <button type="button" onClick={stop} className="min-w-36 rounded-full border border-white/30 bg-black/15 px-6 py-3 text-sm font-bold text-white backdrop-blur">Pause</button>
                )}
              </div>
            </main>

            <footer className="relative z-10 px-6 pb-5 text-center text-[10.5px] text-white/45">If you feel light-headed or uncomfortable, stop and return to normal breathing.</footer>
          </div>
        </div>
      )}
    </>
  )
}
