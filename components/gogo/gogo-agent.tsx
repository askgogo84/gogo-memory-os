'use client'

// Gogo, the designed character system (docs/design/gogo-character/Gogo.dc.html), as a React component.
// Same silhouette in every state; only eyes, hands, the core glow and the props around Gogo change.
// Props: state (one of 15), size in px (48 task card · 72 card · 120 rail · 200 expanded), theme.
// Below 90 px the floating props are dropped so Gogo stays readable. Keyframes (gg-*) live in app/globals.css,
// and the global prefers-reduced-motion rule stills them.
import { useId } from 'react'
import { GOGO_STATE_NAME, type GogoAgentState } from '@/lib/gogo/agent-states'

type Line = { x: number; y: number; w: number; fill: string }
type Card = {
  x: number; y: number; w: number; h: number; delay: string; lines: Line[]
  check?: boolean; cx?: number; cy?: number; checkPath?: string
  glyph?: string; glyphColor?: string
  dots?: boolean; dx1?: number; dx2?: number; dx3?: number; dy?: number
  spin?: string
}
type Look = {
  eyes: 'closed' | 'open' | 'happy' | 'half'; eyeR: number; gazeTf: string; gazeAnim: string
  hands: 'rest' | 'type' | 'wave' | 'chin' | 'scratch' | 'point'
  mouth: string; brows: boolean; bodyAnim: string; glowSpeed: string; blush: number
  laptop: boolean; cards: Card[]; plane: boolean; badge: boolean; rings: string[]; orbit: boolean; typeSpeed: string
}

