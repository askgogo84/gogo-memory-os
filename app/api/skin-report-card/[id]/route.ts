import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080
const H = 1620

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function cl(v: any, fb = '-') { return String(v ?? '').replace(/\s+/g, ' ').trim() || fb }
function sh(v: any, max = 38, fb = '-') { const s = cl(v, fb); return s.length > max ? s.slice(0, max - 2) + '..' : s }
function pct(v: any, d = 65) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d }
function zn(r: any, ...keys: string[]) { for (const k of keys) { const v = r?.face_zones_json?.[k]; if (v) return sh(v, 30) } return '-' }
function ls(items: any[], limit: number, fb: string[]) { const v = (items || []).map((i: any) => cl(i, '')).filter(Boolean).slice(0, limit); return v.length ? v : fb.slice(0, limit) }

async function getSelfie(r: any): Promise<string | null> {
  if (!r?.image_url) return null
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN
    if (!sid || !tok) return null
    const res = await fetch(r.image_url, { headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}` } })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let b = ''; bytes.forEach(x => b += String.fromCharCode(x))
    return `data:image/jpeg;base64,${btoa(b)}`
  } catch { return null }
}

// ─── Design tokens ───────────────────────────────────────────
const BG    = '#f5efe4'
const CARD  = '#fffdf9'
const GREEN = '#1a3d30'
const GOLD  = '#b8922a'
const TEAL  = '#2e8b6a'
const MUTED = '#7a6a50'
const BORDER= '#ddd0b8'
const WARN  = '#8b2e20'
const WBG   = '#fdf4f2'
const WBDR  = '#e0b8b0'
const AMBER = '#d4890a'
const BAR_T = '#e0d4bc'
const BADGE_BG = '#f0e8d8'

// ─── Element helpers (all display:flex) ──────────────────────
function div(style: any, children: any): any {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } }
}
function txt(children: any, style: any = {}): any {
  return div({ fontSize: 16, color: GREEN, fontWeight: 600, ...style }, children)
}
function row(children: any, style: any = {}): any {
  return div({ flexDirection: 'row', alignItems: 'center', ...style }, children)
}
function col(children: any, style: any = {}): any {
  return div({ flexDirection: 'column', ...style }, children)
}
function card(children: any, style: any = {}): any {
  return div({ flexDirection: 'column', background: CARD, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: 28, ...style }, children)
}
function sectionTitle(t: string): any {
  return row([
    div({ width: 22, height: 22, borderRadius: 99, background: GREEN, marginRight: 10, flexShrink: 0 }, null),
    txt(t, { fontSize: 17, fontWeight: 900, letterSpacing: 1.5, textTransform: 'uppercase', color: GREEN })
  ], { marginBottom: 18 })
}

function scoreBar(label: string, percent: number, color = TEAL): any {
  const filled = Math.max(6, Math.round((percent / 100) * 260))
  return row([
    txt(label, { fontSize: 15, fontWeight: 700, width: 150, color: GREEN }),
    div({ width: 260, height: 12, borderRadius: 99, background: BAR_T, flexShrink: 0 }, [
      div({ width: filled, height: 12, borderRadius: 99, background: color }, null)
    ]),
    txt(`${percent}%`, { fontSize: 15, fontWeight: 900, marginLeft: 14, color: GREEN })
  ], { marginBottom: 14 })
}

function metBox(label: string, value: string): any {
  return col([
    txt(label, { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 5, textAlign: 'center' }),
    txt(sh(value, 16), { fontSize: 14, fontWeight: 900, color: GREEN, textAlign: 'center' })
  ], { alignItems: 'center', background: BADGE_BG, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '10px 14px', minWidth: 96 })
}

function bul(text: string, color = GREEN): any {
  return row([
    div({ width: 6, height: 6, borderRadius: 99, background: GOLD, marginRight: 10, marginTop: 6, flexShrink: 0 }, null),
    txt(sh(text, 58), { fontSize: 16, fontWeight: 600, color, lineHeight: 1.4 })
  ], { alignItems: 'flex-start', marginBottom: 10 })
}

function zoneRow(label: string, value: string): any {
  return row([
    txt(label, { fontSize: 12, fontWeight: 900, color: GOLD, width: 110, letterSpacing: 0.5, textTransform: 'uppercase', flexShrink: 0 }),
    txt(sh(value, 32), { fontSize: 14, fontWeight: 600, color: GREEN })
  ], { marginBottom: 10 })
}

function routineStep(n: number, text: string, tag: string, tagColor: string): any {
  return col([
    div({ width: 48, height: 44, borderRadius: 10, background: BADGE_BG, border: `1px solid ${BORDER}`, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
      txt(n.toString(), { fontSize: 18, fontWeight: 900, color: GREEN })
    ),
    txt(sh(text, 20), { fontSize: 11, fontWeight: 700, color: GREEN, textAlign: 'center', lineHeight: 1.2, marginBottom: 4 }),
    div({ borderRadius: 99, background: tagColor, padding: '2px 8px', alignItems: 'center', justifyContent: 'center' },
      txt(tag, { fontSize: 9, fontWeight: 900, color: '#fff', letterSpacing: 0.5 })
    )
  ], { alignItems: 'center', width: 80 })
}

function arrow(): any {
  return div({ width: 20, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
    txt('›', { fontSize: 22, fontWeight: 900, color: GOLD })
  )
}

function concernBadge(label: string): any {
  return div({ borderRadius: 99, background: BADGE_BG, border: `1px solid ${BORDER}`, padding: '7px 16px', marginRight: 8, marginBottom: 8, alignItems: 'center' },
    txt(label, { fontSize: 13, fontWeight: 800, color: GREEN, letterSpacing: 0.5 })
  )
}

function buildCard(r: any, selfie: string | null, dateStr: string): any {
  const hydration = pct(r?.scores_json?.hydration ?? r?.scores_json?.Hydration, 72)
  const barrier   = pct(r?.scores_json?.barrier_support ?? r?.scores_json?.['Barrier support'], 68)
  const oiliness  = sh(r?.scores_json?.oiliness ?? r?.scores_json?.Oiliness ?? 'Moderate', 16)
  const texture_v = sh(r?.scores_json?.texture ?? r?.scores_json?.Texture ?? 'Smooth', 16)
  const sensitivity = sh(r?.scores_json?.sensitivity ?? r?.scores_json?.['Sensitivity signs'] ?? 'Low', 16)
  const skinType  = sh(r?.skin_type ?? 'Combination', 26)
  const confidence= sh(r?.confidence_level ?? 'High', 12)
  const summary   = sh(r?.summary ?? '', 80, '')

  const obs = ls(r?.observations_json, 4, ['Visible shine on T-zone', 'Mild under-eye darkness', 'Even cheek tone', 'Smooth overall texture'])
  const cautions = ls(r?.cautions_json, 4, ['Avoid heavy creams', "Don't skip sunscreen", 'Avoid over-exfoliating', 'Avoid harsh scrubs'])
  const am = ls(r?.am_routine_json, 4, ['Gentle gel cleanser', 'Hyaluronic serum', 'Niacinamide', 'SPF 50 sunscreen'])
  const pm = ls(r?.pm_routine_json, 4, ['Gentle cleanser', 'Peptide serum', 'Centella serum', 'Ceramide moisturiser'])

  const forehead = zn(r, 'forehead', 'Forehead')
  const undereye = zn(r, 'under-eye', 'under_eye', 'Under-eye', 'Under eye')
  const cheeks   = zn(r, 'cheeks', 'Cheeks')
  const tzone    = zn(r, 'nose_t-zone', 'nose / t-zone', 'Nose / T-zone', 't-zone', 'T-zone')
  const chin     = zn(r, 'chin', 'chin / jawline', 'Chin / Jawline', 'jawline')

  // Derive concern badges from observations
  const rawObs = (obs.join(' ') + ' ' + oiliness + ' ' + skinType).toLowerCase()
  const concerns: string[] = []
  if (rawObs.includes('oil') || rawObs.includes('shine')) concerns.push('Oiliness')
  if (rawObs.includes('dark') || rawObs.includes('under-eye')) concerns.push('Under-Eye')
  if (rawObs.includes('pore')) concerns.push('Pores')
  if (rawObs.includes('texture') || rawObs.includes('rough')) concerns.push('Texture')
  if (rawObs.includes('sensitiv') || rawObs.includes('redness')) concerns.push('Sensitivity')
  if (rawObs.includes('dry') || rawObs.includes('dehydrat')) concerns.push('Dehydration')
  if (concerns.length === 0) concerns.push('Oiliness', 'Pores', 'Texture')

  // AM routine tags
  const amTags = [['CLEANSE', '#2e7d5e'], ['HYDRATE', '#2979b8'], ['BALANCE', '#b89a28'], ['PROTECT', '#2e7d5e']]
  const pmTags = [['CLEANSE', '#2e7d5e'], ['RENEW', '#9c2d8a'], ['SOOTHE', '#2979b8'], ['REPAIR', '#c45c1a']]

  const imageEl = selfie
    ? { type: 'img', props: { src: selfie, width: 290, height: 320, style: { borderRadius: 16, border: `1.5px solid ${BORDER}`, objectFit: 'cover' as any } } }
    : div({ width: 290, height: 320, borderRadius: 16, background: BADGE_BG, border: `1.5px solid ${BORDER}`, alignItems: 'center', justifyContent: 'center' },
        txt('YOUR SELFIE', { fontSize: 16, fontWeight: 900, color: MUTED }))

  return div({ flexDirection: 'column', width: W, height: H, background: BG }, [

    // ── HEADER ──────────────────────────────────────────────
    div({ flexDirection: 'column', padding: '44px 60px 28px 60px', borderBottom: `1.5px solid ${BORDER}` }, [
      row([
        div({ width: 5, height: 42, borderRadius: 99, background: GREEN, marginRight: 18, flexShrink: 0 }, null),
        col([
          txt('SKIN ANALYSIS & CONSULTATION', { fontSize: 34, fontWeight: 900, letterSpacing: 2, color: GREEN }),
          txt('PERSONALIZED SKIN INSIGHTS', { fontSize: 13, fontWeight: 700, color: MUTED, letterSpacing: 3, marginTop: 4 })
        ], {})
      ], { justifyContent: 'space-between' }),
      row([
        txt('', {}),
        txt(dateStr, { fontSize: 16, fontWeight: 700, color: MUTED })
      ], { justifyContent: 'flex-end', marginTop: 8 })
    ]),

    // ── SECTION 1: Facial Map ──────────────────────────────
    div({ flexDirection: 'row', padding: '28px 60px 0 60px', gap: 24 }, [
      // Left: selfie
      card([
        row([
          div({ width: 16, height: 16, borderRadius: 99, background: GOLD, marginRight: 10, flexShrink: 0 }, null),
          txt('FACIAL MAP & OBSERVATIONS', { fontSize: 14, fontWeight: 900, letterSpacing: 1.5, color: GREEN })
        ], { marginBottom: 18 }),
        imageEl
      ], { width: 350, flexShrink: 0 }),

      // Right: zone annotations
      card([
        col([
          zoneRow('FOREHEAD', forehead),
          zoneRow('UNDER-EYE', undereye),
          zoneRow('CHEEKS', cheeks),
          zoneRow('NOSE/T-ZONE', tzone),
          zoneRow('CHIN/JAWLINE', chin),
        ], { marginBottom: 20 }),
        div({ width: '100%', height: 1, background: BORDER }, null),
        col([
          txt('AT A GLANCE', { fontSize: 11, fontWeight: 900, color: MUTED, letterSpacing: 2, marginTop: 16, marginBottom: 12 }),
          row([
            col([txt('SKIN TYPE', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 0.6, marginBottom: 4 }), txt(sh(skinType, 18), { fontSize: 14, fontWeight: 900, color: GREEN })], { marginRight: 28 }),
            col([txt('HYDRATION', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 0.6, marginBottom: 4 }), txt(`${hydration}%`, { fontSize: 20, fontWeight: 900, color: TEAL })], { marginRight: 28 }),
            col([txt('BARRIER', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 0.6, marginBottom: 4 }), txt(`${barrier}%`, { fontSize: 20, fontWeight: 900, color: TEAL })], { marginRight: 28 }),
            col([txt('CONFIDENCE', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 0.6, marginBottom: 4 }), txt(confidence, { fontSize: 14, fontWeight: 900, color: GREEN })], {}),
          ], {})
        ], {})
      ], { flex: 1 })
    ]),

    // ── SECTION 2: Concerns ────────────────────────────────
    div({ padding: '20px 60px 0 60px' }, [
      card([
        row([
          div({ width: 16, height: 16, borderRadius: 99, background: GOLD, marginRight: 10, flexShrink: 0 }, null),
          txt('KEY CONCERNS', { fontSize: 14, fontWeight: 900, letterSpacing: 1.5, color: GREEN })
        ], { marginBottom: 14 }),
        div({ flexDirection: 'row', flexWrap: 'wrap' }, concerns.map(c => concernBadge(c)))
      ], { width: '100%' })
    ]),

    // ── SECTION 3: Skin Metrics ────────────────────────────
    div({ padding: '20px 60px 0 60px' }, [
      card([
        row([
          div({ width: 16, height: 16, borderRadius: 99, background: GOLD, marginRight: 10, flexShrink: 0 }, null),
          txt('SKIN METRICS', { fontSize: 14, fontWeight: 900, letterSpacing: 1.5, color: GREEN })
        ], { marginBottom: 18 }),
        div({ flexDirection: 'row', gap: 48 }, [
          col([
            scoreBar('Hydration', hydration),
            scoreBar('Barrier health', barrier),
          ], { flex: 1 }),
          col([
            scoreBar('Oil balance', oiliness.toLowerCase().includes('high') ? 78 : oiliness.toLowerCase().includes('mod') ? 54 : 32, AMBER),
            scoreBar('Sensitivity', sensitivity.toLowerCase().includes('high') ? 74 : sensitivity.toLowerCase().includes('mod') ? 48 : 24, AMBER),
          ], { flex: 1 })
        ])
      ], { width: '100%' })
    ]),

    // ── SECTION 4: Current vs Target ──────────────────────
    div({ padding: '20px 60px 0 60px' }, [
      card([
        row([
          div({ width: 16, height: 16, borderRadius: 99, background: GOLD, marginRight: 10, flexShrink: 0 }, null),
          txt('CURRENT vs TARGET BALANCE', { fontSize: 14, fontWeight: 900, letterSpacing: 1.5, color: GREEN })
        ], { marginBottom: 18 }),
        div({ flexDirection: 'row', alignItems: 'center', gap: 20 }, [
          // Current state
          div({ flexDirection: 'column', flex: 1, background: BADGE_BG, border: `1.5px solid ${BORDER}`, borderRadius: 14, padding: 18 }, [
            txt('CURRENT', { fontSize: 10, fontWeight: 900, color: MUTED, letterSpacing: 1.5, marginBottom: 10 }),
            ...obs.slice(0, 3).map(o => row([
              div({ width: 6, height: 6, borderRadius: 99, background: AMBER, marginRight: 8, flexShrink: 0 }, null),
              txt(sh(o, 32), { fontSize: 13, fontWeight: 600, color: GREEN })
            ], { alignItems: 'flex-start', marginBottom: 7 }))
          ]),
          // Arrow
          div({ flexDirection: 'column', alignItems: 'center', flexShrink: 0 }, [
            txt('→', { fontSize: 32, fontWeight: 900, color: GOLD })
          ]),
          // Target
          div({ flexDirection: 'column', flex: 1, background: '#f0f7f4', border: `1.5px solid #a8d4c0`, borderRadius: 14, padding: 18 }, [
            txt('TARGET BALANCE', { fontSize: 10, fontWeight: 900, color: TEAL, letterSpacing: 1.5, marginBottom: 10 }),
            ...[
              'Calmer, even skin tone',
              'Hydrated visible glow',
              'Refined pores & barrier'
            ].map(t => row([
              div({ width: 6, height: 6, borderRadius: 99, background: TEAL, marginRight: 8, flexShrink: 0 }, null),
              txt(t, { fontSize: 13, fontWeight: 600, color: GREEN })
            ], { alignItems: 'flex-start', marginBottom: 7 }))
          ])
        ])
      ], { width: '100%' })
    ]),

    // ── SECTION 5: Personalized Routine ───────────────────
    div({ padding: '20px 60px 0 60px' }, [
      card([
        row([
          div({ width: 16, height: 16, borderRadius: 99, background: GOLD, marginRight: 10, flexShrink: 0 }, null),
          txt('PERSONALIZED ROUTINE', { fontSize: 14, fontWeight: 900, letterSpacing: 1.5, color: GREEN })
        ], { marginBottom: 18 }),
        // AM row
        row([
          div({ flexDirection: 'column', alignItems: 'center', width: 56, marginRight: 16, flexShrink: 0 }, [
            txt('☀', { fontSize: 22 }),
            txt('AM', { fontSize: 12, fontWeight: 900, color: GREEN, marginTop: 2 })
          ]),
          div({ flexDirection: 'row', alignItems: 'center', flex: 1, flexWrap: 'wrap', gap: 4 }, [
            ...am.slice(0, 4).flatMap((step, i) => [
              routineStep(i + 1, step, amTags[i]?.[0] ?? 'STEP', amTags[i]?.[1] ?? TEAL),
              ...(i < 3 ? [arrow()] : [])
            ])
          ])
        ], { marginBottom: 18, padding: '14px 16px', background: BADGE_BG, borderRadius: 14 }),
        // PM row
        row([
          div({ flexDirection: 'column', alignItems: 'center', width: 56, marginRight: 16, flexShrink: 0 }, [
            txt('🌙', { fontSize: 22 }),
            txt('PM', { fontSize: 12, fontWeight: 900, color: GREEN, marginTop: 2 })
          ]),
          div({ flexDirection: 'row', alignItems: 'center', flex: 1, flexWrap: 'wrap', gap: 4 }, [
            ...pm.slice(0, 4).flatMap((step, i) => [
              routineStep(i + 1, step, pmTags[i]?.[0] ?? 'STEP', pmTags[i]?.[1] ?? TEAL),
              ...(i < 3 ? [arrow()] : [])
            ])
          ])
        ], { padding: '14px 16px', background: '#f0f7f4', borderRadius: 14 })
      ], { width: '100%' })
    ]),

    // ── SECTION 6: Avoid ──────────────────────────────────
    div({ flexDirection: 'row', padding: '20px 60px 0 60px', gap: 20 }, [
      // Avoid
      div({ flexDirection: 'column', flex: 1, background: WBG, border: `1.5px solid ${WBDR}`, borderRadius: 20, padding: 24 }, [
        row([
          div({ width: 16, height: 16, borderRadius: 99, background: WARN, marginRight: 10, flexShrink: 0 }, null),
          txt('AVOID / CAUTION', { fontSize: 14, fontWeight: 900, letterSpacing: 1.5, color: WARN })
        ], { marginBottom: 14 }),
        ...cautions.map(c => bul(c, WARN))
      ]),
      // Expert notes
      div({ flexDirection: 'column', flex: 1, background: BADGE_BG, border: `1.5px solid ${BORDER}`, borderRadius: 20, padding: 24 }, [
        row([
          div({ width: 16, height: 16, borderRadius: 99, background: GREEN, marginRight: 10, flexShrink: 0 }, null),
          txt('EXPERT NOTES', { fontSize: 14, fontWeight: 900, letterSpacing: 1.5, color: GREEN })
        ], { marginBottom: 14 }),
        ...[
          { icon: '🛡', label: 'BARRIER FIRST', sub: 'Strengthen & protect daily' },
          { icon: '💧', label: 'HYDRATE DAILY', sub: 'Foundation of healthy skin' },
          { icon: '☀', label: 'PROTECT AM', sub: 'SPF 50 every morning' },
          { icon: '✓', label: 'CONSISTENCY', sub: 'Small habits, lasting results' }
        ].map(n => row([
          txt(n.icon, { fontSize: 20, marginRight: 10, width: 30, flexShrink: 0 }),
          col([
            txt(n.label, { fontSize: 12, fontWeight: 900, color: GREEN, letterSpacing: 0.6 }),
            txt(n.sub, { fontSize: 11, fontWeight: 600, color: MUTED, marginTop: 2 })
          ], {})
        ], { alignItems: 'flex-start', marginBottom: 12 }))
      ])
    ]),

    // ── FOOTER ─────────────────────────────────────────────
    div({ padding: '18px 60px 24px 60px', marginTop: 'auto' }, [
      div({ width: '100%', height: 1, background: BORDER, marginBottom: 14 }, null),
      txt('Not medical advice. For painful acne, rashes, infection, sudden pigmentation, or changing moles — consult a dermatologist.  |  AskGogo Skin Check · app.askgogo.in', {
        fontSize: 12, fontWeight: 600, color: MUTED, lineHeight: 1.4
      })
    ])
  ])
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { data: r, error } = await db().from('skin_check_reports').select('*').eq('id', id).maybeSingle()
    if (error || !r) return new NextResponse(error ? 'DB error' : 'Not found', { status: error ? 500 : 404 })

    const selfie = await getSelfie(r)
    const dateStr = r?.created_at
      ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

    const tree = buildCard(r, selfie, dateStr)

    return new ImageResponse(tree as any, {
      width: W, height: H,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300, s-maxage=300' }
    })
  } catch (err: any) {
    console.error('[skin-report-card] failed:', err?.message)
    return new NextResponse('Failed: ' + err?.message, { status: 500 })
  }
}
