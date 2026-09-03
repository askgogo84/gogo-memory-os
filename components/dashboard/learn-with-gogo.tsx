'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GogoLesson } from '@/lib/dashboard/lessons'

const AUTO_VERIFIED = new Set(['first-reminder', 'recurring-reminders'])
type VerifyState = 'idle' | 'waiting' | 'checking' | 'done'

export function LearnWithGogo({ lessons, completedKeys }: { lessons: GogoLesson[]; completedKeys: string[] }) {
  const [completed, setCompleted] = useState(new Set(completedKeys))
  const firstOpen = lessons.findIndex((lesson, index) => !completedKeys.includes(lesson.key) && (index === 0 || completedKeys.includes(lessons[index - 1]?.key)))
  const [activeKey, setActiveKey] = useState(lessons[Math.max(firstOpen, 0)]?.key || lessons[0]?.key || '')
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [watched, setWatched] = useState(new Set<string>(completedKeys))
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const active = lessons.find((l) => l.key === activeKey) || lessons[0]
  const doneCount = completed.size
  const pct = lessons.length ? Math.round((doneCount / lessons.length) * 100) : 0
  const categories = useMemo(() => Array.from(new Set(lessons.map((l) => l.category))), [lessons])
  const autoVerified = Boolean(active && AUTO_VERIFIED.has(active.key))

  const isUnlocked = (index: number) => index === 0 || completed.has(lessons[index - 1]?.key)

  async function markDone(key: string) {
    const response = await fetch('/api/dashboard/learning-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonKey: key, action: 'complete' }),
    }).catch(() => null)
    if (!response?.ok) return
    setCompleted((old) => new Set([...old, key]))
    setWatched((old) => new Set([...old, key]))
  }

  async function startLesson(key: string) {
    const response = await fetch('/api/dashboard/learning-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonKey: key, action: 'start' }),
    }).catch(() => null)
    if (!response?.ok) return false
    const data = await response.json().catch(() => null) as any
    if (data?.completed) {
      setCompleted((old) => new Set([...old, key]))
      setVerifyState('done')
    } else setVerifyState('waiting')
    return true
  }

  async function verifyLesson(key: string) {
    if (!AUTO_VERIFIED.has(key) || completed.has(key)) return false
    setVerifyState((current) => current === 'waiting' ? 'checking' : current)
    const response = await fetch('/api/dashboard/learning-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonKey: key, action: 'verify' }),
    }).catch(() => null)
    if (!response?.ok) return false
    const data = await response.json().catch(() => null) as any
    if (data?.completed) {
      setCompleted((old) => new Set([...old, key]))
      setVerifyState('done')
      return true
    }
    if (data?.reason === 'waiting_for_action') setVerifyState('waiting')
    else if (data?.reason === 'not_started') setVerifyState('idle')
    return false
  }

  async function openPractice(lesson: GogoLesson) {
    if (!watched.has(lesson.key)) return
    if (AUTO_VERIFIED.has(lesson.key)) {
      const started = await startLesson(lesson.key)
      if (!started) return
    }
    if (lesson.prompt) window.location.href = `/dashboard/chat?prompt=${encodeURIComponent(lesson.prompt)}`
  }

  async function finishNarration() {
    if (!active) return
    setPlaying(false)
    setProgress(1)
    setWatched((old) => new Set([...old, active.key]))
    if (active.key === 'meet-gogo') await markDone(active.key)
    else if (AUTO_VERIFIED.has(active.key)) await startLesson(active.key)
  }

  function toggleNarration() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    } else {
      audio.pause()
      setPlaying(false)
    }
  }

  useEffect(() => {
    setVerifyState(completed.has(activeKey) ? 'done' : 'idle')
    setProgress(0)
    setPlaying(false)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (!AUTO_VERIFIED.has(activeKey) || completed.has(activeKey)) return
    let stopped = false
    const check = async () => { if (!stopped) await verifyLesson(activeKey) }
    void check()
    const timer = window.setInterval(() => { void check() }, 3000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [activeKey, completed])

  const scene = progress < .18 ? 0 : progress < .52 ? 1 : progress < .78 ? 2 : 3
  const sceneCopy = active ? [
    { eyebrow: 'WHY IT HELPS', title: active.description, body: 'One useful behavior at a time. Gogo keeps the explanation short, then you do the real thing.' },
    { eyebrow: 'EXAMPLE', title: active.example || active.prompt || active.title, body: 'This is the kind of natural language Gogo understands.' },
    { eyebrow: 'WHAT GOGO DOES', title: active.result || 'Gogo handles the action and keeps the useful context.', body: 'No menus to learn. No special command syntax.' },
    { eyebrow: 'YOUR TURN', title: active.tryText || 'Try this skill yourself now.', body: 'The next lesson stays locked until this one is completed.' },
  ][scene] : null

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="rounded-[28px] border border-gogo-ink/7 bg-gogo-surface/72 p-5 shadow-[0_18px_55px_rgba(62,35,18,.045)] xl:sticky xl:top-8 xl:h-[calc(100vh-6rem)] xl:overflow-y-auto">
        <div className="flex items-center gap-3">
          <img src="/gogo-float.gif" alt="Gogo" className="h-14 w-14 object-contain" />
          <div><div className="text-[9px] font-bold uppercase tracking-[0.17em] text-gogo-orange">Master Gogo</div><div className="font-serif text-[23px] font-semibold text-gogo-ink">Learn by doing</div></div>
        </div>
        <div className="mt-5 rounded-[18px] border border-gogo-ink/7 bg-gogo-cream/55 p-4">
          <div className="flex items-center justify-between text-[11px] font-bold text-gogo-ink-2"><span>Your progress</span><span>{doneCount}/{lessons.length}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gogo-ink/7"><div className="h-full rounded-full bg-gogo-orange transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="mt-2 text-[10px] text-gogo-ink-4">{pct}% explored</div>
        </div>
        <div className="mt-5 rounded-[18px] border border-gogo-orange/15 bg-gogo-orange-tint/55 px-4 py-3 text-[10.5px] leading-5 text-gogo-ink-2">Watch it. Try it. Gogo checks the real action where verification is available. Only then does the next skill unlock.</div>
        <div className="mt-5 space-y-5">
          {categories.map((category) => (
            <div key={category}>
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">{category}</div>
              <div className="space-y-1.5">
                {lessons.filter((l) => l.category === category).map((lesson) => {
                  const lessonIndex = lessons.findIndex((l) => l.key === lesson.key)
                  const unlocked = isUnlocked(lessonIndex)
                  const selected = lesson.key === active?.key
                  const done = completed.has(lesson.key)
                  return <button key={lesson.key} type="button" disabled={!unlocked} onClick={() => unlocked && setActiveKey(lesson.key)} className={`flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left transition ${selected ? 'bg-gogo-orange-tint text-gogo-ink' : unlocked ? 'hover:bg-gogo-cream/60 text-gogo-ink-2' : 'cursor-not-allowed bg-gogo-ink/[.018] text-gogo-ink-4 opacity-55'}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] ${done ? 'bg-emerald-500/12 text-emerald-700' : 'bg-gogo-ink/5 text-gogo-ink-4'}`}>{done ? '✓' : unlocked ? '▶' : '🔒'}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-bold">{lesson.title}</span><span className="block text-[9.5px] text-gogo-ink-4">{unlocked ? `${lesson.minutes} min` : 'Complete the previous lesson first'}</span></span>
                  </button>
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 overflow-hidden rounded-[30px] border border-gogo-ink/7 bg-gogo-surface/72 shadow-[0_24px_70px_rgba(62,35,18,.055)]">
        {active && <div>
          <div className="relative overflow-hidden border-b border-gogo-ink/7 bg-gogo-rail/55 px-6 py-7 sm:px-8">
            <div className="pointer-events-none absolute -right-10 -top-24 h-72 w-72 rounded-full bg-gogo-plum/10 blur-3xl" />
            <div className="relative flex items-start gap-4"><img src="/gogo-figure.png" alt="" className="hidden h-16 w-16 rounded-full object-cover sm:block" /><div><div className="text-[9.5px] font-bold uppercase tracking-[0.17em] text-gogo-orange">{active.category} · {active.minutes} min</div><h2 className="mt-2 font-serif text-[34px] font-semibold tracking-[-.5px] text-gogo-ink sm:text-[40px]">{active.title}</h2><p className="mt-2 max-w-2xl text-[13px] leading-6 text-gogo-ink-3">{active.description}</p></div></div>
          </div>

          <div className="p-5 sm:p-8">
            <div className="overflow-hidden rounded-[28px] border border-gogo-ink/8 bg-[#2f1c13] shadow-[0_24px_70px_rgba(31,20,14,.14)]">
              <div className="grid min-h-[420px] md:grid-cols-[38%_62%]">
                <div className="relative flex items-end justify-center overflow-hidden bg-[radial-gradient(circle_at_45%_35%,rgba(241,130,25,.22),transparent_42%),linear-gradient(180deg,#4a2a1b,#2f1c13)] px-6 pt-8">
                  <div className="absolute left-5 top-5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.17em] text-[#f7c79b]">MASTER GOGO</div>
                  <img src="/gogo-figure.png" alt="Guide Gogo" className={`relative z-10 w-[78%] max-w-[300px] object-contain transition-transform duration-700 ${playing ? 'scale-[1.025]' : 'scale-100'}`} />
                  <div className="pointer-events-none absolute bottom-4 h-14 w-52 rounded-full bg-black/25 blur-2xl" />
                </div>
                <div className="relative flex flex-col justify-between bg-[#fff9f2] p-7 sm:p-10">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[.18em] text-gogo-orange">{sceneCopy?.eyebrow}</div>
                    <div className="mt-4 max-w-2xl font-serif text-[28px] font-semibold leading-[1.18] text-gogo-ink sm:text-[36px]">{sceneCopy?.title}</div>
                    <div className="mt-5 max-w-xl text-[13px] leading-6 text-gogo-ink-3">{sceneCopy?.body}</div>
                    {scene === 1 && active.example && <div className="mt-7 rounded-[20px] border border-gogo-ink/8 bg-white px-5 py-4 text-[14px] font-semibold leading-6 text-gogo-ink shadow-sm">“{active.example}”</div>}
                    {scene === 2 && active.result && <div className="mt-7 rounded-[20px] border border-emerald-600/15 bg-emerald-50 px-5 py-4 text-[13px] font-bold leading-6 text-emerald-800">{active.result}</div>}
                  </div>
                  <div className="mt-8">
                    <div className="h-1.5 overflow-hidden rounded-full bg-gogo-ink/7"><div className="h-full rounded-full bg-gogo-orange transition-[width] duration-200" style={{ width: `${Math.max(progress * 100, 2)}%` }} /></div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <button type="button" onClick={toggleNarration} className="inline-flex items-center gap-2 rounded-full bg-gogo-ink px-5 py-2.5 text-[11px] font-bold text-white"><span>{playing ? '❚❚' : '▶'}</span>{playing ? 'Pause Gogo' : progress > 0 ? 'Continue lesson' : 'Play lesson'}</button>
                      <span className="text-[10px] text-gogo-ink-4">Mature Gogo voice · captions on screen</span>
                    </div>
                    {active.audioSrc && <audio ref={audioRef} src={active.audioSrc} preload="metadata" onTimeUpdate={(e) => { const a=e.currentTarget; if (a.duration) setProgress(Math.min(a.currentTime/a.duration,1)) }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => void finishNarration()} />}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="rounded-[24px] border border-gogo-ink/7 bg-gogo-cream/55 p-5 sm:p-6">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-plum">Try it for real</div>
                <ol className="mt-4 space-y-4">{(active.steps || []).map((step,index)=><li key={step} className="flex gap-3 text-[13px] leading-6 text-gogo-ink-2"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gogo-surface text-[11px] font-bold text-gogo-orange shadow-sm">{index+1}</span><span>{step}</span></li>)}</ol>
              </div>
              <div className="rounded-[24px] border border-gogo-ink/7 bg-gogo-rail/55 p-5 text-center">
                <img src="/gogo-float.gif" alt="Gogo" className="mx-auto h-24 w-24 object-contain" />
                <div className="font-serif text-[22px] font-semibold text-gogo-ink">{watched.has(active.key) ? 'Your turn' : 'Watch first'}</div>
                <p className="mt-2 text-[11px] leading-5 text-gogo-ink-3">{watched.has(active.key) ? (active.tryText || 'Try the real skill now.') : 'Finish Gogo’s short lesson before the practice step unlocks.'}</p>
                {active.prompt && <button type="button" disabled={!watched.has(active.key)} onClick={() => void openPractice(active)} className={`mt-4 w-full rounded-full px-4 py-2.5 text-[11px] font-bold ${watched.has(active.key) ? 'bg-gogo-ink text-white' : 'cursor-not-allowed bg-gogo-ink/8 text-gogo-ink-4'}`}>Open Talk to Gogo</button>}
                {!active.prompt && watched.has(active.key) && active.key !== 'meet-gogo' && !completed.has(active.key) && <button type="button" onClick={() => void markDone(active.key)} className="mt-4 w-full rounded-full border border-gogo-ink/8 bg-gogo-surface px-4 py-2.5 text-[11px] font-bold text-gogo-ink-2">I did it · unlock next</button>}
                {active.prompt && !autoVerified && watched.has(active.key) && !completed.has(active.key) && <button type="button" onClick={() => void markDone(active.key)} className="mt-3 w-full rounded-full border border-gogo-ink/8 bg-gogo-surface px-4 py-2.5 text-[11px] font-bold text-gogo-ink-2">I completed the practice</button>}
                {autoVerified && <div className={`mt-4 rounded-[16px] border px-4 py-3 text-[11px] font-bold ${completed.has(active.key) ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-gogo-orange/20 bg-gogo-orange-tint text-gogo-ink-2'}`}>{completed.has(active.key) || verifyState==='done' ? '✓ Skill complete · next lesson unlocked' : verifyState==='waiting'||verifyState==='checking' ? '● Waiting for Gogo to see your real action…' : 'Next lesson stays locked until you do it'}</div>}
                {completed.has(active.key) && !autoVerified && <div className="mt-4 rounded-[16px] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[11px] font-bold text-emerald-700">✓ Skill complete · next lesson unlocked</div>}
              </div>
            </div>
          </div>
        </div>}
      </main>
    </div>
  )
}
