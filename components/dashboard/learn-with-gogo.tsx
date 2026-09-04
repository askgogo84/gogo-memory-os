'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { GogoLesson } from '@/lib/dashboard/lessons'

const AUTO_VERIFIED = new Set(['first-reminder', 'recurring-reminders'])
const MASTER_GOGO_PRESENTER = 'https://dnznrvs05pmza.cloudfront.net/kling-o3-pro/924560893566914607/Animate_this_exact_seated_Guide_Gogo_as_a_calm_teacher_speaking_directly_to_the_learner__Preserve_th.mp4?_jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJrZXlIYXNoIjoiOTNmOWI5ZDI3OGNkOTdmZiIsImJ1Y2tldCI6InJ1bndheS10YXNrLWFydGlmYWN0cyIsInN0YWdlIjoicHJvZCIsImV4cCI6MTc4ODU2NTU4Nn0.S_r9wv-pnAvKTp-ICKB9jlAq6OJUm7jT511oh7f9U1M'

type VerifyState = 'idle' | 'waiting' | 'checking' | 'done'
type PracticeMessage = { role: 'user' | 'assistant'; content: string }

function linkify(text: string) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="font-semibold text-gogo-orange underline underline-offset-2">{part}</a>
    : <span key={index}>{part}</span>)
}

