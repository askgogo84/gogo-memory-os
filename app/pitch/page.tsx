'use client'

const DECK_URL = '/pitch/content'

export default function PitchPage() {
  return (
    <main className="pitch-shell">
      <style>{`
        html,body{margin:0;padding:0;background:#F5F3EE;overflow:hidden}
        .pitch-shell{position:fixed;inset:0;background:#F5F3EE;overflow:hidden}
        .pitch-frame{position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#F5F3EE}
      `}</style>
      <iframe
        src={DECK_URL}
        title="AskGogo Pitch Deck"
        allow="fullscreen"
        className="pitch-frame"
      />
    </main>
  )
}