function look(state: GogoAgentState, dark: boolean): Look {
  const lineStrong = dark ? 'rgba(243,231,211,.7)' : 'rgba(44,26,19,.7)'
  const lineSoft = dark ? 'rgba(243,231,211,.22)' : 'rgba(44,26,19,.18)'
  const L = (x: number, y: number, w: number, strong: boolean): Line => ({ x, y, w, fill: strong ? lineStrong : lineSoft })
  const card = (x: number, y: number, w: number, h: number, delay: string, extra: Partial<Card> = {}): Card => ({
    x, y, w, h, delay, lines: [L(x + 6, y + 6, w * 0.5, true), L(x + 6, y + 13, w - 12, false), L(x + 6, y + 20, w * 0.7, false)].filter(l => l.y < y + h - 4), ...extra,
  })
  const check = (c: Card): Card => ({ ...c, check: true, cx: c.x + c.w - 9, cy: c.y + c.h - 9, checkPath: `M${c.x + c.w - 12} ${c.y + c.h - 9} L${c.x + c.w - 10} ${c.y + c.h - 7} L${c.x + c.w - 6} ${c.y + c.h - 11.5}` })
  const M = { smile: 'M55 76 q5 3 10 0', open: 'M57 75 q3 4 6 0', flat: 'M56 76 h8', hm: 'M55 77 q4 -2 9 0' }
  const B = { breath: 'gg-breath 5s ease-in-out infinite', lean: 'gg-lean 3s ease-in-out infinite', none: 'none' }
  const base: Look = { eyes: 'closed', eyeR: 3.3, gazeTf: 'translate(0,0)', gazeAnim: 'none', hands: 'rest', mouth: '', brows: false, bodyAnim: B.breath, glowSpeed: '4s', blush: 0.18, laptop: false, cards: [], plane: false, badge: false, rings: [], orbit: false, typeSpeed: '.34s' }
  const work: Partial<Look> = { eyes: 'open', hands: 'type', laptop: true, bodyAnim: B.none, glowSpeed: '2.4s' }
  const S: Record<GogoAgentState, Partial<Look>> = {
    idle: {},
    thinking: { eyes: 'open', gazeTf: 'translate(1.5px,-2px)', hands: 'chin', orbit: true, cards: [check(card(178, 74, 44, 22, '0s')), check(card(184, 102, 44, 22, '.3s')), card(190, 130, 44, 22, '.6s', { dots: true, dx1: 200, dx2: 207, dx3: 214, dy: 145, lines: [] })] },
    searching: { ...work, gazeAnim: 'gg-look 3.2s ease-in-out infinite', cards: [card(10, 96, 56, 34, '0s'), card(174, 86, 56, 34, '.25s'), card(16, 138, 50, 30, '.5s')] },
    browsing: { ...work, gazeAnim: 'gg-lookdown 2.4s ease-in-out infinite', cards: [card(6, 76, 60, 30, '0s'), card(2, 112, 60, 30, '.2s'), card(174, 68, 60, 30, '.4s'), card(180, 104, 60, 30, '.6s'), card(178, 140, 58, 26, '.8s')] },
    comparing: { eyes: 'open', gazeAnim: 'gg-look 4s ease-in-out infinite', hands: 'rest', cards: [card(22, 130, 56, 40, '0s'), check(card(92, 130, 56, 40, '.2s')), card(162, 130, 56, 40, '.4s')] },
    flight: { ...work, gazeAnim: 'gg-look 3.6s ease-in-out infinite', plane: true, cards: [card(8, 112, 56, 30, '.3s'), card(176, 112, 56, 30, '.5s')] },
    train: { ...work, gazeAnim: 'gg-lookdown 3s ease-in-out infinite', cards: [
      { ...card(4, 92, 64, 22, '0s'), lines: [L(10, 98, 10, true), L(24, 98, 20, false), L(48, 98, 14, true)] },
      { ...card(4, 118, 64, 22, '.2s'), lines: [L(10, 124, 10, true), L(24, 124, 20, false), L(48, 124, 14, true)] },
      check({ ...card(4, 144, 64, 22, '.4s'), lines: [L(10, 150, 10, true), L(24, 150, 20, false)] }),
      { ...card(174, 100, 60, 22, '.5s'), lines: [L(180, 106, 10, true), L(194, 106, 22, false), L(220, 106, 8, true)] },
    ] },
    grocery: { eyes: 'open', gazeAnim: 'gg-look 4s ease-in-out infinite', hands: 'point', bodyAnim: B.lean, cards: [
      { ...card(164, 112, 66, 52, '0s'), lines: [L(170, 118, 30, true), L(170, 126, 50, false), L(170, 134, 44, false), L(170, 142, 40, false)], glyph: 'M184 152 L188 152 L191 160 L210 160 L212 154 L190 154 M192 165 a1 1 0 1 0 0.01 0 M208 165 a1 1 0 1 0 0.01 0', glyphColor: '#EF7A27' },
      check(card(10, 96, 48, 30, '.2s')), card(14, 132, 48, 30, '.4s'),
    ] },
    booking: { ...work, typeSpeed: '.8s', gazeTf: 'translate(0,2px)', glowSpeed: '4s', cards: [{ ...card(170, 88, 62, 58, '0s'), lines: [L(176, 94, 24, true), L(176, 102, 50, false), L(176, 110, 50, false), L(176, 118, 44, false), L(176, 126, 50, false), L(176, 134, 30, true)] }] },
    approval: { eyes: 'open', eyeR: 3.8, hands: 'wave', mouth: M.open, blush: 0.3, cards: [{ ...card(170, 84, 64, 60, '0s'), lines: [L(176, 90, 30, true), L(176, 98, 52, false), L(176, 106, 44, false), L(176, 124, 20, true), L(202, 124, 20, true)] }] },
    otp: { eyes: 'open', gazeTf: 'translate(2px,2.5px)', hands: 'rest', cards: [{ ...card(182, 96, 34, 60, '0s'), lines: [L(192, 110, 14, true)], dots: true, dx1: 192, dx2: 199, dx3: 206, dy: 130 }] },
    watcher: { eyes: 'half', bodyAnim: B.none, glowSpeed: '2.4s', rings: ['0s', '2s'], cards: [{ ...card(178, 116, 50, 26, '.4s'), lines: [L(194, 124, 28, true), L(194, 132, 22, false)], glyph: 'M184 134 a4 4 0 0 1 8 0 v4 h-8z M188 126 a1 1 0 0 1 0 2', glyphColor: '#EF7A27' }] },
    done: { eyes: 'happy', mouth: M.smile, badge: true, blush: 0.3, bodyAnim: 'gg-bob 2.2s ease-in-out infinite' },
    blocked: { eyes: 'open', eyeR: 3, brows: true, mouth: M.flat, gazeTf: 'translate(0,1.5px)', hands: 'chin', laptop: true, blush: 0.1, cards: [{ ...card(170, 84, 56, 40, '0s'), lines: [L(176, 110, 44, false), L(176, 117, 30, false)], glyph: 'M192 98 h12 v9 h-12z M194 98 v-3 a4 4 0 0 1 8 0 v3', glyphColor: '#EF7A27' }] },
    failed: { eyes: 'open', mouth: M.hm, gazeTf: 'translate(-2px,-1.5px)', hands: 'scratch', blush: 0.12, cards: [{ ...card(166, 100, 58, 40, '.2s'), lines: [L(172, 126, 46, false), L(172, 133, 30, false)], spin: 'M190 112 a6 6 0 1 1 6 6 M196 112 l0 5 l-5 0' }] },
  }
  return { ...base, ...(S[state] || {}) }
}

