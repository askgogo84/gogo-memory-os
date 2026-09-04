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
  const firstOpen = lessons.findIndex((lesson, index) => !completedKeys.includes(lesson.key) && (index === 0 || completedKeys.includes(lessons[index - 1]?.key)))
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

  const isUnlocked = (index: number) => index === 0 || completed.has(lessons[index - 1]?.key)

  function resetPractice() {
    setPracticeOpen(false)
    setPracticeText('')
    setPracticeMessages([])
    setPracticeSending(false)
    setPracticeError('')
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
    window.setTimeout(() => {
      resetPractice()
      setActiveKey(next.key)
      window.requestAnimationFrame(() => lessonTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }, delay)
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
      await markDone(active.key, true)
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
    { eyebrow: 'YOUR TURN', title: active.tryText || 'Try this skill yourself now.', body: 'Stay here. Practice below, and the next lesson unlocks in this same page.' },
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
        <div className="mt-5 rounded-[18px] border border-gogo-orange/15 bg-gogo-orange-tint/55 px-4 py-3 text-[10.5px] leading-5 text-gogo-ink-2">Watch → try → verify → unlock. You stay inside this learning room throughout.</div>
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

      <main ref={lessonTopRef} className="min-w-0 overflow-hidden rounded-[30px] border border-gogo-ink/7 bg-gogo-surface/72 shadow-[0_24px_70px_rgba(62,35,18,.055)]">
        {active && <div>
          <div className="relative overflow-hidden border-b border-gogo-ink/7 bg-gogo-rail/55 px-6 py-7 sm:px-8">
            <div className="pointer-events-none absolute -right-10 -top-24 h-72 w-72 rounded-full bg-gogo-plum/10 blur-3xl" />
            <div className="relative flex items-start gap-4"><img src="/gogo-figure.png" alt="" className="hidden h-16 w-16 rounded-full object-cover sm:block" /><div><div className="text-[9.5px] font-bold uppercase tracking-[0.17em] text-gogo-orange">{active.category} · {active.minutes} min</div><h2 className="mt-2 font-serif text-[34px] font-semibold tracking-[-.5px] text-gogo-ink sm:text-[40px]">{active.title}</h2><p className="mt-2 max-w-2xl text-[13px] leading-6 text-gogo-ink-3">{active.description}</p></div></div>
          </div>

          <div className="p-5 sm:p-8">
            <div className="overflow-hidden rounded-[28px] border border-gogo-ink/8 bg-[#2f1c13] shadow-[0_24px_70px_rgba(31,20,14,.14)]">
              <div className="grid min-h-[420px] md:grid-cols-[43%_57%]">
                <div className="relative min-h-[330px] overflow-hidden bg-[#f7efe2] md:min-h-[420px]">
                  <video ref={presenterRef} src={MASTER_GOGO_PRESENTER} muted loop playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover object-left" />
                  <div className="absolute left-5 top-5 z-10 rounded-full border border-gogo-ink/8 bg-white/75 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.17em] text-gogo-orange backdrop-blur">MASTER GOGO</div>
                  <div className="absolute bottom-4 left-5 z-10 rounded-full border border-gogo-ink/8 bg-white/78 px-3 py-1.5 text-[9px] font-bold text-gogo-ink-2 backdrop-blur">{playing ? '● Gogo is explaining' : 'Ready when you are'}</div>
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
                      <span className="text-[10px] text-gogo-ink-4">Animated Gogo · mature voice · captions</span>
                    </div>
                    {active.audioSrc && <audio ref={audioRef} src={active.audioSrc} preload="metadata" onTimeUpdate={(e) => { const a=e.currentTarget; if (a.duration) setProgress(Math.min(a.currentTime/a.duration,1)) }} onPlay={() => { setPlaying(true); if (presenterRef.current) void presenterRef.current.play().catch(() => {}) }} onPause={() => { setPlaying(false); presenterRef.current?.pause() }} onEnded={() => void finishNarration()} />}
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
                {active.prompt && <button type="button" disabled={!watched.has(active.key)} onClick={() => void openPractice(active)} className={`mt-4 w-full rounded-full px-4 py-2.5 text-[11px] font-bold ${watched.has(active.key) ? 'bg-gogo-ink text-white' : 'cursor-not-allowed bg-gogo-ink/8 text-gogo-ink-4'}`}>{practiceOpen ? 'Practice open below ↓' : 'Practice here with Gogo'}</button>}
                {!active.prompt && watched.has(active.key) && active.key !== 'meet-gogo' && !completed.has(active.key) && <button type="button" onClick={() => void markDone(active.key, true)} className="mt-4 w-full rounded-full border border-gogo-ink/8 bg-gogo-surface px-4 py-2.5 text-[11px] font-bold text-gogo-ink-2">I did it · continue</button>}
                {autoVerified && <div className={`mt-4 rounded-[16px] border px-4 py-3 text-[11px] font-bold ${completed.has(active.key) ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-gogo-orange/20 bg-gogo-orange-tint text-gogo-ink-2'}`}>{completed.has(active.key) || verifyState==='done' ? '✓ Skill complete · moving to the next lesson…' : verifyState==='waiting'||verifyState==='checking' ? '● Waiting for Gogo to see your real action…' : 'Next lesson stays locked until you do it'}</div>}
                {completed.has(active.key) && !autoVerified && <div className="mt-4 rounded-[16px] border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-[11px] font-bold text-emerald-700">✓ Skill complete · moving to the next lesson…</div>}
              </div>
            </div>

            {practiceOpen && active.prompt && <div className="mt-5 overflow-hidden rounded-[26px] border border-gogo-orange/15 bg-gogo-surface shadow-[0_20px_55px_rgba(62,35,18,.06)]">
              <div className="flex items-center gap-3 border-b border-gogo-ink/7 bg-gogo-orange-tint/45 px-5 py-4 sm:px-6">
                <img src="/gogo-figure.png" alt="" className="h-11 w-11 rounded-full object-cover" />
                <div className="min-w-0 flex-1"><div className="text-[9px] font-bold uppercase tracking-[.16em] text-gogo-orange">Practice without leaving the lesson</div><div className="font-serif text-[20px] font-semibold text-gogo-ink">Talk to Gogo here</div></div>
                <button type="button" onClick={resetPractice} className="rounded-full border border-gogo-ink/8 bg-gogo-surface px-3 py-1.5 text-[11px] font-bold text-gogo-ink-3">Close</button>
              </div>
              <div className="max-h-[360px] overflow-y-auto px-5 py-5 sm:px-6">
                {practiceMessages.length === 0 && <div className="rounded-[18px] border border-gogo-ink/7 bg-gogo-cream/60 px-4 py-3 text-[12px] leading-5 text-gogo-ink-2">Try the suggested phrase below, or change it to something real for you.</div>}
                <div className="mt-3 flex flex-col gap-3">{practiceMessages.map((message,index)=><div key={index} className={`flex ${message.role==='user'?'justify-end':'justify-start'}`}><div className={`max-w-[86%] whitespace-pre-wrap rounded-[18px] px-4 py-3 text-[13px] leading-5 ${message.role==='user'?'rounded-br-[6px] bg-gogo-ink text-white':'rounded-bl-[6px] border border-gogo-ink/7 bg-gogo-cream text-gogo-ink'}`}>{linkify(message.content)}</div></div>)}{practiceSending && <div className="flex justify-start"><div className="rounded-[18px] rounded-bl-[6px] border border-gogo-ink/7 bg-gogo-cream px-4 py-3 text-[12px] text-gogo-ink-3">Gogo is working on it…</div></div>}<div ref={practiceEndRef} /></div>
              </div>
              <div className="border-t border-gogo-ink/7 bg-gogo-surface/88 px-5 py-4 sm:px-6">
                {practiceError && <div className="mb-3 rounded-xl bg-red-500/8 px-3 py-2 text-[11px] text-red-700">{practiceError}</div>}
                <form onSubmit={onPracticeSubmit} className="flex items-end gap-2 rounded-[18px] border border-gogo-ink/10 bg-gogo-cream/75 p-2">
                  <textarea value={practiceText} onChange={(e)=>setPracticeText(e.target.value)} rows={1} maxLength={2000} placeholder="Try it with Gogo…" className="max-h-28 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[13px] text-gogo-ink outline-none placeholder:text-gogo-ink-4" />
                  <button disabled={practiceSending || !practiceText.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-gogo-orange text-white disabled:opacity-40" aria-label="Send">↑</button>
                </form>
                {!autoVerified && practiceMessages.some((message)=>message.role==='assistant') && !completed.has(active.key) && <button type="button" onClick={() => void markDone(active.key, true)} className="mt-3 w-full rounded-full border border-gogo-ink/8 bg-gogo-surface px-4 py-2.5 text-[11px] font-bold text-gogo-ink-2">That worked · continue to {nextLesson?.title || 'finish'}</button>}
                {autoVerified && <div className="mt-3 text-center text-[10px] text-gogo-ink-4">Gogo checks the real reminder automatically. When it is found, this same page moves you forward.</div>}
              </div>
            </div>}
          </div>
        </div>}
      </main>
    </div>
  )
}
