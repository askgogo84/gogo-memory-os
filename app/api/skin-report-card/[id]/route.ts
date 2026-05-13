import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080
const H = 1920

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

function cl(v: any, fb = '-') { return String(v ?? '').replace(/\s+/g, ' ').trim() || fb }
function sh(v: any, max = 36, fb = '-') { const s = cl(v, fb); return s.length > max ? s.slice(0, max - 2) + '..' : s }
function pct(v: any, d = 65) { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : d }
function zn(r: any, ...keys: string[]) { for (const k of keys) { const v = r?.face_zones_json?.[k]; if (v) return sh(v, 26) } return null }
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

// ── Tokens ────────────────────────────────────────────
const BG      = '#f2ebe0'   // warm parchment
const HERO_BG = '#1c3429'   // deep forest green
const CARD    = '#fdfaf5'   // off-white card
const GOLD    = '#c8a84b'   // warm gold
const LGOLD   = '#e8c96e'   // light gold
const GREEN   = '#1c3429'   // dark green text
const TEAL    = '#2d7d5f'   // accent teal
const MUTED   = '#7a6e5a'
const LINE    = '#e0d8cc'
const RED     = '#8b2e1a'
const REDBG   = '#fdf3f1'
const GREENBG = '#f1f7f4'

// ── All display:flex helpers ──────────────────────────
function d(style: any, children?: any): any {
  return { type: 'div', props: { style: { display: 'flex', ...style }, children } }
}
function t(content: any, style: any = {}): any {
  return d({ fontSize: 16, color: GREEN, fontWeight: 500, ...style }, content)
}
function row(children: any, style: any = {}): any {
  return d({ flexDirection: 'row', alignItems: 'center', ...style }, children)
}
function col(children: any, style: any = {}): any {
  return d({ flexDirection: 'column', ...style }, children)
}

// Horizontal rule
function hr(style: any = {}): any {
  return d({ width: '100%', height: 1, background: LINE, ...style }, null)
}

// Section title — gold left border + caps label
function stitle(label: string, light = false): any {
  return row([
    d({ width: 4, height: 26, borderRadius: 2, background: GOLD, marginRight: 14, flexShrink: 0 }, null),
    t(label, { fontSize: 13, fontWeight: 900, letterSpacing: 2.5, color: light ? GOLD : GREEN, textTransform: 'uppercase' })
  ], { marginBottom: 24 })
}

// Score bar with big number
function scorebar(label: string, val: number, color: string, trackW = 380): any {
  const filled = Math.max(8, Math.round((val / 100) * trackW))
  return col([
    row([
      t(label, { fontSize: 15, fontWeight: 700, flex: 1, color: GREEN }),
      t(String(val), { fontSize: 28, fontWeight: 900, color }),
      t('%', { fontSize: 13, color: MUTED, marginLeft: 2, marginTop: 10 })
    ], { marginBottom: 6 }),
    d({ width: trackW, height: 8, borderRadius: 999, background: '#e2dbd0' }, [
      d({ width: filled, height: 8, borderRadius: 999, background: color }, null)
    ])
  ], { marginBottom: 20 })
}

// Face zone row with dot + dashed line
function zrow(label: string, value: string | null): any {
  if (!value) return null
  return row([
    d({ width: 7, height: 7, borderRadius: 999, background: GOLD, marginRight: 12, flexShrink: 0 }, null),
    t(label, { fontSize: 12, fontWeight: 900, color: GOLD, letterSpacing: 1.5, textTransform: 'uppercase', width: 130, flexShrink: 0 }),
    t(sh(value, 28), { fontSize: 14, fontWeight: 600, color: GREEN, flex: 1 })
  ], { marginBottom: 13 })
}

// Pill badge
function badge(label: string, bg = CARD, bdr = LINE, color = GREEN): any {
  return d({ borderRadius: 999, background: bg, border: `1.5px solid ${bdr}`, padding: '9px 22px', marginRight: 10, marginBottom: 10, alignItems: 'center' },
    t(label, { fontSize: 14, fontWeight: 700, color })
  )
}