const HAND = { fill: '#F3E7D3', stroke: '#E4D3B9', strokeWidth: 1 }

export function GogoAgent({ state = 'idle', size = 120, theme = 'dark', label, className = '' }: {
  state?: GogoAgentState; size?: number; theme?: 'light' | 'dark'; label?: string; className?: string
}) {
  const id = useId().replace(/:/g, '')
  const dark = theme === 'dark'
  const v = look(state, dark)
  if (size < 90) { v.cards = []; v.plane = false; v.rings = []; v.orbit = false }
  const cardFill = dark ? '#1F1A17' : '#FFFFFF', cardStroke = dark ? '#3B312B' : '#E4D3B9'
  const lineStrong = dark ? 'rgba(243,231,211,.7)' : 'rgba(44,26,19,.7)', lineSoft = dark ? 'rgba(243,231,211,.22)' : 'rgba(44,26,19,.18)'
  const body = `gg-body-${id}`, core = `gg-core-${id}`, hair = `gg-hair-${id}`
  const w = size, h = Math.round(size * 200 / 240)
  return <span role="img" aria-label={label || `Gogo — ${GOGO_STATE_NAME[state]}`} className={`inline-block shrink-0 leading-none ${className}`} style={{ width: w, height: h }}>
    <svg viewBox="0 0 240 200" width={w} height={h} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      <defs>
        <radialGradient id={body} cx="40%" cy="30%" r="80%"><stop offset="0" stopColor="#FFFBF3" /><stop offset=".6" stopColor="#F3E7D3" /><stop offset="1" stopColor="#E4D3B9" /></radialGradient>
        <radialGradient id={core} cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#FFB06A" stopOpacity=".95" /><stop offset=".55" stopColor="#EF7A27" stopOpacity=".55" /><stop offset="1" stopColor="#EF7A27" stopOpacity="0" /></radialGradient>
        <radialGradient id={hair} cx="40%" cy="35%" r="75%"><stop offset="0" stopColor="#4A2E20" /><stop offset="1" stopColor="#2C1A13" /></radialGradient>
      </defs>
      <ellipse cx="120" cy="174" rx="40" ry="5" fill={dark ? 'rgba(0,0,0,.45)' : 'rgba(44,26,19,.10)'} />
      {v.rings.map(d => <circle key={d} cx="120" cy="100" r="72" style={{ fill: 'none', stroke: '#EF7A27', strokeWidth: 1.5, strokeOpacity: .4, transformBox: 'fill-box', transformOrigin: 'center', animation: `gg-ring 4s ${d} ease-out infinite` }} />)}
      {v.orbit && <g style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: 'gg-orbit 6s linear infinite' }}><circle cx="120" cy="14" r="4" fill="#EF7A27" /><circle cx="186" cy="80" r="3" fill="#EF7A27" opacity=".7" /><circle cx="56" cy="96" r="2.4" fill="#EF7A27" opacity=".5" /></g>}
      <g transform="translate(30 -6) scale(1.5)">
        <g style={{ transformBox: 'fill-box', transformOrigin: 'center 90%', animation: v.bodyAnim }}>
          <g fill={`url(#${hair})`} style={{ stroke: dark ? 'rgba(255,251,243,.32)' : 'none', strokeWidth: 1.6 }}>
            <circle cx="24" cy="52" r="9" /><circle cx="28" cy="40" r="10.5" /><circle cx="38" cy="30" r="11" /><circle cx="51" cy="23" r="11.5" /><circle cx="66" cy="22" r="12" /><circle cx="81" cy="28" r="11" /><circle cx="92" cy="39" r="10.5" /><circle cx="96" cy="52" r="9" /><circle cx="60" cy="32" r="13" /><circle cx="44" cy="40" r="10" /><circle cx="78" cy="38" r="10" />
          </g>
          <path d="M60 34 C84 34 100 52 101 76 C102 100 84 113 60 113 C36 113 18 100 19 76 C20 52 36 34 60 34Z" fill={`url(#${body})`} style={{ stroke: dark ? 'rgba(255,251,243,.22)' : 'rgba(44,26,19,.08)', strokeWidth: 1.5 }} />
          <circle cx="60" cy="92" r="23" fill={`url(#${core})`} style={{ animation: `gg-glow ${v.glowSpeed} ease-in-out infinite` }} />
          <circle cx="42" cy="72" r="4.5" fill="#EF7A27" opacity={v.blush} /><circle cx="78" cy="72" r="4.5" fill="#EF7A27" opacity={v.blush} />
          {v.eyes === 'closed' && <path d="M43 63 q5 4 10 0 M67 63 q5 4 10 0" style={{ fill: 'none', stroke: '#2C1A13', strokeWidth: 2.6, strokeLinecap: 'round' }} />}
          {v.eyes === 'happy' && <path d="M43 65 q5 -5 10 0 M67 65 q5 -5 10 0" style={{ fill: 'none', stroke: '#2C1A13', strokeWidth: 2.6, strokeLinecap: 'round' }} />}
          {v.eyes === 'half' && <><circle cx="48" cy="64" r="3.2" fill="#2C1A13" /><circle cx="72" cy="64" r="3.2" fill="#2C1A13" /><path d="M43 61 h10 M67 61 h10" style={{ stroke: '#F3E7D3', strokeWidth: 3.2, strokeLinecap: 'round' }} /></>}
          {v.eyes === 'open' && <g style={{ transition: 'transform .5s cubic-bezier(.4,0,.2,1)', transform: v.gazeTf }}>
            <g style={{ animation: v.gazeAnim }}>
              <g style={{ animation: 'gg-blink 5.5s ease-in-out infinite', transformBox: 'fill-box', transformOrigin: 'center' }}>
                <circle cx="48" cy="64" r={v.eyeR} fill="#2C1A13" /><circle cx="72" cy="64" r={v.eyeR} fill="#2C1A13" />
                <circle cx="49.2" cy="62.8" r="1" fill="#FFFBF3" /><circle cx="73.2" cy="62.8" r="1" fill="#FFFBF3" />
              </g>
            </g>
          </g>}
          {v.brows && <path d="M43 55 l9 2.5 M77 55 l-9 2.5" style={{ fill: 'none', stroke: '#2C1A13', strokeWidth: 2, strokeLinecap: 'round', opacity: .7 }} />}
          {v.mouth && <path d={v.mouth} style={{ fill: 'none', stroke: '#2C1A13', strokeWidth: 2, strokeLinecap: 'round', opacity: .7 }} />}
          {v.hands === 'rest' && <><ellipse cx="30" cy="98" rx="7" ry="5" {...HAND} /><ellipse cx="90" cy="98" rx="7" ry="5" {...HAND} /></>}
          {v.hands === 'type' && <><ellipse cx="44" cy="107" rx="7" ry="5" {...HAND} style={{ animation: `gg-type ${v.typeSpeed} ease-in-out infinite alternate` }} /><ellipse cx="76" cy="107" rx="7" ry="5" {...HAND} style={{ animation: `gg-type ${v.typeSpeed} .17s ease-in-out infinite alternate-reverse` }} /></>}
          {v.hands === 'wave' && <><ellipse cx="30" cy="98" rx="7" ry="5" {...HAND} /><ellipse cx="96" cy="72" rx="6" ry="7.5" {...HAND} style={{ transformBox: 'fill-box', transformOrigin: 'bottom center', animation: 'gg-wave 1.2s ease-in-out infinite' }} /></>}
          {v.hands === 'chin' && <><ellipse cx="30" cy="98" rx="7" ry="5" {...HAND} /><ellipse cx="80" cy="82" rx="6.5" ry="5.5" {...HAND} /></>}
          {v.hands === 'scratch' && <><ellipse cx="30" cy="98" rx="7" ry="5" {...HAND} /><ellipse cx="94" cy="40" rx="6" ry="6.5" {...HAND} style={{ animation: 'gg-scratch 1.6s ease-in-out infinite' }} /></>}
          {v.hands === 'point' && <><ellipse cx="30" cy="98" rx="7" ry="5" {...HAND} /><ellipse cx="100" cy="86" rx="7.5" ry="5" {...HAND} /></>}
        </g>
      </g>
      {v.laptop && <g style={{ animation: 'gg-cardin .5s ease-out both' }}>
        <rect x="82" y="122" width="76" height="46" rx="6" style={{ fill: cardFill, stroke: cardStroke, strokeWidth: 1.2 }} />
        <rect x="88" y="128" width="64" height="34" rx="3" fill={dark ? '#2A231E' : '#FBF6EC'} />
        <rect x="92" y="132" width="34" height="3" rx="1.5" fill={lineStrong} />
        <rect x="92" y="139" width="52" height="3" rx="1.5" fill={lineSoft} />
        <rect x="92" y="146" width="44" height="3" rx="1.5" fill={lineSoft} />
        <rect x="92" y="153" width="50" height="3" rx="1.5" fill={lineSoft} />
        <rect x="88" y="130" width="64" height="1.5" fill="#EF7A27" style={{ opacity: .6, animation: 'gg-scan 1.8s linear infinite alternate' }} />
        <rect x="74" y="168" width="92" height="7" rx="3.5" style={{ fill: cardFill, stroke: cardStroke, strokeWidth: 1.2 }} />
      </g>}
      {v.cards.map((c, i) => <g key={i} style={{ animation: `gg-cardin .5s ${c.delay} ease-out both` }}>
        <g style={{ animation: `gg-drift 3.2s ${c.delay} ease-in-out infinite alternate` }}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx="6" style={{ fill: cardFill, stroke: cardStroke, strokeWidth: 1.2 }} />
          {c.lines.map((l, j) => <rect key={j} x={l.x} y={l.y} width={l.w} height="3" rx="1.5" fill={l.fill} />)}
          {c.check && <><circle cx={c.cx} cy={c.cy} r="6" fill="#EF7A27" /><path d={c.checkPath} style={{ fill: 'none', stroke: '#fff', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: 24, animation: `gg-check .6s ${c.delay} ease-out both` }} /></>}
          {c.glyph && <path d={c.glyph} style={{ fill: 'none', stroke: c.glyphColor, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }} />}
          {c.dots && [c.dx1, c.dx2, c.dx3].map((x, k) => <circle key={k} cx={x} cy={c.dy} r="2" fill="#EF7A27" style={{ animation: `gg-dots 1.4s ${k * 0.2}s ease-in-out infinite` }} />)}
          {c.spin && <path d={c.spin} style={{ fill: 'none', stroke: '#EF7A27', strokeWidth: 1.8, strokeLinecap: 'round', transformBox: 'fill-box', transformOrigin: 'center', animation: 'gg-spin 2.4s linear infinite' }} />}
        </g>
      </g>)}
      {v.plane && <g style={{ animation: 'gg-cardin .6s .2s ease-out both' }}>
        <path d="M30 70 Q120 -20 210 70" style={{ fill: 'none', stroke: '#EF7A27', strokeWidth: 1.2, strokeDasharray: '3 4', opacity: .6 }} />
        <circle cx="30" cy="70" r="2.5" fill="#EF7A27" /><circle cx="210" cy="70" r="2.5" fill="#EF7A27" />
        <path d="M-5 0 L5 0 M0 -4 L2 0 L0 4 M-3 -2 L-3 2" style={{ fill: 'none', stroke: dark ? '#F3E7D3' : '#2C1A13', strokeWidth: 1.6, strokeLinecap: 'round', offsetPath: "path('M30 70 Q120 -20 210 70')", offsetRotate: 'auto', animation: 'gg-plane 6s cubic-bezier(.4,0,.4,1) infinite' } as React.CSSProperties} />
      </g>}
      {v.badge && <g style={{ animation: 'gg-cardin .5s .3s ease-out both' }}>
        <circle cx="176" cy="132" r="14" style={{ fill: '#2FAE6A', stroke: dark ? '#0E1614' : '#F6F1E8', strokeWidth: 3 }} />
        <path d="M169 132 L174 137 L184 127" style={{ fill: 'none', stroke: '#fff', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round', strokeDasharray: 24, animation: 'gg-check .7s .6s ease-out both' }} />
      </g>}
    </svg>
  </span>
}
