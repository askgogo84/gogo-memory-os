'use client'

import { useEffect, useMemo, useState } from 'react'

const ASSET_BASE = 'https://qenhjcooyecmatwducpu.supabase.co/storage/v1/object/public/pitch-assets/askgogo-2026'
const SLIDE_COUNT = 23
const PPTX_URL = `${ASSET_BASE}/AskGogo_Investor_Deck.pptx`

export default function PitchPage() {
  const slides = useMemo(() => Array.from({ length: SLIDE_COUNT }, (_, i) => `${ASSET_BASE}/slide-${String(i + 1).padStart(2, '0')}.jpg`), [])
  const [index, setIndex] = useState(0)
  const [thumbs, setThumbs] = useState(false)

  const prev = () => setIndex((v) => (v - 1 + SLIDE_COUNT) % SLIDE_COUNT)
  const next = () => setIndex((v) => (v + 1) % SLIDE_COUNT)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight' || e.key === ' ') next()
      if (e.key === 'Escape') setThumbs(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const share = async () => {
    const payload = { title: 'AskGogo Investor Deck', text: 'AskGogo — One Gogo. Everywhere.', url: window.location.href }
    try {
      if (navigator.share) await navigator.share(payload)
      else await navigator.clipboard.writeText(window.location.href)
    } catch {}
  }

  return (
    <main style={{ minHeight: '100vh', background: '#14100d', color: '#fff', fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 20, backdropFilter: 'blur(18px)', background: 'rgba(20,16,13,.82)', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ maxWidth: 1480, margin: '0 auto', minHeight: 72, padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700 }}>AskGogo</div>
            <div style={{ opacity: .58, fontSize: 12, marginTop: 2 }}>Investor deck · {SLIDE_COUNT} slides · Raising $500K</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button onClick={() => setThumbs(true)} style={secondary}>All slides</button>
            <button onClick={share} style={secondary}>Share</button>
            <a href={PPTX_URL} download="AskGogo_Investor_Deck.pptx" style={{ ...primary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Download PPT</a>
          </div>
        </div>
      </header>

      <section style={{ maxWidth: 1480, margin: '0 auto', padding: '28px 18px 50px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr) 56px', gap: 12, alignItems: 'center' }}>
          <button aria-label="Previous slide" onClick={prev} style={navBtn}>‹</button>
          <div style={{ position: 'relative', borderRadius: 18, overflow: 'hidden', background: '#000', boxShadow: '0 30px 90px rgba(0,0,0,.45)', aspectRatio: '16/9' }}>
            <img src={slides[index]} alt={`AskGogo investor deck slide ${index + 1}`} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
          <button aria-label="Next slide" onClick={next} style={navBtn}>›</button>
        </div>

        <div style={{ maxWidth: 1180, margin: '17px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13, opacity: .65 }}>{String(index + 1).padStart(2, '0')} / {SLIDE_COUNT}</div>
          <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,.1)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${((index + 1) / SLIDE_COUNT) * 100}%`, height: '100%', background: '#f7841b', borderRadius: 99, transition: 'width .25s ease' }} />
          </div>
          <div style={{ fontSize: 12, opacity: .45 }}>← → to navigate</div>
        </div>
      </section>

      {thumbs && (
        <div onClick={() => setThumbs(false)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(10,8,7,.94)', backdropFilter: 'blur(14px)', overflowY: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1500, margin: '0 auto', padding: '28px 18px 60px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div><div style={{ fontFamily: 'Georgia, serif', fontSize: 28 }}>All slides</div><div style={{ opacity: .55, fontSize: 12, marginTop: 3 }}>Tap any slide to present from there.</div></div>
              <button onClick={() => setThumbs(false)} style={secondary}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 14 }}>
              {slides.map((src, i) => (
                <button key={src} onClick={() => { setIndex(i); setThumbs(false) }} style={{ background: 'transparent', border: i === index ? '2px solid #f7841b' : '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: 0, overflow: 'hidden', cursor: 'pointer', textAlign: 'left' }}>
                  <img src={src} alt={`Slide ${i + 1}`} loading="lazy" style={{ display: 'block', width: '100%', aspectRatio: '16/9', objectFit: 'cover' }} />
                  <div style={{ padding: '8px 10px', color: '#fff', fontSize: 11, opacity: .72 }}>Slide {i + 1}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer style={{ borderTop: '1px solid rgba(255,255,255,.08)', padding: '24px 18px 34px', textAlign: 'center', color: 'rgba(255,255,255,.45)', fontSize: 12 }}>
        AskGogo · One Gogo. Everywhere. · Plan. Act. Watch.
      </footer>
    </main>
  )
}

const primary: React.CSSProperties = { border: 0, borderRadius: 999, background: '#f7841b', color: '#fff', padding: '11px 17px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }
const secondary: React.CSSProperties = { border: '1px solid rgba(255,255,255,.14)', borderRadius: 999, background: 'rgba(255,255,255,.05)', color: '#fff', padding: '10px 15px', fontSize: 13, fontWeight: 650, cursor: 'pointer' }
const navBtn: React.CSSProperties = { width: 50, height: 50, borderRadius: 999, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.055)', color: '#fff', fontSize: 34, lineHeight: 1, cursor: 'pointer', display: 'grid', placeItems: 'center' }