// Bullet
function bul(text: string, dotColor = GOLD, txtColor = GREEN): any {
  return row([
    d({ width: 6, height: 6, borderRadius: 999, background: dotColor, marginRight: 12, marginTop: 8, flexShrink: 0 }, null),
    t(sh(text, 48), { fontSize: 15, fontWeight: 600, color: txtColor, lineHeight: 1.4, flex: 1 })
  ], { alignItems: 'flex-start', marginBottom: 11 })
}

// Routine step block
function rstep(num: number, label: string, tag: string, tagBg: string): any {
  return col([
    d({ width: 56, height: 56, borderRadius: 999, border: `1.5px solid ${LINE}`, background: CARD, alignItems: 'center', justifyContent: 'center', marginBottom: 8, flexShrink: 0 },
      t(String(num), { fontSize: 24, fontWeight: 900, color: GREEN })
    ),
    t(sh(label, 16), { fontSize: 11, fontWeight: 700, color: GREEN, textAlign: 'center', lineHeight: 1.2, marginBottom: 6 }),
    d({ borderRadius: 999, background: tagBg, padding: '3px 10px', alignItems: 'center' },
      t(tag, { fontSize: 9, fontWeight: 900, color: '#fff', letterSpacing: 0.8 })
    )
  ], { alignItems: 'center', width: 86 })
}

function rarrow(): any {
  return d({ alignItems: 'center', justifyContent: 'center', marginBottom: 20, flexShrink: 0 },
    t('›', { fontSize: 30, color: MUTED, fontWeight: 200 })
  )
}

