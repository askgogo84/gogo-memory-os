'use client'

const ASSET_BASE = 'https://qenhjcooyecmatwducpu.supabase.co/storage/v1/object/public/pitch-assets/askgogo-2026'
const DECK_URL = `${ASSET_BASE}/AskGogo-Pitch-Deck.html`
const PPTX_URL = `${ASSET_BASE}/AskGogo_Investor_Deck.pptx`

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
    <main style={{ position: 'fixed', inset: 0, background: '#F5F3EE', overflow: 'hidden' }}>
      <iframe
        src={DECK_URL}
        title="AskGogo Investor Deck"
        allow="fullscreen"
        style={{ width: '100%', height: '100%', border: 0, display: 'block', background: '#F5F3EE' }}
      />

      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 6,
          borderRadius: 999,
          background: 'rgba(44,26,19,.82)',
          border: '1px solid rgba(255,255,255,.14)',
          boxShadow: '0 10px 35px rgba(44,26,19,.22)',
          backdropFilter: 'blur(14px)',
        }}
      >
        <button onClick={share} style={buttonStyle}>Share</button>
        <button onClick={fullscreen} style={buttonStyle}>Full screen</button>
        <a href={PPTX_URL} download="AskGogo_Investor_Deck.pptx" style={{ ...buttonStyle, background: '#EF7A27', textDecoration: 'none' }}>
          Download PPT
        </a>
      </div>
    </main>
  )
}

const buttonStyle: React.CSSProperties = {
  border: 0,
  borderRadius: 999,
  background: 'rgba(255,255,255,.09)',
  color: '#fff',
  padding: '10px 14px',
  fontSize: 12,
  lineHeight: 1,
  fontWeight: 750,
  cursor: 'pointer',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  whiteSpace: 'nowrap',
}
