'use client'

// The Gogo crew (approved mock "Gogo Crew Dashboard", 12 Nov 2026): Gogo and five friends built on Gogo's body,
// with eyes that follow the pointer. Motion follows the Oobi reference findings: the body stays still and only the
// eyes move; a dead zone of 2.2% of the viewport width, full gaze at 16.2%; a critically damped approach
// (about 150 ms in, 200 ms back); a blink every 5.5–9 s (eyes ease to the middle over 180 ms, then a 750 ms blink).
// Touch never drives the gaze. prefers-reduced-motion: no tracking and no blink.
//
// One pointer listener and one animation loop serve every crewmate on the page.
import { useEffect, useId, useRef, useState } from 'react'
import { CREW_LOOKS, type CrewId, type CrewMood } from '@/lib/gogo/crew'

type Sub = { el: HTMLElement | null; cur: { x: number; y: number }; target: { x: number; y: number }; blinkAt: number; blinkStart: number; set: (v: { x: number; y: number; blink: number }) => void; last: { x: number; y: number; blink: number } }
const subs = new Set<Sub>()
let raf = 0, lastTick = 0, listening = false, pointer: { x: number; y: number } | null = null

function onPointer(e: PointerEvent) { if (e.pointerType !== 'touch') pointer = { x: e.clientX, y: e.clientY } }
function aim(s: Sub) {
  if (!pointer || !s.el) { s.target = { x: 0, y: 0 }; return }
  const r = s.el.getBoundingClientRect(), vw = window.innerWidth || 1440
  const dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2)
  const d = Math.hypot(dx, dy) || 1, dead = 0.022 * vw, full = 0.162 * vw
  const k = d <= dead ? 0 : Math.min(1, (d - dead) / (full - dead))
  s.target = { x: (dx / d) * k, y: (dy / d) * k }
}
function tick(now: number) {
  const dt = lastTick ? Math.min(64, now - lastTick) : 16
  lastTick = now
  if (!document.hidden) for (const s of subs) {
    aim(s)
    const blinking = s.blinkStart >= 0
    const tx = blinking ? 0 : s.target.x, ty = blinking ? 0 : s.target.y
    const out = Math.abs(tx) + Math.abs(ty) > Math.abs(s.cur.x) + Math.abs(s.cur.y)
    const a = 1 - Math.exp(-dt / (out ? 50 : 66))
    s.cur.x += (tx - s.cur.x) * a; s.cur.y += (ty - s.cur.y) * a
    let blink = 0
    if (!blinking && now >= s.blinkAt) s.blinkStart = now
    if (s.blinkStart >= 0) {
      const p = (now - s.blinkStart - 180) / 750
      if (p >= 1) { s.blinkStart = -1; s.blinkAt = now + 5500 + Math.random() * 3500 } else if (p > 0) blink = Math.sin(Math.PI * p)
    }
    const v = { x: s.cur.x, y: s.cur.y, blink }
    if (Math.abs(v.x - s.last.x) > 0.004 || Math.abs(v.y - s.last.y) > 0.004 || v.blink !== s.last.blink) { s.last = v; s.set(v) }
  }
  raf = subs.size ? requestAnimationFrame(tick) : 0
}
function join(s: Sub) {
  subs.add(s)
  if (!listening) { window.addEventListener('pointermove', onPointer, { passive: true }); listening = true }
  if (!raf) { lastTick = 0; raf = requestAnimationFrame(tick) }
}
function leave(s: Sub) {
  subs.delete(s)
  if (!subs.size) { if (raf) cancelAnimationFrame(raf); raf = 0; if (listening) { window.removeEventListener('pointermove', onPointer); listening = false } }
}

function useGaze(track: boolean) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [gaze, setGaze] = useState({ x: 0, y: 0, blink: 0 })
  useEffect(() => {
    if (!track || typeof window === 'undefined') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const s: Sub = { el: ref.current, cur: { x: 0, y: 0 }, target: { x: 0, y: 0 }, blinkAt: performance.now() + 1500 + Math.random() * 6000, blinkStart: -1, set: setGaze, last: { x: 0, y: 0, blink: 0 } }
    join(s)
    // Leaving (mood change, unmount) resets the eyes, so a later subscriber never starts mid-blink or off-centre.
    return () => { leave(s); setGaze({ x: 0, y: 0, blink: 0 }) }
  }, [track])
  return { ref, gaze }
}

