import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { verifyCardToken } from '@/lib/security/card-link'
import { getSharedCard } from '@/lib/agent/invite-card-store'

// Occasion invite card (approved canvas screen 4, 5 Nov). The card's words travel in ?d= and are signed (?t= bound
// to a digest of ?d= and the owner), so nobody can change the names or mint a card. Any failure is a 404.
export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080, H = 1350
const THEMES: Record<string, { bg: string; line: string; accent: string }[]> = {
  birthday: [{ bg: '#FFF4E8', line: '#F2D9BD', accent: '#B4561F' }, { bg: '#F3EFFA', line: '#DCD3EE', accent: '#5B4A9E' }],
  anniversary: [{ bg: '#FBF4EF', line: '#E2C9BC', accent: '#9E3F4A' }, { bg: '#F1F5EE', line: '#D6E0CF', accent: '#56694F' }],
  dinner: [{ bg: '#F7F5F0', line: '#E6E3DC', accent: '#56694F' }, { bg: '#EEF3F6', line: '#D5E0E7', accent: '#2C5D7C' }],
}

function digestB64(buf: ArrayBuffer) {
  let s = ''; for (const b of new Uint8Array(buf).slice(0, 12)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decode(d: string) {
  const json = atob(d.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = Uint8Array.from(json, c => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}
const str = (v: unknown, n: number) => typeof v === 'string' && v.trim() && v.length <= n ? v.trim() : null

async function font(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(2500) }).then(r => r.ok ? r.text() : '')
    const url = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/)?.[1]
    if (!url) return null
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return res.ok ? await res.arrayBuffer() : null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  let spec: any
  const c = q.get('c')
  if (c) {
    // Shared short link (/e/<id>): the stored row is the card; an unknown or expired id is a 404.
    spec = (await getSharedCard(c))?.spec
    if (!spec) return new NextResponse(null, { status: 404 })
  } else {
    const owner = q.get('o') || '', d = q.get('d') || '', t = q.get('t')
    if (!d || d.length > 1500 || !/^[A-Za-z0-9_-]+$/.test(d)) return new NextResponse(null, { status: 404 })
    const kind = `invite-${digestB64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d)))}`
    if (!(await verifyCardToken(kind, owner, t))) return new NextResponse(null, { status: 404 })
    try { spec = decode(d) } catch { return new NextResponse(null, { status: 404 }) }
  }
  const og = q.get('f') === 'og'
  const title = str(spec?.title, 80), kicker = str(spec?.kicker, 40), note = str(spec?.note, 80), venue = str(spec?.venue, 80), when = str(spec?.when, 60), party = str(spec?.party, 30)
  const theme = (THEMES[String(spec?.kind)] || THEMES.dinner)[Number(spec?.style) % 2 === 1 ? 1 : 0]
  if (!title || !kicker || !venue || !when) return new NextResponse(null, { status: 404 })

  const big = kicker.match(/^Celebrating (\d{1,3}) years$/)
  const words = [title, kicker, note, venue, when, party, 'YEARS TOGETHER CELEBRATING ·'].filter(Boolean).join(' ')
  const [serif, sans, sansBold] = await Promise.all([font('Instrument+Serif', 400, words + '0123456789'), font('Inter', 400, words), font('Inter', 600, words.toUpperCase() + words)])
  const fonts = [serif && { name: 'Serif', data: serif, weight: 400 as const }, sans && { name: 'Sans', data: sans, weight: 400 as const }, sansBold && { name: 'Sans', data: sansBold, weight: 600 as const }].filter(Boolean) as any[]

  const div = (style: any, children?: any): any => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } })
  if (og) {
    // 1200×630 for WhatsApp's large link preview: the same card, laid out wide.
    const ow = 1200, oh = 630
    const head = big ? `${big[1]} YEARS TOGETHER` : kicker.toUpperCase()
    const wide = div({ width: ow, height: oh, background: theme.bg, alignItems: 'center', justifyContent: 'center', fontFamily: 'Sans' }, [
      div({ width: 1120, height: 550, border: `2px solid ${theme.line}`, borderRadius: 24, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 48, textAlign: 'center' }, [
        div({ fontSize: 24, fontWeight: 600, letterSpacing: 5, color: theme.accent }, head),
        div({ fontFamily: 'Serif', fontSize: title.length > 26 ? 70 : 84, lineHeight: 1.05, color: '#1C1C1E', marginTop: 26, maxWidth: 1000, justifyContent: 'center', textAlign: 'center' }, title),
        div({ width: 80, height: 3, background: theme.accent, marginTop: 28 }),
        div({ fontSize: 34, fontWeight: 600, color: '#1C1C1E', marginTop: 28 }, venue),
        div({ fontSize: 30, color: '#3F3F44', marginTop: 14 }, party ? `${when} · ${party}` : when),
      ]),
    ])
    return new ImageResponse(wide, { width: ow, height: oh, fonts: fonts.length ? fonts : undefined, headers: { 'Cache-Control': 'public, max-age=86400, immutable' } })
  }
  const tree = div({ width: W, height: H, background: theme.bg, alignItems: 'center', justifyContent: 'center', fontFamily: 'Sans' }, [
    div({ width: 960, height: 1230, border: `2px solid ${theme.line}`, borderRadius: 28, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80, textAlign: 'center' }, [
      ...(big
        ? [div({ fontSize: 30, fontWeight: 600, letterSpacing: 6, color: theme.accent }, 'CELEBRATING'),
           div({ fontFamily: 'Serif', fontSize: 170, lineHeight: 1, color: theme.accent, marginTop: 20 }, big[1]),
           div({ fontSize: 30, fontWeight: 600, letterSpacing: 6, color: theme.accent, marginTop: 6 }, 'YEARS TOGETHER')]
        : [div({ fontSize: 30, fontWeight: 600, letterSpacing: 6, color: theme.accent }, kicker.toUpperCase())]),
      div({ fontFamily: 'Serif', fontSize: title.length > 22 ? 84 : 100, lineHeight: 1.05, color: '#1C1C1E', marginTop: 40, maxWidth: 800, justifyContent: 'center', textAlign: 'center' }, title),
      div({ width: 90, height: 3, background: theme.accent, marginTop: 40 }),
      div({ fontSize: 44, fontWeight: 600, color: '#1C1C1E', marginTop: 40, maxWidth: 800, justifyContent: 'center' }, venue),
      div({ fontSize: 38, color: '#3F3F44', marginTop: 22 }, when),
      ...(party ? [div({ fontSize: 38, color: '#3F3F44', marginTop: 8 }, party)] : []),
      ...(note ? [div({ fontSize: 32, color: '#5F5F64', marginTop: 34 }, note)] : []),
    ]),
  ])
  return new ImageResponse(tree, { width: W, height: H, fonts: fonts.length ? fonts : undefined, headers: { 'Cache-Control': 'public, max-age=86400, immutable' } })
}
