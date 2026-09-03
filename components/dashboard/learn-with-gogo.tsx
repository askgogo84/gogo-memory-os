'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import type { GogoLesson } from '@/lib/dashboard/lessons'

export function LearnWithGogo({ lessons, completedKeys }: { lessons: GogoLesson[]; completedKeys: string[] }) {
  const [completed, setCompleted] = useState(new Set(completedKeys))
  const [activeKey, setActiveKey] = useState(lessons[0]?.key || '')
  const [videoSpeed, setVideoSpeed] = useState(0.75)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const active = lessons.find((l) => l.key === activeKey) || lessons[0]
  const doneCount = completed.size
  const pct = lessons.length ? Math.round((doneCount / lessons.length) * 100) : 0

  const categories = useMemo(() => Array.from(new Set(lessons.map((l) => l.category))), [lessons])

  async function markDone(key: string) {
    setCompleted((old) => new Set([...old, key]))
    await fetch('/api/dashboard/learning-progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonKey: key, completed: true }),
    }).catch(() => null)
  }

  function changeVideoSpeed(speed: number) {
    setVideoSpeed(speed)
    if (videoRef.current) videoRef.current.playbackRate = speed
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="rounded-[28px] border border-gogo-ink/7 bg-gogo-surface/72 p-5 shadow-[0_18px_55px_rgba(62,35,18,.045)] xl:sticky xl:top-8 xl:h-[calc(100vh-6rem)] xl:overflow-y-auto">
        <div className="flex items-center gap-3">
          <img src="/gogo-float.gif" alt="Gogo" className="h-14 w-14 object-contain" />
          <div>
            <div className="text-[9px] font-bold uppercase tracking-[0.17em] text-gogo-orange">Master Gogo</div>
            <div className="font-serif text-[23px] font-semibold text-gogo-ink">Learn by doing</div>
          </div>
        </div>
        <div className="mt-5 rounded-[18px] border border-gogo-ink/7 bg-gogo-cream/55 p-4">
          <div className="flex items-center justify-between text-[11px] font-bold text-gogo-ink-2"><span>Your progress</span><span>{doneCount}/{lessons.length}</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gogo-ink/7"><div className="h-full rounded-full bg-gogo-orange transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="mt-2 text-[10px] text-gogo-ink-4">{pct}% explored</div>
        </div>

        <div className="mt-5 space-y-5">
          {categories.map((category) => (
            <div key={category}>
              <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.15em] text-gogo-ink-4">{category}</div>
              <div className="space-y-1.5">
                {lessons.filter((l) => l.category === category).map((lesson) => {
                  const selected = lesson.key === active?.key
                  const done = completed.has(lesson.key)
                  return (
                    <button key={lesson.key} type="button" onClick={() => setActiveKey(lesson.key)} className={`flex w-full items-center gap-3 rounded-[15px] px-3 py-2.5 text-left transition ${selected ? 'bg-gogo-orange-tint text-gogo-ink' : 'hover:bg-gogo-cream/60 text-gogo-ink-2'}`}>
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] ${done ? 'bg-emerald-500/12 text-emerald-700' : 'bg-gogo-ink/5 text-gogo-ink-4'}`}>{done ? '✓' : lesson.videoSrc ? '▶' : '→'}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-bold">{lesson.title}</span><span className="block text-[9.5px] text-gogo-ink-4">{lesson.minutes} min</span></span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="min-w-0 overflow-hidden rounded-[30px] border border-gogo-ink/7 bg-gogo-surface/72 shadow-[0_24px_70px_rgba(62,35,18,.055)]">
        {active ? (
          <div>
            <div className="relative overflow-hidden border-b border-gogo-ink/7 bg-gogo-rail/55 px-6 py-7 sm:px-8">
              <div className="pointer-events-none absolute -right-10 -top-24 h-72 w-72 rounded-full bg-gogo-plum/10 blur-3xl" />
              <div className="relative flex items-start gap-4">
                <img src="/gogo-figure.png" alt="" className="hidden h-16 w-16 rounded-full object-cover sm:block" />
                <div>
                  <div className="text-[9.5px] font-bold uppercase tracking-[0.17em] text-gogo-orange">{active.category} · {active.minutes} min</div>
                  <h2 className="mt-2 font-serif text-[34px] font-semibold tracking-[-.5px] text-gogo-ink sm:text-[40px]">{active.title}</h2>
                  <p className="mt-2 max-w-2xl text-[13px] leading-6 text-gogo-ink-3">{active.description}</p>
                </div>
              </div>
            </div>

            <div className="p-5 sm:p-8">
              {active.videoSrc ? (
                <div>
                  <div className="overflow-hidden rounded-[24px] border border-gogo-ink/8 bg-black shadow-[0_22px_60px_rgba(31,20,14,.14)]">
                    <video
                      ref={videoRef}
                      src={active.videoSrc}
                      controls
                      playsInline
                      className="aspect-video w-full object-contain"
                      onLoadedMetadata={(e) => { e.currentTarget.playbackRate = videoSpeed }}
                      onEnded={() => void markDone(active.key)}
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] text-gogo-ink-4">Finish the video and it will be marked complete.</div>
                      <div className="mt-2 flex items-center gap-2 text-[10.5px] text-gogo-ink-4">
                        <span className="font-bold uppercase tracking-[0.08em]">Speed</span>
                        {[0.75, 1].map((speed) => (
                          <button
                            key={speed}
                            type="button"
                            onClick={() => changeVideoSpeed(speed)}
                            className={`rounded-full border px-3 py-1.5 font-bold transition ${videoSpeed === speed ? 'border-gogo-orange/25 bg-gogo-orange-tint text-gogo-orange-deep' : 'border-gogo-ink/8 bg-gogo-cream text-gogo-ink-3'}`}
                          >
                            {speed}×
                          </button>
                        ))}
                      </div>
                    </div>
                    <button type="button" onClick={() => void markDone(active.key)} className="rounded-full border border-gogo-ink/8 bg-gogo-cream px-4 py-2 text-[11px] font-bold text-gogo-ink-2">Mark watched</button>
                  </div>
                </div>
              ) : (
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div>
                    <div className="rounded-[24px] border border-gogo-ink/7 bg-gogo-cream/55 p-5 sm:p-6">
                      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-plum">Guided walkthrough</div>
                      <ol className="mt-4 space-y-4">
                        {(active.steps || []).map((step, index) => (
                          <li key={step} className="flex gap-3 text-[13px] leading-6 text-gogo-ink-2">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gogo-surface text-[11px] font-bold text-gogo-orange shadow-sm">{index + 1}</span>
                            <span>{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <div className="mt-4 rounded-[20px] border border-gogo-orange/15 bg-gogo-orange-tint/65 px-4 py-3 text-[11.5px] leading-5 text-gogo-ink-2">Short original videos can drop into this exact lesson slot as they are produced. The guided version is usable now.</div>
                  </div>
                  <div className="rounded-[24px] border border-gogo-ink/7 bg-gogo-rail/55 p-5 text-center">
                    <img src="/gogo-float.gif" alt="Gogo" className="mx-auto h-28 w-28 object-contain" />
                    <div className="mt-2 font-serif text-[22px] font-semibold text-gogo-ink">Try it now</div>
                    {active.prompt ? <div className="mt-3 rounded-[15px] border border-gogo-ink/7 bg-gogo-surface px-3 py-3 text-left text-[11px] leading-5 text-gogo-ink-2">“{active.prompt}”</div> : <p className="mt-2 text-[11px] leading-5 text-gogo-ink-3">Use the steps on the left, then mark the lesson complete.</p>}
                    {active.prompt && <Link href={`/dashboard/chat?prompt=${encodeURIComponent(active.prompt)}`} className="mt-4 inline-flex rounded-full bg-gogo-ink px-4 py-2.5 text-[11px] font-bold text-white">Open in Gogo room</Link>}
                    <button type="button" onClick={() => void markDone(active.key)} className={`mt-3 w-full rounded-full border px-4 py-2.5 text-[11px] font-bold transition ${completed.has(active.key) ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700' : 'border-gogo-ink/8 bg-gogo-surface text-gogo-ink-2'}`}>{completed.has(active.key) ? '✓ Completed' : 'Mark complete'}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}