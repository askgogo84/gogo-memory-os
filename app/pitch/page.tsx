'use client'

import { useRef } from 'react'

const DECK_URL = '/pitch/content'
const PPTX_URL = 'https://qenhjcooyecmatwducpu.supabase.co/storage/v1/object/public/pitch-assets/askgogo-2026/AskGogo_Investor_Deck.pptx'

export default function PitchPage() {
  const frameRef = useRef<HTMLIFrameElement>(null)

  function navigate(direction: 'next' | 'prev') {
    frameRef.current?.contentWindow?.postMessage(
      { type: direction === 'next' ? 'askgogo:pitch-next' : 'askgogo:pitch-prev' },
      window.location.origin,
    )
  }

  async function share() {
    const payload = {
      title: 'AskGogo Investor Deck',
      text: 'AskGogo — One Gogo. Everywhere. Plan. Act. Watch.',
      url: window.location.href,
    }
    try {
      if (navigator.share) await navigator.share(payload)
      else await navigator.clipboard.writeText(window.location.href)
    } catch {}
  }

  async function fullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
      else await document.exitFullscreen()
    } catch {}
  }

  return (
    <main className="pitch-shell">
      <style>{`
        .pitch-shell{position:fixed;inset:0;background:#F5F3EE;overflow:hidden;touch-action:none}
        .pitch-frame{width:100%;height:100%;border:0;display:block;background:#F5F3EE}
        .pitch-toolbar{position:fixed;top:16px;right:16px;z-index:50;display:flex;align-items:center;gap:8px;padding:6px;border-radius:999px;background:rgba(44,26,19,.82);border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 35px rgba(44,26,19,.22);backdrop-filter:blur(14px)}
        .pitch-btn{border:0;border-radius:999px;background:rgba(255,255,255,.09);color:#fff;padding:10px 14px;font-size:12px;line-height:1;font-weight:750;cursor:pointer;font-family:Inter,ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
        .pitch-download{background:#EF7A27;text-decoration:none}
        .pitch-nav{position:fixed;top:50%;transform:translateY(-50%);z-index:60;width:54px;height:72px;border:1px solid rgba(44,26,19,.16);border-radius:18px;background:rgba(245,243,238,.9);color:#2C1A13;box-shadow:0 10px 34px rgba(44,26,19,.2);backdrop-filter:blur(12px);display:grid;place-items:center;font-size:36px;line-height:1;cursor:pointer;transition:transform .18s ease,background .18s ease}
        .pitch-nav:hover{background:#fff}
        .pitch-nav:active{transform:translateY(-50%) scale(.94)}
        .pitch-prev{left:14px}.pitch-next{right:14px}
        .pitch-hint{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:55;padding:7px 12px;border-radius:999px;background:rgba(44,26,19,.72);color:#fff;font:600 11px/1 Inter,ui-sans-serif,system-ui,sans-serif;letter-spacing:.01em;pointer-events:none;backdrop-filter:blur(10px)}
        @media (max-width: 760px){
          .pitch-toolbar{top:auto;bottom:max(14px,env(safe-area-inset-bottom));right:50%;transform:translateX(50%);gap:5px;padding:5px;max-width:calc(100vw - 24px)}
          .pitch-btn{padding:10px 11px;font-size:11px}
          .pitch-toolbar .pitch-fullscreen{display:none}
          .pitch-nav{width:48px;height:64px;border-radius:16px;font-size:32px;background:rgba(245,243,238,.94)}
          .pitch-prev{left:8px}.pitch-next{right:8px}
          .pitch-hint{bottom:72px;font-size:10px;white-space:nowrap}
        }
      `}</style>

      <iframe
        ref={frameRef}
        src={DECK_URL}
        title="AskGogo Investor Deck"
        allow="fullscreen"
        className="pitch-frame"
      />

      <button className="pitch-nav pitch-prev" aria-label="Previous slide" onClick={() => navigate('prev')}>‹</button>
      <button className="pitch-nav pitch-next" aria-label="Next slide" onClick={() => navigate('next')}>›</button>

      <div className="pitch-hint">Scroll or swipe to move through the deck</div>

      <div className="pitch-toolbar">
        <button onClick={share} className="pitch-btn">Share</button>
        <button onClick={fullscreen} className="pitch-btn pitch-fullscreen">Full screen</button>
        <a href={PPTX_URL} download="AskGogo_Investor_Deck.pptx" className="pitch-btn pitch-download">Download PPT</a>
      </div>
    </main>
  )
}
