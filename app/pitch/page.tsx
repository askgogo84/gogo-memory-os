'use client'

const DECK_URL = '/pitch/content'
const PPTX_URL = '/pitch/download'

export default function PitchPage() {
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
        .pitch-shell{position:fixed;inset:0;background:#F5F3EE;overflow:hidden}
        .pitch-frame{width:100%;height:100%;border:0;display:block;background:#F5F3EE}
        .pitch-toolbar{position:fixed;top:14px;right:14px;z-index:50;display:flex;align-items:center;gap:6px;padding:5px;border-radius:999px;background:rgba(44,26,19,.80);border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 28px rgba(44,26,19,.18);backdrop-filter:blur(14px)}
        .pitch-btn{border:0;border-radius:999px;background:rgba(255,255,255,.09);color:#fff;padding:9px 12px;font-size:11px;line-height:1;font-weight:750;cursor:pointer;font-family:Inter,ui-sans-serif,system-ui,sans-serif;white-space:nowrap}
        .pitch-download{background:#EF7A27;text-decoration:none}
        @media (max-width:760px){
          .pitch-toolbar{top:8px;right:8px;gap:4px;padding:4px;background:rgba(44,26,19,.74)}
          .pitch-btn{padding:8px 9px;font-size:10px}
          .pitch-toolbar .pitch-fullscreen{display:none}
        }
      `}</style>

      <iframe
        src={DECK_URL}
        title="AskGogo Investor Deck v3"
        allow="fullscreen"
        className="pitch-frame"
      />

      <div className="pitch-toolbar">
        <button onClick={share} className="pitch-btn">Share</button>
        <button onClick={fullscreen} className="pitch-btn pitch-fullscreen">Full screen</button>
        <a href={PPTX_URL} download="AskGogo-Pitch-Deck-v3.pptx" className="pitch-btn pitch-download">Download PPT</a>
      </div>
    </main>
  )
}