// White card panel
function panel(children: any, style: any = {}): any {
  return d({ flexDirection: 'column', background: CARD, border: `1px solid ${LINE}`, borderRadius: 22, padding: '32px 36px', ...style }, children)
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { data: r, error } = await db()
      .from('skin_check_reports').select('*').eq('id', id).maybeSingle()
    if (error || !r) return new NextResponse(error ? 'DB error' : 'Not found', { status: error ? 500 : 404 })

    const selfie = await getSelfie(r)
    const dateStr = r?.created_at
      ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })

    const hydration  = pct(r?.scores_json?.hydration ?? r?.scores_json?.Hydration, 72)
    const barrier    = pct(r?.scores_json?.barrier_support ?? r?.scores_json?.['Barrier support'], 68)
    const oilNum     = (() => { const o = cl(r?.scores_json?.oiliness ?? 'moderate').toLowerCase(); return o.includes('high') ? 78 : o.includes('mod') ? 52 : 30 })()
    const sensNum    = (() => { const s = cl(r?.scores_json?.sensitivity ?? 'low').toLowerCase(); return s.includes('high') ? 72 : s.includes('mod') ? 46 : 22 })()
    const skinType   = sh(r?.skin_type ?? 'Combination', 28)
    const oilLabel   = sh(r?.scores_json?.oiliness ?? 'Moderate', 14)
    const sensLabel  = sh(r?.scores_json?.sensitivity ?? 'Low', 14)
    const texLabel   = sh(r?.scores_json?.texture ?? 'Smooth', 14)
    const conf       = sh(r?.confidence_level ?? 'High', 10)

    const obs      = ls(r?.observations_json, 4, ['T-zone shine visible', 'Mild under-eye darkness', 'Even cheek tone', 'Smooth texture overall'])
    const cautions = ls(r?.cautions_json, 3, ['Avoid heavy creams', "Don't skip sunscreen", 'Avoid over-exfoliating'])
    const am       = ls(r?.am_routine_json, 4, ['Gentle gel cleanser', 'Hyaluronic serum', 'Niacinamide 10%', 'SPF 50+'])
    const pm       = ls(r?.pm_routine_json, 4, ['Foam cleanser', 'Peptide serum', 'Centella extract', 'Ceramide cream'])

    const forehead = zn(r, 'forehead', 'Forehead')
    const undereye = zn(r, 'under-eye', 'under_eye', 'Under-eye', 'Under eye')
    const cheeks   = zn(r, 'cheeks', 'Cheeks')
    const tzone    = zn(r, 'nose_t-zone', 'nose / t-zone', 'Nose / T-zone', 'T-zone', 't-zone')
    const chin     = zn(r, 'chin', 'chin / jawline', 'Chin / Jawline', 'jawline')

    const rawText = (obs.join(' ') + skinType + oilLabel).toLowerCase()
    const concerns: string[] = []
    if (rawText.includes('oil') || rawText.includes('shine')) concerns.push('Oiliness')
    if (rawText.includes('dark') || rawText.includes('eye')) concerns.push('Under-Eye')
    if (rawText.includes('pore')) concerns.push('Pores')
    if (rawText.includes('texture') || rawText.includes('rough')) concerns.push('Texture')
    if (rawText.includes('sensitiv') || rawText.includes('red')) concerns.push('Sensitivity')
    if (rawText.includes('dry') || rawText.includes('dehydr')) concerns.push('Dehydration')
    if (concerns.length === 0) concerns.push('Oiliness', 'Pores', 'Hydration')

    const amTags = [['CLEANSE','#2d7d5f'],['HYDRATE','#2776b5'],['BALANCE','#a07c20'],['PROTECT','#2d7d5f']]
    const pmTags = [['CLEANSE','#2d7d5f'],['RENEW','#7b3d9e'],['SOOTHE','#2776b5'],['REPAIR','#c05c1a']]

    const selfieEl = selfie
      ? d({ width: 260, height: 300, borderRadius: 20, border: `2.5px solid rgba(200,168,75,0.4)`, flexShrink: 0 }, [
          { type: 'img', props: { src: selfie, width: 260, height: 300, style: { borderRadius: 17 } } }
        ])
      : d({ width: 260, height: 300, borderRadius: 20, background: '#2d4535', border: `2px solid ${GOLD}`, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
          t('✦', { fontSize: 56, color: GOLD })
        )

    // ── TREE ─────────────────────────────────────────────
    const tree = d({ flexDirection: 'column', width: W, height: H, background: BG }, [

      // ══ HERO ══════════════════════════════════════════
      d({ flexDirection: 'column', background: HERO_BG, padding: '0 0 50px 0' }, [
        // top strip
        d({ flexDirection: 'row', padding: '40px 64px 0 64px', alignItems: 'center', justifyContent: 'space-between' }, [
          row([
            d({ width: 36, height: 1.5, background: GOLD, marginRight: 14 }, null),
            t('ASKGOGO · SKIN ANALYSIS', { fontSize: 11, fontWeight: 900, color: GOLD, letterSpacing: 3 })
          ], {}),
          t(dateStr, { fontSize: 12, fontWeight: 600, color: 'rgba(200,168,75,0.7)' })
        ]),

        // big title
        d({ flexDirection: 'column', padding: '40px 64px 0 64px' }, [
          t('Skin Analysis', { fontSize: 70, fontWeight: 900, color: '#f5efe3', letterSpacing: -2, lineHeight: 1 }),
          t('& Consultation', { fontSize: 70, fontWeight: 200, color: '#f5efe3', letterSpacing: -2, lineHeight: 1, fontStyle: 'italic', marginBottom: 20 }),
          t('Personalised visual skincare insights · Not a medical diagnosis', { fontSize: 14, fontWeight: 500, color: 'rgba(200,168,75,0.75)', letterSpacing: 0.3 })
        ]),

        // stat chips
        d({ flexDirection: 'row', padding: '40px 64px 0 64px', alignItems: 'flex-end' }, [
          col([
            t(String(hydration) + '%', { fontSize: 44, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('HYDRATION', { fontSize: 10, fontWeight: 800, color: 'rgba(200,168,75,0.65)', letterSpacing: 2.5, marginTop: 6 })
          ], { marginRight: 44 }),
          d({ width: 1, height: 50, background: 'rgba(200,168,75,0.25)', marginRight: 44 }, null),
          col([
            t(String(barrier) + '%', { fontSize: 44, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('BARRIER', { fontSize: 10, fontWeight: 800, color: 'rgba(200,168,75,0.65)', letterSpacing: 2.5, marginTop: 6 })
          ], { marginRight: 44 }),
          d({ width: 1, height: 50, background: 'rgba(200,168,75,0.25)', marginRight: 44 }, null),
          col([
            t(conf, { fontSize: 44, fontWeight: 900, color: LGOLD, lineHeight: 1 }),
            t('CONFIDENCE', { fontSize: 10, fontWeight: 800, color: 'rgba(200,168,75,0.65)', letterSpacing: 2.5, marginTop: 6 })
          ], {})
        ])
      ]),

      // ══ SECTION 1: FACIAL MAP ═════════════════════════
      d({ flexDirection: 'column', padding: '44px 56px 0 56px' }, [
        stitle('Facial Map & Observations'),
        row([
          // selfie
          col([
            selfieEl,
            // skin type under selfie
            d({ flexDirection: 'column', marginTop: 16, background: HERO_BG, borderRadius: 14, padding: '14px 20px', width: 260, alignItems: 'center' }, [
              t('SKIN TYPE', { fontSize: 10, fontWeight: 900, color: GOLD, letterSpacing: 2, marginBottom: 5 }),
              t(skinType, { fontSize: 16, fontWeight: 800, color: '#f5efe3', textAlign: 'center' })
            ])
          ], { flexShrink: 0 }),

          // zones
          d({ flexDirection: 'column', flex: 1, marginLeft: 40 }, [
            ...[
              ['FOREHEAD', forehead],
              ['UNDER-EYE', undereye],
              ['CHEEKS', cheeks],
              ['NOSE / T-ZONE', tzone],
              ['CHIN / JAWLINE', chin],
            ].filter(([, v]) => v).map(([l, v]) => zrow(l as string, v as string)),
            hr({ marginTop: 12, marginBottom: 20 }),
            // mini stat row
            row([
              col([
                t('OILINESS', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 1.5, marginBottom: 5 }),
                t(oilLabel, { fontSize: 15, fontWeight: 800, color: GREEN })
              ], { marginRight: 32 }),
              col([
                t('TEXTURE', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 1.5, marginBottom: 5 }),
                t(texLabel, { fontSize: 15, fontWeight: 800, color: GREEN })
              ], { marginRight: 32 }),
              col([
                t('SENSITIVITY', { fontSize: 9, fontWeight: 900, color: MUTED, letterSpacing: 1.5, marginBottom: 5 }),
                t(sensLabel, { fontSize: 15, fontWeight: 800, color: GREEN })
              ], {})
            ], {})
          ])
        ])
      ]),

      // ══ SECTION 2: KEY CONCERNS ═══════════════════════
      d({ flexDirection: 'column', padding: '40px 56px 0 56px' }, [
        stitle('Key Concerns'),
        d({ flexDirection: 'row', flexWrap: 'wrap' },
          concerns.map(c => badge(c))
        )
      ]),

      // ══ SECTION 3: SKIN METRICS ═══════════════════════
      d({ flexDirection: 'column', padding: '40px 56px 0 56px' }, [
        stitle('Skin Metrics'),
        panel([
          row([
            col([
              scorebar('Hydration', hydration, TEAL, 340),
              scorebar('Barrier health', barrier, TEAL, 340),
            ], { flex: 1, marginRight: 48 }),
            col([
              scorebar('Oil balance', oilNum, GOLD, 340),
              scorebar('Sensitivity', sensNum, GOLD, 340),
            ], { flex: 1 })
          ])
        ])
      ]),

      // ══ SECTION 4: CURRENT vs TARGET ══════════════════
      d({ flexDirection: 'column', padding: '40px 56px 0 56px' }, [
        stitle('Current vs Target Balance'),
        row([
          d({ flexDirection: 'column', flex: 1, background: '#fdf8f0', border: `1px solid ${LINE}`, borderRadius: 18, padding: '24px 26px' }, [
            row([
              d({ width: 7, height: 7, borderRadius: 999, background: GOLD, marginRight: 10, flexShrink: 0 }, null),
              t('CURRENT', { fontSize: 10, fontWeight: 900, color: MUTED, letterSpacing: 2 })
            ], { marginBottom: 16 }),
            ...obs.slice(0, 3).map(o => bul(sh(o, 34)))
          ]),
          d({ width: 52, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
            t('→', { fontSize: 34, fontWeight: 100, color: GOLD })
          ),
          d({ flexDirection: 'column', flex: 1, background: GREENBG, border: `1px solid #b8d8c8`, borderRadius: 18, padding: '24px 26px' }, [
            row([
              d({ width: 7, height: 7, borderRadius: 999, background: TEAL, marginRight: 10, flexShrink: 0 }, null),
              t('TARGET', { fontSize: 10, fontWeight: 900, color: TEAL, letterSpacing: 2 })
            ], { marginBottom: 16 }),
            ...['Calmer even skin tone', 'Visible hydrated glow', 'Refined pores & barrier'].map(s => bul(s, TEAL, GREEN))
          ])
        ])
      ]),

      // ══ SECTION 5: ROUTINE ════════════════════════════
      d({ flexDirection: 'column', padding: '40px 56px 0 56px' }, [
        stitle('Personalized Routine'),
        panel([
          // AM
          d({ flexDirection: 'column', background: '#f6fbf8', borderRadius: 16, padding: '22px 26px', marginBottom: 14 }, [
            row([
              t('☀', { fontSize: 24, marginRight: 12 }),
              t('MORNING', { fontSize: 12, fontWeight: 900, color: TEAL, letterSpacing: 2.5 })
            ], { marginBottom: 20 }),
            row([
              ...am.slice(0, 4).flatMap((s, i) => [
                rstep(i + 1, s, amTags[i]?.[0] ?? 'STEP', amTags[i]?.[1] ?? TEAL),
                ...(i < 3 ? [rarrow()] : [])
              ])
            ], { alignItems: 'flex-start' })
          ]),
          // PM
          d({ flexDirection: 'column', background: '#f8f5fc', borderRadius: 16, padding: '22px 26px' }, [
            row([
              t('🌙', { fontSize: 24, marginRight: 12 }),
              t('NIGHT', { fontSize: 12, fontWeight: 900, color: '#7b3d9e', letterSpacing: 2.5 })
            ], { marginBottom: 20 }),
            row([
              ...pm.slice(0, 4).flatMap((s, i) => [
                rstep(i + 1, s, pmTags[i]?.[0] ?? 'STEP', pmTags[i]?.[1] ?? '#7b3d9e'),
                ...(i < 3 ? [rarrow()] : [])
              ])
            ], { alignItems: 'flex-start' })
          ])
        ])
      ]),

      // ══ SECTION 6: AVOID + EXPERT ═════════════════════
      d({ flexDirection: 'row', padding: '40px 56px 0 56px', gap: 18 }, [
        d({ flexDirection: 'column', flex: 1, background: REDBG, border: `1px solid #e8c4bc`, borderRadius: 18, padding: '26px 26px' }, [
          row([
            d({ width: 4, height: 22, borderRadius: 2, background: RED, marginRight: 12, flexShrink: 0 }, null),
            t('AVOID', { fontSize: 12, fontWeight: 900, color: RED, letterSpacing: 2.5 })
          ], { marginBottom: 18 }),
          ...cautions.map(c => bul(c, RED, RED))
        ]),
        d({ flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${LINE}`, borderRadius: 18, padding: '26px 26px' }, [
          row([
            d({ width: 4, height: 22, borderRadius: 2, background: GOLD, marginRight: 12, flexShrink: 0 }, null),
            t('EXPERT NOTES', { fontSize: 12, fontWeight: 900, color: GREEN, letterSpacing: 2.5 })
          ], { marginBottom: 18 }),
          ...[
            ['🛡', 'Barrier First', 'Build resilience daily'],
            ['💧', 'Layer Hydration', 'Hyaluronic + lock-in'],
            ['☀', 'SPF Always', 'Every morning, indoors too'],
            ['✓', 'Stay Consistent', '4–6 weeks for results'],
          ].map(([ic, title, sub]) => row([
            t(ic as string, { fontSize: 18, width: 28, flexShrink: 0 }),
            col([
              t(title as string, { fontSize: 13, fontWeight: 800, color: GREEN }),
              t(sub as string, { fontSize: 11, fontWeight: 500, color: MUTED, marginTop: 2 })
            ], {})
          ], { alignItems: 'flex-start', marginBottom: 13 }))
        ])
      ]),

      // ══ FOOTER ════════════════════════════════════════
      d({ flexDirection: 'column', padding: '36px 64px 44px 64px' }, [
        hr({ marginBottom: 22 }),
        row([
          t('AskGogo Skin Check', { fontSize: 15, fontWeight: 900, color: GREEN }),
          t(' · app.askgogo.in', { fontSize: 13, fontWeight: 500, color: MUTED })
        ], { marginBottom: 10 }),
        t('Visual cosmetic observation only — not a medical diagnosis. Consult a dermatologist for any skin concerns.',
          { fontSize: 12, fontWeight: 500, color: MUTED, lineHeight: 1.5 })
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
