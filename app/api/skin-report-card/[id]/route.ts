import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

// Exact portrait dimensions — fills perfectly
const W = 1080
const H = 1920

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}
function cl(v: any, fb = '-') { return String(v ?? '').replace(/\s+/g, ' ').trim() || fb }
function sh(v: any, max = 36, fb = '-') { const s = cl(v, fb); return s.length > max ? s.slice(0, max - 2) + '..' : s }
function pct(v: any, d = 65) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d }
function zn(r: any, ...keys: string[]) { for (const k of keys) { const v = r?.face_zones_json?.[k]; if (v && String(v).trim() && String(v).trim() !== '-') return sh(v, 28) } return null }
function ls(items: any[], limit: number, fb: string[]) {
  const v = (items || []).map((i: any) => cl(i, '')).filter(Boolean).slice(0, limit)
  return v.length ? v : fb.slice(0, limit)
}

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

// ── Tokens ──────────────────────────────────────────
const BG     = '#f2ebe0'
const HERO   = '#1c3429'
const CARD   = '#fdfaf5'
const GOLD   = '#c9a84c'
const LGOLD  = '#e8cf80'
const GREEN  = '#1c3429'
const TEAL   = '#2d7d5f'
const MUTED  = '#7a6e5a'
const LMUTED = '#b0a494'
const LINE   = '#e2dace'
const RED    = '#8b2e1a'
const REDBG  = '#fdf3f1'
const REDBDR = '#e8c0b8'
const GBG    = '#f1f7f4'
const GBDR   = '#b0d0c0'

// ── Helpers (all display:flex) ───────────────────────
function d(style: any, children?: any): any {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } }
}
function t(content: any, style: any = {}): any {
  return d({ fontSize: 15, color: GREEN, fontWeight: 500, lineHeight: 1.35, ...style }, content)
}
function row(children: any, style: any = {}): any {
  return d({ flexDirection: 'row', alignItems: 'center', ...style }, children)
}
function col(children: any, style: any = {}): any {
  return d({ flexDirection: 'column', ...style }, children)
}
function hr(style: any = {}): any {
  return d({ width: '100%', height: 1, background: LINE, flexShrink: 0, ...style }, null)
}

// Section label with gold left bar
function slabel(text: string, light = false): any {
  return row([
    d({ width: 4, height: 22, borderRadius: 2, background: light ? LGOLD : GOLD, marginRight: 12, flexShrink: 0 }, null),
    t(text, { fontSize: 12, fontWeight: 900, letterSpacing: 2.5, color: light ? LGOLD : GREEN, textTransform: 'uppercase' })
  ], { marginBottom: 18 })
}

// Pill badge
function badge(label: string): any {
  return d({ borderRadius: 999, background: CARD, border: `1.5px solid ${LINE}`, padding: '8px 20px', marginRight: 10, marginBottom: 0, alignItems: 'center', flexShrink: 0 },
    t(label, { fontSize: 14, fontWeight: 700, color: GREEN })
  )
}

// Score bar
function sbar(label: string, val: number, color: string, tw = 340): any {
  const f = Math.max(6, Math.round((val / 100) * tw))
  return col([
    row([
      t(label, { fontSize: 14, fontWeight: 700, flex: 1, color: GREEN }),
      t(String(val), { fontSize: 26, fontWeight: 900, color }),
      t('%', { fontSize: 12, color: MUTED, marginLeft: 2, marginTop: 9 })
    ], { marginBottom: 6 }),
    d({ width: tw, height: 8, borderRadius: 999, background: '#e2dace', flexShrink: 0 }, [
      d({ width: f, height: 8, borderRadius: 999, background: color }, null)
    ])
  ], { marginBottom: 18 })
}

// Zone row
function zrow(label: string, value: string | null): any {
  if (!value) return null as any
  return row([
    d({ width: 6, height: 6, borderRadius: 999, background: GOLD, marginRight: 10, flexShrink: 0 }, null),
    t(label, { fontSize: 11, fontWeight: 900, color: GOLD, letterSpacing: 1.2, textTransform: 'uppercase', width: 118, flexShrink: 0 }),
    t(sh(value, 26), { fontSize: 13, fontWeight: 600, color: GREEN, flex: 1 })
  ], { marginBottom: 11 })
}