export function LearnWithGogo({ lessons, completedKeys }: { lessons: GogoLesson[]; completedKeys: string[] }) {
  const [completed, setCompleted] = useState(new Set(completedKeys))
  const firstOpen = lessons.findIndex((lesson) => !completedKeys.includes(lesson.key))
  const [activeKey, setActiveKey] = useState(lessons[Math.max(firstOpen, 0)]?.key || lessons[0]?.key || '')
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [watched, setWatched] = useState(new Set<string>(completedKeys))
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [practiceText, setPracticeText] = useState('')
  const [practiceMessages, setPracticeMessages] = useState<PracticeMessage[]>([])
  const [practiceSending, setPracticeSending] = useState(false)
  const [practiceError, setPracticeError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const presenterRef = useRef<HTMLVideoElement | null>(null)
  const lessonTopRef = useRef<HTMLDivElement | null>(null)
  const practiceEndRef = useRef<HTMLDivElement | null>(null)

  const active = lessons.find((l) => l.key === activeKey) || lessons[0]
  const activeIndex = lessons.findIndex((l) => l.key === activeKey)
  const nextLesson = activeIndex >= 0 ? lessons[activeIndex + 1] : undefined
  const doneCount = completed.size
  const pct = lessons.length ? Math.round((doneCount / lessons.length) * 100) : 0
  const categories = useMemo(() => Array.from(new Set(lessons.map((l) => l.category))), [lessons])
  const autoVerified = Boolean(active && AUTO_VERIFIED.has(active.key))

  function resetPractice() {
    setPracticeOpen(false)
    setPracticeText('')
    setPracticeMessages([])
    setPracticeSending(false)
    setPracticeError('')
  }

  function selectLesson(key: string) {
    if (navigator.vibrate) navigator.vibrate(10)
    resetPractice()
    setActiveKey(key)
    window.requestAnimationFrame(() => lessonTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function showPractice(lesson: GogoLesson) {
    setPracticeMessages([])
    setPracticeError('')
    setPracticeText(lesson.prompt || '')
    setPracticeOpen(true)
    window.setTimeout(() => practiceEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }

  function moveToNext(key: string, delay = 900) {
    const index = lessons.findIndex((lesson) => lesson.key === key)
    const next = lessons[index + 1]
    if (!next) return
    window.setTimeout(() => selectLesson(next.key), delay)
  }

  async function markDone(key: string, advance = true) {
    const response = await fetch('/api/dashboard/learning-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonKey: key, action: 'complete' }),
    }).catch(() => null)
    if (!response?.ok) return false
    setCompleted((old) => new Set([...old, key]))
    setWatched((old) => new Set([...old, key]))
    if (advance) moveToNext(key)
    return true
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

  async function verifyLesson(key: string, advance = false) {
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
      if (advance) moveToNext(key, 1200)
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
    showPractice(lesson)
  }

  async function submitPractice(value?: string) {
    const text = String(value ?? practiceText).trim()
    if (!text || practiceSending || !active) return
    setPracticeError('')
    setPracticeText('')
    setPracticeMessages((old) => [...old, { role: 'user', content: text }])
    setPracticeSending(true)
    try {
      const response = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const data = await response.json().catch(() => ({})) as any
      if (!response.ok) throw new Error(data?.message || 'practice_failed')
      setPracticeMessages((old) => [...old, { role: 'assistant', content: String(data?.text || 'Done.') }])
      if (AUTO_VERIFIED.has(active.key)) {
        window.setTimeout(() => { void verifyLesson(active.key, true) }, 500)
      }
    } catch (error: any) {
      setPracticeError(error?.message && error.message !== 'practice_failed' ? error.message : 'Gogo had trouble with that. Try once more.')
    } finally {
      setPracticeSending(false)
    }
  }

  function onPracticeSubmit(event: FormEvent) {
    event.preventDefault()
    void submitPractice()
  }

  async function finishNarration() {
    if (!active) return
    setPlaying(false)
    presenterRef.current?.pause()
    setProgress(1)
    setWatched((old) => new Set([...old, active.key]))

    if (active.key === 'meet-gogo') {
      await markDone(active.key, false)
      return
    }

    if (AUTO_VERIFIED.has(active.key)) {
      const started = await startLesson(active.key)
      if (!started) return
    }

    if (active.prompt) {
      window.setTimeout(() => showPractice(active), 250)
    }
  }

  function toggleNarration() {
    const audio = audioRef.current
    const presenter = presenterRef.current
    if (!audio) return
    if (audio.paused) {
      void audio.play().then(() => {
        setPlaying(true)
        if (presenter) {
          presenter.muted = true
          void presenter.play().catch(() => {})
        }
      }).catch(() => {
        setPlaying(false)
        presenter?.pause()
        setPracticeError('The lesson audio could not start. Refresh once and try again.')
      })
    } else {
      audio.pause()
      presenter?.pause()
      setPlaying(false)
    }
  }

  useEffect(() => {
    setVerifyState(completed.has(activeKey) ? 'done' : 'idle')
    setProgress(0)
    setPlaying(false)
    resetPractice()
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (presenterRef.current) {
      presenterRef.current.pause()
      presenterRef.current.currentTime = 0
    }
    if (!AUTO_VERIFIED.has(activeKey) || completed.has(activeKey)) return
    let stopped = false
    const check = async () => { if (!stopped) await verifyLesson(activeKey, false) }
    void check()
    const timer = window.setInterval(() => { void check() }, 3000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [activeKey])

  useEffect(() => {
    practiceEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [practiceMessages, practiceSending])

  const scene = progress < .18 ? 0 : progress < .52 ? 1 : progress < .78 ? 2 : 3
  const sceneCopy = active ? [
    { eyebrow: 'WHY IT HELPS', title: active.description, body: 'Gogo explains one useful behavior, shows a real example, then you try it yourself.' },
    { eyebrow: 'EXAMPLE', title: active.example || active.prompt || active.title, body: 'This is the kind of natural language Gogo understands.' },
    { eyebrow: 'WHAT GOGO DOES', title: active.result || 'Gogo handles the action and keeps the useful context.', body: 'No menus to learn. No special command syntax.' },
    { eyebrow: 'YOUR TURN', title: active.tryText || 'Try this skill yourself now.', body: 'Practice it when you want. Every lesson stays open so you can learn in any order.' },
  ][scene] : null

  return (
    <div className="grid w-full gap-5 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
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
        <div className="mt-5 rounded-[18px] border border-gogo-orange/15 bg-gogo-orange-tint/55 px-4 py-3 text-[10.5px] leading-5 text-gogo-ink-2">All lessons are open. Pick anything that looks useful, or follow the suggested order.</div>
        <div className="mt-5 space-y-5">
          {categories.map((category) => (
            <div key={category}>
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">{category}</div>
              <div className="space-y-1.5">
                {lessons.filter((l) => l.category === category).map((lesson) => {
                  const selected = lesson.key === active?.key
                  const done = completed.has(lesson.key)
                  const seen = watched.has(lesson.key)
                  return (
                    <button key={lesson.key} type="button" onClick={() => selectLesson(lesson.key)}
                      className={`w-full rounded-[15px] px-3 py-2.5 text-left transition active:scale-[.99] ${selected ? 'bg-gogo-orange-tint ring-1 ring-gogo-orange/20' : 'hover:bg-gogo-cream/70'}`}>
                      <div className="flex items-start gap-2.5">
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${done ? 'bg-emerald-100 text-emerald-700' : seen ? 'bg-gogo-orange/10 text-gogo-orange' : 'bg-gogo-ink/5 text-gogo-ink-4'}`}>{done ? '✓' : seen ? '▶' : '•'}</div>
                        <div className="min-w-0"><div className={`text-[11px] font-semibold ${selected ? 'text-gogo-ink' : 'text-gogo-ink-2'}`}>{lesson.title}</div><div className="mt-0.5 text-[9.5px] text-gogo-ink-4">{done ? 'Completed' : seen ? 'Watched' : `${lesson.minutes} min`}</div></div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section ref={lessonTopRef} className="min-w-0 rounded-[28px] border border-gogo-ink/7 bg-gogo-surface/72 shadow-[0_18px_55px_rgba(62,35,18,.045)]">
        <div className="border-b border-gogo-ink/7 px-5 py-5 sm:px-7 lg:px-8">
          <div className="text-[9px] font-bold uppercase tracking-[0.17em] text-gogo-orange">{active?.category} · {active?.minutes} min</div>
          <div className="mt-1 font-serif text-[31px] font-semibold leading-tight text-gogo-ink">{active?.title}</div>
          <div className="mt-2 max-w-3xl text-[11px] leading-5 text-gogo-ink-3">{active?.description}</div>
        </div>

        <div className="p-4 sm:p-6 lg:p-7">
          <div className="overflow-hidden rounded-[26px] border border-gogo-ink/20 bg-[#fbf6ec]">
            <div className="grid min-h-[330px] lg:grid-cols-[42%_58%]">
              <div className="relative overflow-hidden bg-[#fff8df]">
                <video ref={presenterRef} src={MASTER_GOGO_PRESENTER} muted loop playsInline preload="metadata" className="h-full min-h-[330px] w-full object-cover" />
                <div className="absolute left-4 top-4 rounded-full bg-white/80 px-3 py-1 text-[8px] font-bold uppercase tracking-[0.16em] text-gogo-orange backdrop-blur">Master Gogo</div>
              </div>
              <div className="flex min-h-[330px] flex-col justify-center p-6 lg:p-8">
                <div className="text-[8px] font-bold uppercase tracking-[0.18em] text-gogo-orange">{sceneCopy?.eyebrow}</div>
                <div className="mt-3 font-serif text-[29px] font-semibold leading-[1.08] text-gogo-ink">{sceneCopy?.title}</div>
                <div className="mt-4 max-w-xl text-[11px] leading-5 text-gogo-ink-3">{sceneCopy?.body}</div>
                {active?.example && <div className="mt-5 rounded-[16px] border border-gogo-ink/10 bg-white/80 px-4 py-3 text-[11px] font-medium text-gogo-ink-2">“{active.example}”</div>}
                <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-gogo-ink/7"><div className="h-full rounded-full bg-gogo-orange transition-all" style={{ width: `${Math.max(5, progress * 100)}%` }} /></div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button type="button" onClick={toggleNarration} className="rounded-full bg-gogo-ink px-4 py-2 text-[10px] font-bold text-white active:scale-[.98]">{playing ? 'Pause lesson' : progress > 0 && progress < 1 ? 'Continue lesson' : 'Play lesson'}</button>
                  <div className="text-[9px] text-gogo-ink-4">Animated Gogo · narration · captions</div>
                </div>
                <audio ref={audioRef} src={active?.audioSrc} preload="metadata" onTimeUpdate={(e) => { const a = e.currentTarget; if (a.duration) setProgress(a.currentTime / a.duration) }} onEnded={() => { void finishNarration() }} />
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_270px]">
            <div className="rounded-[22px] border border-gogo-ink/7 bg-gogo-cream/45 p-5">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-gogo-ink-4">Try it for real</div>
              <div className="mt-3 space-y-3">{active?.steps?.map((step, i) => <div key={step} className="flex gap-3 text-[11px] leading-5 text-gogo-ink-2"><div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[9px] font-bold text-gogo-orange">{i + 1}</div><div>{step}</div></div>)}</div>
            </div>
            <div className="rounded-[22px] border border-gogo-ink/7 bg-gogo-cream/45 p-5 text-center">
              <img src="/gogo-float.gif" alt="Gogo" className="mx-auto h-14 w-14 object-contain" />
              <div className="mt-2 font-serif text-[20px] font-semibold text-gogo-ink">Your turn</div>
              <div className="mt-1 text-[10px] leading-4 text-gogo-ink-4">{active?.tryText}</div>
              <button type="button" disabled={!watched.has(active?.key || '')} onClick={() => active && void openPractice(active)} className="mt-4 w-full rounded-full bg-gogo-ink px-4 py-2.5 text-[10px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-35 active:scale-[.98]">Practice below ↓</button>
            </div>
          </div>

          {practiceOpen && active && (
            <div className="mt-5 overflow-hidden rounded-[22px] border border-gogo-orange/15 bg-white/70">
              <div className="flex items-center justify-between border-b border-gogo-ink/7 px-5 py-3">
                <div><div className="text-[8px] font-bold uppercase tracking-[0.15em] text-gogo-orange">Practice without leaving the lesson</div><div className="mt-0.5 font-serif text-[17px] font-semibold text-gogo-ink">Talk to Gogo here</div></div>
                <button type="button" onClick={resetPractice} className="rounded-full border border-gogo-ink/10 px-3 py-1 text-[9px] font-semibold text-gogo-ink-4">Close</button>
              </div>
              <div className="space-y-3 p-5">
                <div className="rounded-[14px] bg-gogo-cream/55 px-4 py-3 text-[10px] text-gogo-ink-4">Try the suggested phrase below, or change it to something real for you.</div>
                {practiceMessages.map((message, index) => <div key={index} className={`max-w-[86%] rounded-[16px] px-4 py-3 text-[11px] leading-5 ${message.role === 'user' ? 'ml-auto bg-gogo-orange text-white' : 'bg-gogo-cream text-gogo-ink-2'}`}>{linkify(message.content)}</div>)}
                {practiceSending && <div className="max-w-[86%] rounded-[16px] bg-gogo-cream px-4 py-3 text-[11px] text-gogo-ink-4">Gogo is working on that…</div>}
                {practiceError && <div className="text-[10px] font-medium text-red-600">{practiceError}</div>}
                <div ref={practiceEndRef} />
                <form onSubmit={onPracticeSubmit} className="flex items-center gap-2 rounded-[16px] border border-gogo-ink/10 bg-gogo-cream/45 p-2">
                  <input value={practiceText} onChange={(e) => setPracticeText(e.target.value)} placeholder={active.prompt || 'Type naturally…'} className="min-w-0 flex-1 bg-transparent px-2 text-[11px] text-gogo-ink outline-none placeholder:text-gogo-ink-4" />
                  <button disabled={!practiceText.trim() || practiceSending} className="flex h-9 w-9 items-center justify-center rounded-xl bg-gogo-orange text-sm font-bold text-white disabled:opacity-35">↑</button>
                </form>
                {autoVerified && verifyState !== 'done' && <div className="text-[9.5px] text-gogo-ink-4">{verifyState === 'checking' ? 'Checking that AskGogo completed the real action…' : 'Complete the real action and Gogo will mark this lesson practised.'}</div>}
                {verifyState === 'done' && <div className="text-[9.5px] font-semibold text-emerald-700">✓ Practised with a real AskGogo action</div>}
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-gogo-ink/7 bg-gogo-cream/35 px-4 py-3">
            <div className="text-[10px] text-gogo-ink-4">Every lesson is available anytime. Progress still tracks what you have explored.</div>
            {nextLesson && <button type="button" onClick={() => selectLesson(nextLesson.key)} className="rounded-full border border-gogo-ink/10 bg-white px-4 py-2 text-[10px] font-bold text-gogo-ink-2 active:scale-[.98]">Next: {nextLesson.title} →</button>}
          </div>
        </div>
      </section>
    </div>
  )
}