const MOOD: Record<CrewMood, { open: number; happy: number; closed: number; brows: number; smile: number; grin: number; oh: number; dots: number; zz: number; check: number; lookUp: boolean }> = {
  idle:     { open: 1, happy: 0, closed: 0, brows: 0, smile: 1, grin: 0, oh: 0, dots: 0, zz: 0, check: 0, lookUp: false },
  thinking: { open: 1, happy: 0, closed: 0, brows: 0, smile: 0, grin: 0, oh: 0, dots: 1, zz: 0, check: 0, lookUp: true },
  done:     { open: 0, happy: 1, closed: 0, brows: 0, smile: 0, grin: 1, oh: 0, dots: 0, zz: 0, check: 1, lookUp: false },
  needs:    { open: 1, happy: 0, closed: 0, brows: 1, smile: 0, grin: 0, oh: 1, dots: 0, zz: 0, check: 0, lookUp: false },
  sleep:    { open: 0, happy: 0, closed: 1, brows: 0, smile: 1, grin: 0, oh: 0, dots: 0, zz: 1, check: 0, lookUp: false },
}

export function Crewmate({ kind = 'gogo', mood = 'idle', size = 120, label, className = '', animate = true }: { kind?: CrewId; mood?: CrewMood; size?: number; label?: string; className?: string; animate?: boolean }) {
  const c = CREW_LOOKS[kind] || CREW_LOOKS.gogo
  const m = MOOD[mood] || MOOD.idle
  const uid = useId().replace(/:/g, '')
  const { ref, gaze } = useGaze(m.open === 1 && animate)
  const gx = gaze.x, gy = m.lookUp ? -0.9 : gaze.y
  const rest = mood === 'needs' ? 2.5 : 5.2
  const lidH = rest + (19 - rest) * gaze.blink
  const fur = size >= 56
  const id = (k: string) => `${k}-${uid}`
  const body = 'M60 34 C84 34 100 52 101 76 C102 100 84 113 60 113 C36 113 18 100 19 76 C20 52 36 34 60 34Z'
  const eye = (cx: number, dx: number) => <g clipPath={`url(#${id(cx < 60 ? 'eyeL' : 'eyeR')})`}>
    <g style={{ transform: `translate(${(gx * dx).toFixed(2)}px, ${(gy * 3.2).toFixed(2)}px)` }}><circle cx={cx} cy="65" r="4.9" fill="#2C1A13"/><circle cx={cx + 1.8} cy="63" r="1.6" fill="#FFFFFF"/></g>
    <rect x={cx - 10} y="53" width="20" height={lidH.toFixed(2)} fill={c.b2}/>
    <rect x={cx - 10} y={(53 + lidH - 0.8).toFixed(2)} width="20" height="1.6" fill="#2C1A13" fillOpacity=".55"/>
  </g>
  return <span ref={ref} className={`inline-block shrink-0 leading-none ${className}`} style={{ width: size, height: size }} role={label === '' ? undefined : 'img'} aria-hidden={label === '' ? true : undefined} aria-label={label === '' ? undefined : label ?? `${c.name}, ${mood}`}>
    <svg viewBox="0 0 120 130" width="100%" height="100%" style={{ overflow: 'visible', display: 'block' }} aria-hidden="true">
      <defs>
        <radialGradient id={id('body')} cx="38%" cy="28%" r="85%"><stop offset="0" stopColor={c.b1}/><stop offset=".55" stopColor={c.b2}/><stop offset="1" stopColor={c.b3}/></radialGradient>
        <radialGradient id={id('shade')} cx="50%" cy="100%" r="70%"><stop offset="0" stopColor="#3E2312" stopOpacity=".16"/><stop offset="1" stopColor="#3E2312" stopOpacity="0"/></radialGradient>
        <radialGradient id={id('core')} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor={c.core1} stopOpacity=".95"/><stop offset=".55" stopColor={c.core} stopOpacity=".55"/><stop offset="1" stopColor={c.core} stopOpacity="0"/></radialGradient>
        <radialGradient id={id('hair')} cx="40%" cy="30%" r="80%"><stop offset="0" stopColor={c.h1}/><stop offset="1" stopColor={c.h2}/></radialGradient>
        <radialGradient id={id('white')} cx="42%" cy="38%" r="70%"><stop offset="0" stopColor="#FFFFFF"/><stop offset=".7" stopColor="#F4EEE6"/><stop offset="1" stopColor="#D9CDBF"/></radialGradient>
        <radialGradient id={id('floor')} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#3E2312" stopOpacity=".22"/><stop offset="1" stopColor="#3E2312" stopOpacity="0"/></radialGradient>
        {fur && <filter id={id('fur')} x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} seed={7} result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale={3.2} xChannelSelector="R" yChannelSelector="G" result="d"/><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves={1} seed={3} result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0.24  0 0 0 0 0.14  0 0 0 0 0.07  0 0 0 0.18 0" result="grain"/><feComposite in="grain" in2="d" operator="in" result="g2"/><feMerge><feMergeNode in="d"/><feMergeNode in="g2"/></feMerge></filter>}
        <clipPath id={id('eyeL')}><ellipse cx="46" cy="64" rx="9" ry="9.6"/></clipPath>
        <clipPath id={id('eyeR')}><ellipse cx="74" cy="64" rx="9" ry="9.6"/></clipPath>
      </defs>
      <ellipse cx="60" cy="121" rx="30" ry="6" fill={`url(#${id('floor')})`}/>
      <g style={{ transformBox: 'fill-box', transformOrigin: '50% 95%', animation: mood === 'sleep' ? 'gogoBreath 6s ease-in-out infinite' : 'none' }}>
        <g filter={fur ? `url(#${id('fur')})` : undefined}>
          {c.hair === 'ears' && <g><path d="M30 46 L24 18 L50 34 Z" fill={`url(#${id('body')})`} stroke="rgba(62,35,18,.10)" strokeWidth="1.4"/><path d="M90 46 L96 18 L70 34 Z" fill={`url(#${id('body')})`} stroke="rgba(62,35,18,.10)" strokeWidth="1.4"/><path d="M33 39 L29 24 L43 33 Z" fill={c.core} fillOpacity=".35"/><path d="M87 39 L91 24 L77 33 Z" fill={c.core} fillOpacity=".35"/></g>}
          {c.hair === 'curls' && <g fill={`url(#${id('hair')})`}><circle cx="24" cy="54" r="9"/><circle cx="28" cy="41" r="10.5"/><circle cx="38" cy="31" r="11"/><circle cx="51" cy="24" r="11.5"/><circle cx="66" cy="24" r="11.5"/><circle cx="80" cy="30" r="11"/><circle cx="91" cy="41" r="10.5"/><circle cx="96" cy="54" r="9"/><ellipse cx="60" cy="40" rx="30" ry="12"/></g>}
          {c.hair === 'bun' && <g fill={`url(#${id('hair')})`}><circle cx="60" cy="14" r="12"/><path d="M24 56 C24 30 44 22 60 22 C76 22 96 30 96 56 C88 44 76 38 60 38 C44 38 32 44 24 56Z"/><path d="M54 6 q6 -4 12 0" stroke={c.core} strokeWidth="3" fill="none" strokeLinecap="round"/></g>}
          {c.hair === 'puffs' && <g fill={`url(#${id('hair')})`}><circle cx="22" cy="40" r="13"/><circle cx="98" cy="40" r="13"/><path d="M26 56 C26 32 44 24 60 24 C76 24 94 32 94 56 C86 46 74 40 60 40 C46 40 34 46 26 56Z"/></g>}
          {c.hair === 'tuft' && <g fill={`url(#${id('hair')})`}><path d="M44 36 L48 10 L58 30 L64 6 L70 30 L80 14 L78 38 Z"/><path d="M30 52 C30 36 44 30 60 30 C76 30 90 36 90 52 C82 44 72 40 60 40 C48 40 38 44 30 52Z"/></g>}
          <path d={body} fill={`url(#${id('body')})`} stroke="rgba(62,35,18,.10)" strokeWidth="1.5"/>
          <path d={body} fill={`url(#${id('shade')})`}/>
          <path d="M36 52 C42 42 52 38 62 38" fill="none" stroke="#FFFFFF" strokeOpacity=".75" strokeWidth="3" strokeLinecap="round"/>
          {c.hair === 'beanie' && <g><path d="M22 60 C22 30 42 20 60 20 C78 20 98 30 98 60 Z" fill={`url(#${id('hair')})`}/><rect x="19" y="54" width="82" height="11" rx="5.5" fill={c.h1} stroke="rgba(0,0,0,.12)"/><circle cx="60" cy="16" r="8" fill="#FBF6EF" stroke="rgba(62,35,18,.12)"/></g>}
          <circle cx="60" cy="93" r="23" fill={`url(#${id('core')})`} style={{ animation: 'gogoGlow 4s ease-in-out infinite' }}/>
          <ellipse cx="41" cy="77" rx="5" ry="3.4" fill={c.core} fillOpacity=".22"/><ellipse cx="79" cy="77" rx="5" ry="3.4" fill={c.core} fillOpacity=".22"/>
        </g>
        {/* The face sits outside the fur filter, so a moving eye never re-runs the filter (review, 12 Nov). */}
        <g>
          {m.open === 1 && <g>
            <ellipse cx="46" cy="64" rx="9" ry="9.6" fill={`url(#${id('white')})`}/><ellipse cx="74" cy="64" rx="9" ry="9.6" fill={`url(#${id('white')})`}/>
            {eye(46, 3.6)}{eye(74, 3.3)}
            <ellipse cx="46" cy="64" rx="9" ry="9.6" fill="none" stroke="rgba(62,35,18,.18)" strokeWidth="1"/><ellipse cx="74" cy="64" rx="9" ry="9.6" fill="none" stroke="rgba(62,35,18,.18)" strokeWidth="1"/>
          </g>}
          {m.happy === 1 && <path d="M42 66 q6 -6 12 0 M66 66 q6 -6 12 0" fill="none" stroke="#2C1A13" strokeWidth="2.8" strokeLinecap="round"/>}
          {m.closed === 1 && <path d="M42 64 q6 5 12 0 M66 64 q6 5 12 0" fill="none" stroke="#2C1A13" strokeWidth="2.8" strokeLinecap="round"/>}
          {m.brows === 1 && <path d="M40 52 L51 49 M80 52 L69 49" fill="none" stroke="#2C1A13" strokeWidth="2.4" strokeLinecap="round"/>}
          {m.smile === 1 && <path d="M54 80 q6 5 12 0" fill="none" stroke="#2C1A13" strokeWidth="2.2" strokeLinecap="round"/>}
          {m.grin === 1 && <path d="M53 78 q7 8 14 0 Z" fill="#2C1A13"/>}
          {m.oh === 1 && <ellipse cx="60" cy="81" rx="3" ry="3.6" fill="#2C1A13"/>}
        </g>
      </g>
      {m.dots === 1 && size >= 40 && <g><circle cx="92" cy="22" r="3" fill={c.core} style={{ animation: 'gogoPulse 1.2s ease-in-out infinite' }}/><circle cx="102" cy="14" r="3" fill={c.core} style={{ animation: 'gogoPulse 1.2s ease-in-out .2s infinite' }}/><circle cx="112" cy="6" r="3" fill={c.core} style={{ animation: 'gogoPulse 1.2s ease-in-out .4s infinite' }}/></g>}
      {m.zz === 1 && size >= 40 && <g fill={c.h2} fontFamily="system-ui, sans-serif" fontWeight={700}><text x="94" y="30" fontSize="12">z</text><text x="102" y="18" fontSize="9">z</text></g>}
      {m.check === 1 && <g><circle cx="99" cy="100" r="11" fill="#2FAE6A" stroke="#FBF6EF" strokeWidth="3"/><path d="M93.5 100 l4 4 l7.5 -8" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></g>}
    </svg>
  </span>
}
