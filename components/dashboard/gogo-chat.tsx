'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { GogoCharacter } from '@/components/gogo/gogo-character'

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

const CURRENT_CONTEXT_MESSAGES = 4

function linkify(text: string) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g)
  return parts.map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} target="_blank" rel="noreferrer" className="font-semibold text-gogo-orange underline underline-offset-2">{part}</a>
    : <span key={index}>{part}</span>)
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[88%] whitespace-pre-wrap rounded-[22px] px-4 py-3 text-[14px] leading-6 shadow-sm sm:max-w-[78%] ${message.role === 'user' ? 'rounded-br-[7px] bg-gogo-ink text-white' : 'rounded-bl-[7px] border border-gogo-ink/7 bg-gogo-surface text-gogo-ink'}`}>
        {linkify(message.content)}
        {message.mediaUrl && <img src={message.mediaUrl} alt="Gogo result" className="mt-3 max-h-72 w-auto rounded-2xl border border-gogo-ink/8" />}
      </div>
    </div>
  )
}

export function GogoChat({ initialDrink = 'coffee' }: { initialDrink?: string }) {
  const searchParams = useSearchParams()
  const initialPrompt = searchParams.get('prompt') || ''
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState(initialPrompt)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
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
    if (!historyOpen) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, sending, historyOpen])

  const empty = useMemo(() => !loading && messages.length === 0, [loading, messages.length])
  const currentMessages = useMemo(() => messages.slice(-CURRENT_CONTEXT_MESSAGES), [messages])
  const archivedMessages = useMemo(() => messages.slice(0, Math.max(0, messages.length - CURRENT_CONTEXT_MESSAGES)), [messages])
  const lastUserMessage = useMemo(() => [...messages].reverse().find((message) => message.role === 'user')?.content || '', [messages])

  async function submit(value?: string) {
    const next = String(value ?? text).trim()
    if (!next || sending) return
    setError('')
    setText('')
    setHistoryOpen(false)
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
    <div className="relative grid h-[calc(100dvh-7rem)] min-h-[640px] overflow-hidden rounded-[32px] border border-gogo-ink/7 bg-gogo-surface/68 shadow-[0_28px_80px_rgba(62,35,18,.06)] backdrop-blur-xl lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden border-r border-gogo-ink/7 bg-gogo-rail/54 p-6 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-20 top-20 h-64 w-64 rounded-full bg-gogo-orange/10 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold uppercase tracking-[0.17em] text-gogo-orange">Gogo room</div>
          <h2 className="mt-2 font-serif text-[28px] font-semibold text-gogo-ink">{drink.line}</h2>
          <p className="mt-2 text-[12px] leading-5 text-gogo-ink-3">One live context. Everything older stays nearby, not in your way.</p>
        </div>
        <div className="relative mt-8 flex flex-1 flex-col items-center justify-center">
          <div className="absolute h-44 w-44 rounded-full bg-gogo-plum/10 blur-3xl" />
          <div className="relative drop-shadow-[0_20px_28px_rgba(77,42,25,.13)]"><GogoCharacter state={sending ? 'thinking' : 'listening'} size={132} showStatus={sending} /></div>
          <div className="mt-3 rounded-full border border-gogo-ink/8 bg-gogo-surface/80 px-4 py-2 text-sm font-semibold text-gogo-ink-2 shadow-sm"><span className="mr-2">{drink.emoji}</span>{drink.label}</div>
        </div>
        <a href="/dashboard/agent" className="relative mb-2 rounded-[16px] border border-gogo-orange/15 bg-gogo-orange/8 px-4 py-3 text-center text-[12px] font-bold text-gogo-orange transition hover:bg-gogo-orange/12">See what Gogo is doing →</a>
        <a href="/dashboard/personalize" className="relative rounded-[16px] border border-gogo-ink/8 bg-gogo-surface/72 px-4 py-3 text-center text-[12px] font-bold text-gogo-ink-2 transition hover:text-gogo-orange">Change your Gogo space →</a>
      </aside>

      <section className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="z-20 flex shrink-0 items-center gap-3 border-b border-gogo-ink/7 bg-gogo-surface/86 px-5 py-4 backdrop-blur-xl lg:px-7">
          <div className="lg:hidden"><GogoCharacter state={sending ? 'thinking' : 'listening'} size={40} showStatus={sending} /></div>
          <div className="min-w-0">
            <div className="font-serif text-[22px] font-semibold text-gogo-ink">Talk to Gogo</div>
            <div className="truncate text-[11px] text-gogo-ink-3">{lastUserMessage ? `Current context · ${lastUserMessage}` : 'Your current context stays here.'}</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {archivedMessages.length > 0 && (
              <button type="button" onClick={() => setHistoryOpen((value) => !value)} className="rounded-full border border-gogo-ink/8 bg-gogo-cream/75 px-3 py-1.5 text-[10px] font-bold text-gogo-ink-2 transition hover:border-gogo-orange/25 hover:text-gogo-orange">
                {historyOpen ? 'Close history' : `History · ${archivedMessages.length}`}
              </button>
            )}
            <span className="rounded-full border border-emerald-600/15 bg-emerald-500/8 px-3 py-1.5 text-[10px] font-bold text-emerald-700">Live</span>
          </div>
        </header>

        {historyOpen && (
          <div className="absolute inset-x-0 top-[73px] z-30 max-h-[48%] overflow-hidden border-b border-gogo-ink/8 bg-gogo-cream/96 shadow-[0_24px_60px_rgba(62,35,18,.12)] backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-gogo-ink/6 px-5 py-3 lg:px-7">
              <div><div className="text-[10px] font-bold uppercase tracking-[0.15em] text-gogo-orange">Archive</div><div className="text-xs text-gogo-ink-3">Earlier context — open only when you need it.</div></div>
              <button type="button" onClick={() => setHistoryOpen(false)} className="rounded-full px-3 py-1.5 text-xs font-bold text-gogo-ink-3 hover:bg-gogo-ink/5 hover:text-gogo-ink">Done</button>
            </div>
            <div className="max-h-[360px] overflow-y-auto px-4 py-4 sm:px-6 lg:px-8">
              <div className="mx-auto flex max-w-3xl flex-col gap-3 opacity-85">
                {archivedMessages.map((message, index) => <MessageBubble key={`archive-${index}-${message.createdAt || ''}`} message={message} />)}
              </div>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          {loading && <div className="mx-auto mt-16 max-w-md text-center text-sm text-gogo-ink-3">Bringing your current context into this room…</div>}
          {empty && (
            <div className="mx-auto mt-8 max-w-xl text-center">
              <div className="mx-auto flex justify-center"><GogoCharacter state="calm" size={104} showStatus={false} hands /></div>
              <h3 className="mt-3 font-serif text-[30px] font-semibold text-gogo-ink">What’s on your mind?</h3>
              <p className="mt-2 text-sm leading-6 text-gogo-ink-3">Start here. Gogo keeps this window focused on what matters now.</p>
            </div>
          )}

          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {!loading && currentMessages.length > 0 && (
              <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gogo-ink-4"><span className="h-1.5 w-1.5 rounded-full bg-gogo-orange" />Current context</div>
            )}
            {currentMessages.map((message, index) => <MessageBubble key={`current-${index}-${message.createdAt || ''}`} message={message} />)}
            {sending && (
              <div className="flex justify-start"><div className="flex items-center gap-2 rounded-[20px] rounded-bl-[7px] border border-gogo-orange/15 bg-gogo-orange/6 px-4 py-3 text-sm font-medium text-gogo-ink-3"><GogoCharacter state="thinking" size={28} showStatus />Gogo is working<span className="animate-pulse">…</span></div></div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="z-20 shrink-0 border-t border-gogo-ink/7 bg-gogo-surface/92 px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            {error && <div className="mb-2 rounded-xl bg-red-500/8 px-3 py-2 text-[12px] text-red-700">{error}</div>}
            <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => void submit(q)} className="shrink-0 rounded-full border border-gogo-ink/8 bg-gogo-cream/70 px-3 py-1.5 text-[10px] font-semibold text-gogo-ink-2 transition hover:border-gogo-orange/25 hover:text-gogo-orange">{q}</button>)}
            </div>
            <form onSubmit={onSubmit} className="flex items-end gap-2 rounded-[22px] border border-gogo-ink/10 bg-gogo-cream/80 p-2 shadow-[0_14px_40px_rgba(62,35,18,.05)]">
              <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() } }} rows={1} maxLength={2000} placeholder="What next?" className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[14px] leading-6 text-gogo-ink outline-none placeholder:text-gogo-ink-4" />
              <button disabled={sending || !text.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-[16px] bg-gogo-orange text-lg font-bold text-white shadow-[0_10px_24px_rgba(238,122,48,.24)] transition disabled:opacity-40" aria-label="Send">↑</button>
            </form>
            <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[10px] text-gogo-ink-4"><span>Current context stays visible. Older messages move to History.</span><a href="/dashboard/agent" className="shrink-0 font-bold text-gogo-orange">Open Agent →</a></div>
          </div>
        </div>
      </section>
    </div>
  )
}
