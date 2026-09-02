'use client'

import { useState } from 'react'

const PERSONALITIES = [
  { key: 'calm_companion', title: 'Calm companion', emoji: '🌿', line: 'Warm, capable and easy to be around.', sample: 'You’re clear for now. I’ll keep the next thing ready when you need it.' },
  { key: 'sharp_professional', title: 'Sharp professional', emoji: '✦', line: 'Crisp, structured and efficient.', sample: 'Done. Next priority: the 4 PM meeting. Everything else can wait.' },
  { key: 'straight_talking_coach', title: 'Straight-talking coach', emoji: '⚡', line: 'Direct, practical and action-first.', sample: 'Two things matter today. Finish those first; ignore the rest for now.' },
  { key: 'quiet_minimalist', title: 'Quiet minimalist', emoji: '◌', line: 'Low chatter. Only what matters.', sample: 'Next: meeting at 4 PM. No other urgent items.' },
]

const DRINKS = [
  { key: 'coffee', title: 'Coffee', emoji: '☕' },
  { key: 'tea', title: 'Tea', emoji: '🍵' },
  { key: 'matcha', title: 'Matcha', emoji: '🍃' },
  { key: 'water', title: 'Water', emoji: '💧' },
  { key: 'hot_chocolate', title: 'Hot chocolate', emoji: '🍫' },
  { key: 'coconut_water', title: 'Coconut water', emoji: '🥥' },
]

export function PersonalizeGogo({ initialPersonality, initialDrink }: { initialPersonality: string; initialDrink: string }) {
  const [personality, setPersonality] = useState(initialPersonality || 'calm_companion')
  const [drink, setDrink] = useState(initialDrink || 'coffee')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = PERSONALITIES.find((p) => p.key === personality) || PERSONALITIES[0]
  const selectedDrink = DRINKS.find((d) => d.key === drink) || DRINKS[0]

  async function save() {
    setSaving(true)
    setSaved('')
    try {
      const res = await fetch('/api/dashboard/experience', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personality, comfortDrink: drink }),
      })
      if (!res.ok) throw new Error('save')
      setSaved('Saved. Gogo will use this style across your conversations.')
    } catch {
      setSaved('Could not save that just now. Try once more.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <section className="rounded-[28px] border border-gogo-ink/7 bg-gogo-surface/72 p-5 shadow-[0_18px_55px_rgba(62,35,18,.045)] sm:p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.17em] text-gogo-orange">Personality</div>
          <h2 className="mt-2 font-serif text-[30px] font-semibold text-gogo-ink">How should Gogo talk to you?</h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-gogo-ink-3">This changes tone, not truth. Reminders, privacy rules, safety and actions stay exactly the same.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {PERSONALITIES.map((p) => {
              const active = personality === p.key
              return (
                <button key={p.key} type="button" onClick={() => setPersonality(p.key)} className={`rounded-[22px] border p-4 text-left transition ${active ? 'border-gogo-orange/35 bg-gogo-orange-tint shadow-[0_12px_32px_rgba(238,122,48,.08)]' : 'border-gogo-ink/8 bg-gogo-cream/45 hover:border-gogo-orange/20'}`}>
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-gogo-surface text-xl shadow-sm">{p.emoji}</div>
                    <div>
                      <div className="font-serif text-[20px] font-semibold text-gogo-ink">{p.title}</div>
                      <div className="mt-1 text-[12px] leading-5 text-gogo-ink-3">{p.line}</div>
                    </div>
                  </div>
                  <div className="mt-4 rounded-[16px] border border-gogo-ink/6 bg-gogo-surface/62 px-3 py-2.5 text-[11.5px] leading-5 text-gogo-ink-2">“{p.sample}”</div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="rounded-[28px] border border-gogo-ink/7 bg-gogo-surface/72 p-5 shadow-[0_18px_55px_rgba(62,35,18,.045)] sm:p-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.17em] text-gogo-plum">Your ritual</div>
          <h2 className="mt-2 font-serif text-[28px] font-semibold text-gogo-ink">What’s beside you in Gogo’s room?</h2>
          <p className="mt-2 text-[13px] leading-6 text-gogo-ink-3">Purely visual. A small touch that makes the space feel like yours.</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DRINKS.map((d) => {
              const active = drink === d.key
              return <button key={d.key} type="button" onClick={() => setDrink(d.key)} className={`rounded-[20px] border px-3 py-5 text-center transition ${active ? 'border-gogo-plum/30 bg-gogo-plum/8 shadow-sm' : 'border-gogo-ink/8 bg-gogo-cream/45 hover:border-gogo-plum/20'}`}><div className="text-3xl">{d.emoji}</div><div className="mt-2 text-[12px] font-bold text-gogo-ink-2">{d.title}</div></button>
            })}
          </div>
        </section>
      </div>

      <aside className="relative overflow-hidden rounded-[30px] border border-gogo-ink/7 bg-gogo-rail/72 p-6 shadow-[0_24px_70px_rgba(62,35,18,.055)] xl:sticky xl:top-8 xl:h-fit">
        <div className="pointer-events-none absolute -right-20 top-12 h-64 w-64 rounded-full bg-gogo-orange/12 blur-3xl" />
        <div className="pointer-events-none absolute -left-20 bottom-8 h-64 w-64 rounded-full bg-gogo-plum/10 blur-3xl" />
        <div className="relative text-center">
          <div className="text-[9.5px] font-bold uppercase tracking-[0.16em] text-gogo-ink-3">Your Gogo</div>
          <img src="/gogo-float.gif" alt="Gogo" className="mx-auto mt-5 h-40 w-40 object-contain" />
          <div className="mt-1 text-4xl">{selectedDrink.emoji}</div>
          <h3 className="mt-4 font-serif text-[27px] font-semibold text-gogo-ink">{selected.title}</h3>
          <p className="mt-2 text-[12px] leading-5 text-gogo-ink-3">{selected.line}</p>
          <a href="/dashboard/chat" className="mt-5 inline-flex rounded-full border border-gogo-ink/8 bg-gogo-surface/78 px-4 py-2 text-[11px] font-bold text-gogo-ink-2 transition hover:text-gogo-orange">Visit Gogo’s room →</a>
        </div>
        <button type="button" onClick={save} disabled={saving} className="relative mt-6 w-full rounded-[17px] bg-gogo-ink px-4 py-3 text-[12px] font-bold text-white transition hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : 'Save my Gogo'}</button>
        {saved && <div className="relative mt-3 text-center text-[11px] leading-5 text-gogo-ink-3">{saved}</div>}
      </aside>
    </div>
  )
}
