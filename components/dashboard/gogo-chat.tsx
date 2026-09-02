'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
  createdAt?: string
  mediaUrl?: string | null
}

const DRINKS: Record<string, { emoji: string; label: string; line: string }> = {
  coffee: { emoji: '☕', label: 'Coffee', line: 'Coffee with Gogo' },
  tea: { emoji: '🍵', label: 'Tea', line: 'Tea with Gogo' },
  matcha: { emoji: '🍃', label: 'Matcha', line: 'Matcha with Gogo' },
  water: { emoji: '💧', label: 'Water', line: 'A clear moment with Gogo' },
  hot_chocolate: { emoji: '🍫', label: 'Hot chocolate', line: 'Hot chocolate with Gogo' },
  coconut_water: { emoji: '🥥', label: 'Coconut water', line: 'Coconut water with Gogo' },
}

const QUICK = [
  'What do I have today?',
  'Find a saved document',
  'Show my reminders',
  'Plan my day',
]

function linkify(text: string) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return <a key={index} href={part} target="_blank" rel="noreferrer" className="font-semibold text-gogo-orange underline underline-offset-2">{part}</a>
    }
    return <span key={index}>{part}</span>
  })
}

export function GogoChat({ initialDrink = 'coffee' }: { initialDrink?: string }) {
  const searchParams = useSearchParams()
  const initialPrompt = searchParams.get('prompt') || ''
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState(initialPrompt)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)
  const drink = DRINKS[initialDrink] || DRINKS.coffee

  useEffect(() => {
    let live = true
    fetch('/api/dashboard/chat', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('history')
        return res.json()
      })
      .then((data) => {
        if (!live) return
        setMessages(Array.isArray(data.messages) ? data.messages : [])
      })
      .catch(() => live && setError('I could not load the recent conversation. You can still start a new message.'))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending])

  const empty = useMemo(() => !loading && messages.length === 0, [loading, messages.length])

  async function submit(value?: string) {
    const next = String(value ?? text).trim()
    if (!next || sending) return
    setError('')
    setText('')
    setMessages((m) => [...m, { role: 'user', content: next }])
    setSending(true)
    try {
      const res = await fetch('/api/dashboard/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'chat')
      setMessages((m) => [...m, {
        role: 'assistant',
        content: String(data.text || 'Done.'),
        mediaUrl: data.mediaUrl || null,
      }])
    } catch (e: any) {
      setError(e?.message && e.message !== 'chat' ? e.message : 'Gogo had trouble with that. Try once more.')
    } finally {
      setSending(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void submit()
  }

  return (
    <div className="relative grid min-h-[calc(100vh-7rem)] overflow-hidden rounded-[32px] border border-gogo-ink/7 bg-gogo-surface/68 shadow-[0_28px_80px_rgba(62,35,18,.06)] backdrop-blur-xl lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-gogo-ink/7 bg-gogo-rail/54 p-6 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-20 top-20 h-64 w-64 rounded-full bg-gogo-orange/10 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold uppercase tracking-[0.17em] text-gogo-orange">Gogo room</div>
          <h2 className="mt-2 font-serif text-[28px] font-semibold text-gogo-ink">{drink.line}</h2>
          <p className="mt-2 text-[12px] leading-5 text-gogo-ink-3">Same memory. Same reminders. Same Gogo you use on WhatsApp.</p>
        </div>
        <div className="relative mt-10 flex flex-1 flex-col items-center justify-center">
          <div className="absolute h-44 w-44 rounded-full bg-gogo-plum/10 blur-3xl" />
          <img src="/gogo-float.gif" alt="Gogo" className="relative h-32 w-32 object-contain drop-shadow-[0_20px_28px_rgba(77,42,25,.13)]" />
          <div className="mt-3 rounded-full border border-gogo-ink/8 bg-gogo-surface/80 px-4 py-2 text-sm font-semibold text-gogo-ink-2 shadow-sm">
            <span className="mr-2">{drink.emoji}</span>{drink.label}
          </div>
        </div>
        <a href="/dashboard/personalize" className="relative rounded-[16px] border border-gogo-ink/8 bg-gogo-surface/72 px-4 py-3 text-center text-[12px] font-bold text-gogo-ink-2 transition hover:text-gogo-orange">Change your Gogo space →</a>
      </aside>

      <section className="flex min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-gogo-ink/7 px-5 py-4 lg:px-7">
          <img src="/gogo-figure.png" alt="" className="h-10 w-10 rounded-full object-cover lg:hidden" />
          <div className="min-w-0">
            <div className="font-serif text-[22px] font-semibold text-gogo-ink">Talk to Gogo</div>
            <div className="text-[11px] text-gogo-ink-3">Anything you do here stays in the same AskGogo world.</div>
          </div>
          <span className="ml-auto rounded-full border border-emerald-600/15 bg-emerald-500/8 px-3 py-1.5 text-[10px] font-bold text-emerald-700">Live memory</span>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {loading && <div className="mx-auto mt-20 max-w-md text-center text-sm text-gogo-ink-3">Bringing your conversation into this room…</div>}
          {empty && (
            <div className="mx-auto mt-10 max-w-xl text-center">
              <img src="/gogo-float.gif" alt="Gogo" className="mx-auto h-28 w-28 object-contain" />
              <h3 className="mt-4 font-serif text-[32px] font-semibold text-gogo-ink">What’s on your mind?</h3>
              <p className="mt-2 text-sm leading-6 text-gogo-ink-3">You can ask, remember, plan, retrieve, create reminders or work through the day — without opening your phone.</p>
            </div>
          )}

          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message, index) => (
              <div key={`${index}-${message.createdAt || ''}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] whitespace-pre-wrap rounded-[22px] px-4 py-3 text-[14px] leading-6 shadow-sm sm:max-w-[78%] ${message.role === 'user' ? 'rounded-br-[7px] bg-gogo-ink text-white' : 'rounded-bl-[7px] border border-gogo-ink/7 bg-gogo-surface text-gogo-ink'}`}>
                  {linkify(message.content)}
                  {message.mediaUrl && <img src={message.mediaUrl} alt="Gogo result" className="mt-3 max-h-80 w-auto rounded-2xl border border-gogo-ink/8" />}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-[20px] rounded-bl-[7px] border border-gogo-ink/7 bg-gogo-surface px-4 py-3 text-sm text-gogo-ink-3">Gogo is thinking<span className="animate-pulse">…</span></div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-gogo-ink/7 bg-gogo-surface/82 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            {error && <div className="mb-3 rounded-xl bg-red-500/8 px-3 py-2 text-[12px] text-red-700">{error}</div>}
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => void submit(q)} className="shrink-0 rounded-full border border-gogo-ink/8 bg-gogo-cream/70 px-3 py-2 text-[11px] font-semibold text-gogo-ink-2 transition hover:border-gogo-orange/25 hover:text-gogo-orange">{q}</button>)}
            </div>
            <form onSubmit={onSubmit} className="flex items-end gap-2 rounded-[22px] border border-gogo-ink/10 bg-gogo-cream/80 p-2 shadow-[0_14px_40px_rgba(62,35,18,.05)]">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void submit()
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="Tell Gogo anything…"
                className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] leading-6 text-gogo-ink outline-none placeholder:text-gogo-ink-4"
              />
              <button disabled={sending || !text.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-[16px] bg-gogo-orange text-lg font-bold text-white shadow-[0_10px_24px_rgba(238,122,48,.24)] transition disabled:opacity-40" aria-label="Send">↑</button>
            </form>
            <div className="mt-2 text-center text-[10px] text-gogo-ink-4">Sensitive identifiers still use AskGogo’s confirmation and masking rules.</div>
          </div>
        </div>
      </section>
    </div>
  )
}