// Bullet
function bul(text: string, dotColor = GOLD, color = GREEN): any {
  return row([
    d({ width: 5, height: 5, borderRadius: 999, background: dotColor, marginRight: 10, marginTop: 7, flexShrink: 0 }, null),
    t(sh(text, 42), { fontSize: 14, fontWeight: 600, color, lineHeight: 1.35, flex: 1 })
  ], { alignItems: 'flex-start', marginBottom: 10 })
}

// Routine step
function rstep(num: number, label: string, tag: string, tagBg: string): any {
  return col([
    d({ width: 52, height: 52, borderRadius: 999, border: `1.5px solid ${LINE}`, background: CARD, alignItems: 'center', justifyContent: 'center', marginBottom: 7, flexShrink: 0 },
      t(String(num), { fontSize: 22, fontWeight: 900, color: GREEN })
    ),
    t(sh(label, 14), { fontSize: 10, fontWeight: 700, color: GREEN, textAlign: 'center', lineHeight: 1.2, marginBottom: 5 }),
    d({ borderRadius: 999, background: tagBg, padding: '2px 8px', alignItems: 'center', justifyContent: 'center' },
      t(tag, { fontSize: 8, fontWeight: 900, color: '#fff', letterSpacing: 0.5 })
    )
  ], { alignItems: 'center', width: 76, flexShrink: 0 })
}
function rarrow(): any {
  return d({ alignItems: 'center', justifyContent: 'center', width: 20, flexShrink: 0 },
    t('›', { fontSize: 24, color: LMUTED, fontWeight: 200 })
  )
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { data: r, error } = await db()
      .from('skin_check_reports').select('*').eq('id', id).maybeSingle()
    if (error || !r) return new NextResponse(error ? 'DB error' : 'Not found', { status: error ? 500 : 404 })

    const selfie = await getSelfie(r)
    const dateStr = r?.created_at
      ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

    const hydration = pct(r?.scores_json?.hydration ?? r?.scores_json?.Hydration ?? r?.scores_json?.['Hydration'], 72)
    const barrier   = pct(r?.scores_json?.barrier_support ?? r?.scores_json?.['Barrier support'] ?? r?.scores_json?.barrier, 68)
    const oilNum    = (() => { const o = cl(r?.scores_json?.oiliness ?? r?.scores_json?.Oiliness ?? 'moderate').toLowerCase(); return o.includes('high') ? 78 : o.includes('mod') ? 52 : 30 })()
    const sensNum   = (() => { const s = cl(r?.scores_json?.sensitivity ?? r?.scores_json?.['Sensitivity signs'] ?? 'low').toLowerCase(); return s.includes('high') ? 72 : s.includes('mod') ? 46 : 22 })()
    const skinType  = sh(r?.skin_type ?? 'Combination', 30)
    const oilLabel  = sh(r?.scores_json?.oiliness ?? r?.scores_json?.Oiliness ?? 'Moderate', 14)
    const sensLabel = sh(r?.scores_json?.sensitivity ?? r?.scores_json?.['Sensitivity signs'] ?? 'Low', 14)
    const texLabel  = sh(r?.scores_json?.texture ?? r?.scores_json?.Texture ?? 'Smooth', 14)
    const conf      = sh(r?.confidence_level ?? r?.scores_json?.confidence ?? 'High', 10)

    const obs      = ls(r?.observations_json, 4, ['T-zone shine visible', 'Mild under-eye darkness', 'Even cheek tone', 'Smooth texture overall'])
    const cautions = ls(r?.cautions_json, 3, ['Avoid heavy creams on T-zone', "Don't skip sunscreen", 'Avoid over-exfoliating'])
    const am       = ls(r?.am_routine_json, 4, ['Gentle gel cleanser', 'Hyaluronic serum', 'Niacinamide 10%', 'SPF 50+ sunscreen'])
    const pm       = ls(r?.pm_routine_json, 4, ['Foam cleanser', 'Peptide serum', 'Centella extract', 'Ceramide cream'])

    // Try all possible key formats for zones
    const forehead = zn(r, 'forehead', 'Forehead', 'FOREHEAD')
    const undereye = zn(r, 'under-eye', 'under_eye', 'Under-eye', 'Under eye', 'undereye', 'UNDER_EYE')
    const cheeks   = zn(r, 'cheeks', 'Cheeks', 'CHEEKS')
    const tzone    = zn(r, 'nose_t-zone', 'nose / t-zone', 'Nose / T-zone', 't-zone', 'T-zone', 'nose/t-zone', 'noset-zone', 'Nose/T-zone', 'nose_tzone')
    const chin     = zn(r, 'chin', 'chin / jawline', 'Chin / Jawline', 'jawline', 'Jawline', 'CHIN')

    // Debug: log what zones we found
    console.log('[skin-report-card] zones:', { forehead, undereye, cheeks, tzone, chin })
    console.log('[skin-report-card] face_zones_json keys:', Object.keys(r?.face_zones_json || {}))

    // Concerns
    const rawText = (obs.join(' ') + skinType + oilLabel).toLowerCase()
    const concerns: string[] = []
    if (rawText.includes('oil') || rawText.includes('shine')) concerns.push('Oiliness')
    if (rawText.includes('dark') || rawText.includes('eye')) concerns.push('Under-Eye')
    if (rawText.includes('pore')) concerns.push('Pores')
    if (rawText.includes('texture') || rawText.includes('rough')) concerns.push('Texture')
    if (rawText.includes('sensitiv') || rawText.includes('red')) concerns.push('Sensitivity')
    if (rawText.includes('dry') || rawText.includes('dehydr')) concerns.push('Dehydration')
    if (concerns.length === 0) concerns.push('Oiliness', 'Pores', 'Hydration')

    const amTags: [string, string][] = [['CLEANSE','#2d7d5f'],['HYDRATE','#2776b5'],['BALANCE','#a07c20'],['PROTECT','#2d7d5f']]
    const pmTags: [string, string][] = [['CLEANSE','#2d7d5f'],['RENEW','#7b3d9e'],['SOOTHE','#2776b5'],['REPAIR','#c05c1a']]

    const selfieEl = selfie
      ? d({ width: 310, height: 360, borderRadius: 22, border: `2px solid rgba(201,168,76,0.35)`, flexShrink: 0 }, [
          { type: 'img', props: { src: selfie, width: 310, height: 360, style: { borderRadius: 20 } } }
        ])
      : d({ width: 310, height: 360, borderRadius: 22, background: '#2a4035', border: `2px solid ${GOLD}`, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
          t('✦', { fontSize: 56, color: GOLD })
        )

    // ── FULL LAYOUT: all sections sized to exactly fill H=1920 ──────────
    const tree = d({
      flexDirection: 'column',
      width: W,
      height: H,
      background: BG,
      // No auto margins — everything is explicitly sized
    }, [

      // ══ HERO: 460px ════════════════════════════════════════
      d({ flexDirection: 'column', width: W, height: 460, background: HERO, flexShrink: 0 }, [
        // top bar: 60px padding-top
        row([
          row([
            d({ width: 32, height: 1.5, background: GOLD, marginRight: 12 }, null),
            t('ASKGOGO · SKIN ANALYSIS', { fontSize: 11, fontWeight: 900, color: GOLD, letterSpacing: 3 })
          ], {}),
          t(dateStr, { fontSize: 12, fontWeight: 600, color: 'rgba(201,168,76,0.65)' })
        ], { justifyContent: 'space-between', padding: '52px 64px 0 64px' }),

        // Title
        col([
          t('Skin Analysis', { fontSize: 68, fontWeight: 900, color: '#f5efe3', letterSpacing: -1.5, lineHeight: 1 }),
          t('& Consultation', { fontSize: 68, fontWeight: 200, color: '#f5efe3', letterSpacing: -1.5, lineHeight: 1, fontStyle: 'italic', marginBottom: 16 }),
          t('Personalised visual skincare insights · Not a medical diagnosis', { fontSize: 13, fontWeight: 500, color: 'rgba(201,168,76,0.65)', letterSpacing: 0.2 })
        ], { padding: '28px 64px 0 64px' }),

        // Stat chips
        row([
          col([
            t(`${hydration}%`, { fontSize: 42, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('HYDRATION', { fontSize: 9, fontWeight: 800, color: 'rgba(201,168,76,0.55)', letterSpacing: 2.5, marginTop: 5 })
          ], { marginRight: 36 }),
          d({ width: 1, height: 44, background: 'rgba(201,168,76,0.2)', marginRight: 36 }, null),
          col([
            t(`${barrier}%`, { fontSize: 42, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('BARRIER', { fontSize: 9, fontWeight: 800, color: 'rgba(201,168,76,0.55)', letterSpacing: 2.5, marginTop: 5 })
          ], { marginRight: 36 }),
          d({ width: 1, height: 44, background: 'rgba(201,168,76,0.2)', marginRight: 36 }, null),
          col([
            t(conf, { fontSize: 42, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('CONFIDENCE', { fontSize: 9, fontWeight: 800, color: 'rgba(201,168,76,0.55)', letterSpacing: 2.5, marginTop: 5 })
          ], {})
        ], { padding: '28px 64px 0 64px' })
      ]),

      // ══ SECTION 1: FACIAL MAP — 430px ══════════════════════
      d({ flexDirection: 'column', width: W, height: 430, flexShrink: 0, padding: '32px 56px 0 56px' }, [
        slabel('Facial Map & Observations'),
        row([
          // Selfie + skin type chip below
          col([
            selfieEl,
            d({ width: 310, height: 46, background: HERO, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10, flexShrink: 0 }, [
              t('SKIN TYPE: ', { fontSize: 10, fontWeight: 800, color: GOLD, letterSpacing: 1.5, marginRight: 6 }),
              t(sh(skinType, 22), { fontSize: 14, fontWeight: 800, color: '#f5efe3' })
            ])
          ], { flexShrink: 0 }),

          // Zones + stats
          col([
            ...([
              ['FOREHEAD', forehead],
              ['UNDER-EYE', undereye],
              ['CHEEKS', cheeks],
              ['NOSE/T-ZONE', tzone],
              ['CHIN/JAWLINE', chin],
            ] as [string, string | null][]).filter(([, v]) => v !== null).map(([l, v]) => zrow(l, v)),
            hr({ margin: '8px 0 14px 0' }),
            row([
              col([t('OILINESS', { fontSize: 9, fontWeight: 900, color: LMUTED, letterSpacing: 1.5, marginBottom: 4 }), t(oilLabel, { fontSize: 14, fontWeight: 800, color: GREEN })], { marginRight: 28 }),
              col([t('TEXTURE', { fontSize: 9, fontWeight: 900, color: LMUTED, letterSpacing: 1.5, marginBottom: 4 }), t(texLabel, { fontSize: 14, fontWeight: 800, color: GREEN })], { marginRight: 28 }),
              col([t('SENSITIVITY', { fontSize: 9, fontWeight: 900, color: LMUTED, letterSpacing: 1.5, marginBottom: 4 }), t(sensLabel, { fontSize: 14, fontWeight: 800, color: GREEN })], {})
            ], {})
          ], { flex: 1, marginLeft: 32 })
        ])
      ]),

      // ══ SECTION 2: KEY CONCERNS — 100px ═══════════════════
      d({ flexDirection: 'column', width: W, height: 100, flexShrink: 0, padding: '14px 56px 0 56px' }, [
        slabel('Key Concerns'),
        row(concerns.map(c => badge(c)), { flexWrap: 'nowrap' })
      ]),

      // ══ SECTION 3: SKIN METRICS — 250px ═══════════════════
      d({ flexDirection: 'column', width: W, height: 250, flexShrink: 0, padding: '20px 56px 0 56px' }, [
        slabel('Skin Metrics'),
        d({ flexDirection: 'column', background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: '24px 28px' }, [
          row([
            col([
              sbar('Hydration', hydration, TEAL, 310),
              sbar('Barrier health', barrier, TEAL, 310),
            ], { flex: 1, marginRight: 40 }),
            col([
              sbar('Oil balance', oilNum, GOLD, 310),
              sbar('Sensitivity', sensNum, GOLD, 310),
            ], { flex: 1 })
          ])
        ])
      ]),

      // ══ SECTION 4: CURRENT vs TARGET — 210px ══════════════
      d({ flexDirection: 'column', width: W, height: 210, flexShrink: 0, padding: '18px 56px 0 56px' }, [
        slabel('Current vs Target Balance'),
        row([
          d({ flexDirection: 'column', flex: 1, background: '#fdf8f0', border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 22px' }, [
            row([d({ width: 6, height: 6, borderRadius: 999, background: GOLD, marginRight: 8, flexShrink: 0 }, null), t('CURRENT', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 2 })], { marginBottom: 13 }),
            ...obs.slice(0, 3).map(o => bul(sh(o, 30), GOLD))
          ]),
          d({ width: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, t('→', { fontSize: 28, color: GOLD, fontWeight: 200 })),
          d({ flexDirection: 'column', flex: 1, background: GBG, border: `1px solid ${GBDR}`, borderRadius: 16, padding: '18px 22px' }, [
            row([d({ width: 6, height: 6, borderRadius: 999, background: TEAL, marginRight: 8, flexShrink: 0 }, null), t('TARGET', { fontSize: 9, fontWeight: 900, color: TEAL, letterSpacing: 2 })], { marginBottom: 13 }),
            ...['Calmer even skin tone', 'Visible hydrated glow', 'Refined pores & barrier'].map(s => bul(s, TEAL))
          ])
        ])
      ]),

      // ══ SECTION 5: ROUTINE — 290px ═════════════════════════
      d({ flexDirection: 'column', width: W, height: 290, flexShrink: 0, padding: '18px 56px 0 56px' }, [
        slabel('Personalized Routine'),
        d({ flexDirection: 'column', background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: '20px 24px' }, [
          // AM
          d({ flexDirection: 'column', background: '#f4fbf8', borderRadius: 12, padding: '16px 18px', marginBottom: 10 }, [
            row([t('☀', { fontSize: 18, marginRight: 8 }), t('MORNING', { fontSize: 11, fontWeight: 900, color: TEAL, letterSpacing: 2 })], { marginBottom: 14 }),
            row([
              ...am.slice(0, 4).flatMap((s, i) => [
                rstep(i + 1, s, amTags[i]?.[0] ?? 'STEP', amTags[i]?.[1] ?? TEAL),
                ...(i < 3 ? [rarrow()] : [])
              ])
            ], { alignItems: 'flex-start' })
          ]),
          // PM
          d({ flexDirection: 'column', background: '#f7f4fc', borderRadius: 12, padding: '16px 18px' }, [
            row([t('🌙', { fontSize: 18, marginRight: 8 }), t('NIGHT', { fontSize: 11, fontWeight: 900, color: '#7b3d9e', letterSpacing: 2 })], { marginBottom: 14 }),
            row([
              ...pm.slice(0, 4).flatMap((s, i) => [
                rstep(i + 1, s, pmTags[i]?.[0] ?? 'STEP', pmTags[i]?.[1] ?? '#7b3d9e'),
                ...(i < 3 ? [rarrow()] : [])
              ])
            ], { alignItems: 'flex-start' })
          ])
        ])
      ]),

      // ══ SECTION 6: AVOID + EXPERT — 150px ══════════════════
      d({ flexDirection: 'row', width: W, height: 150, flexShrink: 0, padding: '12px 56px 0 56px', gap: 16 }, [
        d({ flexDirection: 'column', flex: 1, background: REDBG, border: `1px solid ${REDBDR}`, borderRadius: 16, padding: '18px 20px' }, [
          row([d({ width: 3, height: 18, borderRadius: 2, background: RED, marginRight: 10, flexShrink: 0 }, null), t('AVOID', { fontSize: 11, fontWeight: 900, color: RED, letterSpacing: 2 })], { marginBottom: 12 }),
          ...cautions.map(c => bul(sh(c, 35), RED, RED))
        ]),
        d({ flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${LINE}`, borderRadius: 16, padding: '18px 20px' }, [
          row([d({ width: 3, height: 18, borderRadius: 2, background: GOLD, marginRight: 10, flexShrink: 0 }, null), t('EXPERT NOTES', { fontSize: 11, fontWeight: 900, color: GREEN, letterSpacing: 2 })], { marginBottom: 12 }),
          ...([['🛡','Barrier First'],['💧','Layer Hydration'],['☀','SPF Always'],['✓','Stay Consistent']] as [string,string][]).map(([ic,lb]) =>
            row([t(ic, { fontSize: 15, width: 24, flexShrink: 0 }), t(lb, { fontSize: 13, fontWeight: 700, color: GREEN })], { marginBottom: 8 })
          )
        ])
      ]),

      // ══ FOOTER — 30px ══════════════════════════════════════
      d({ flexDirection: 'column', width: W, height: 30, flexShrink: 0, padding: '0 64px', justifyContent: 'center' }, [
        hr({ marginBottom: 0 }),
      ]),
      d({ flexDirection: 'row', width: W, flexShrink: 0, padding: '0 64px', height: 50, alignItems: 'center', justifyContent: 'space-between' }, [
        row([t('AskGogo Skin Check', { fontSize: 13, fontWeight: 900, color: GREEN }), t(' · app.askgogo.in', { fontSize: 11, fontWeight: 500, color: MUTED })], {}),
        t('Visual observation only — consult a dermatologist for skin concerns', { fontSize: 11, fontWeight: 500, color: LMUTED })
      ])
    ])

    return new ImageResponse(tree as any, {
      width: W, height: H,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300, s-maxage=300' }
    })
  } catch (err: any) {
    console.error('[skin-report-card] failed:', err?.message)
    return new NextResponse('Failed: ' + err?.message, { status: 500 })
  }
}
