import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080
const H = 1350

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function cl(val: any, fallback = '-') {
  return String(val ?? '').replace(/\s+/g, ' ').trim() || fallback
}

function sh(val: any, max = 40, fallback = '-') {
  const s = cl(val, fallback)
  return s.length > max ? s.slice(0, max - 2) + '..' : s
}

function pct(val: any, def = 65) {
  const n = Number(val)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : def
}

function zn(r: any, ...keys: string[]) {
  for (const k of keys) {
    const v = r?.face_zones_json?.[k]
    if (v) return sh(v, 28)
  }
  return '-'
}

function ls(items: any[], limit: number, fallback: string[]) {
  const v = (items || []).map(i => cl(i, '')).filter(Boolean).slice(0, limit)
  return v.length ? v : fallback.slice(0, limit)
}

async function getSelfie(report: any): Promise<string | null> {
  if (!report?.image_url) return null
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const tok = process.env.TWILIO_AUTH_TOKEN
    if (!sid || !tok) return null
    const res = await fetch(report.image_url, {
      headers: { Authorization: `Basic ${btoa(`${sid}:${tok}`)}` }
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let b = ''
    bytes.forEach(x => b += String.fromCharCode(x))
    return `data:image/jpeg;base64,${btoa(b)}`
  } catch { return null }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const { data: r, error } = await getSupabase()
      .from('skin_check_reports')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error || !r) {
      return new NextResponse(error ? 'DB error' : 'Not found', { status: error ? 500 : 404 })
    }

    const selfie = await getSelfie(r)
    const hydration = pct(r?.scores_json?.hydration ?? r?.scores_json?.Hydration, 70)
    const barrier = pct(r?.scores_json?.barrier_support ?? r?.scores_json?.['Barrier support'], 65)
    const oiliness = sh(r?.scores_json?.oiliness ?? r?.scores_json?.Oiliness ?? 'Moderate', 14)
    const texture = sh(r?.scores_json?.texture ?? r?.scores_json?.Texture ?? 'Smooth', 14)
    const sensitivity = sh(r?.scores_json?.sensitivity ?? r?.scores_json?.['Sensitivity signs'] ?? 'Low', 14)
    const skinType = sh(r?.skin_type ?? 'Combination', 30)
    const confidence = sh(r?.confidence_level ?? 'Medium', 12)

    const obs = ls(r?.observations_json, 4, ['Visible shine on T-zone', 'Mild under-eye darkness', 'Even cheek tone', 'Smooth overall texture'])
    const cautions = ls(r?.cautions_json, 3, ['Avoid heavy creams', 'Don\'t skip sunscreen', 'Avoid over-exfoliating'])
    const am = ls(r?.am_routine_json, 3, ['Gentle gel cleanser', 'Lightweight hydrating serum', 'SPF 50 sunscreen'])
    const pm = ls(r?.pm_routine_json, 3, ['Gentle foaming cleanser', 'Niacinamide serum', 'Light gel moisturiser'])

    const forehead = zn(r, 'forehead', 'Forehead')
    const undereye = zn(r, 'under-eye', 'under_eye', 'Under-eye', 'Under eye')
    const cheeks = zn(r, 'cheeks', 'Cheeks')
    const tzone = zn(r, 'nose_t-zone', 'nose / t-zone', 'Nose / T-zone', 't-zone', 'T-zone')
    const chin = zn(r, 'chin', 'chin / jawline', 'Chin / Jawline', 'jawline')

    const dateStr = r?.created_at
      ? new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

    const BG = '#f7f0df'
    const CARD = '#ffffff'
    const GREEN = '#173a31'
    const GOLD = '#c69a50'
    const LIGHT = '#fff8ea'
    const BORDER = '#d8c28e'
    const MUTED = '#8b7650'
    const TEAL = '#2f9b80'
    const BARTRACK = '#e5d7bc'

    // Helper: score bar row
    function barRow(label: string, percent: number) {
      const filled = Math.max(8, Math.round((percent / 100) * 220))
      return {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 14, width: '100%' },
          children: [
            { type: 'div', props: { style: { display: 'flex', width: 160, fontSize: 17, fontWeight: 700, color: GREEN }, children: label } },
            { type: 'div', props: {
              style: { display: 'flex', width: 220, height: 14, borderRadius: 99, background: BARTRACK },
              children: { type: 'div', props: { style: { display: 'flex', width: filled, height: 14, borderRadius: 99, background: TEAL } } }
            }},
            { type: 'div', props: { style: { display: 'flex', marginLeft: 12, fontSize: 17, fontWeight: 800, color: GREEN }, children: `${percent}%` } }
          ]
        }
      }
    }

    // Helper: metric box
    function metricBox(label: string, value: string) {
      return {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: 120, height: 76, borderRadius: 16, background: LIGHT, border: `1px solid ${BORDER}`, padding: 6 },
          children: [
            { type: 'div', props: { style: { display: 'flex', fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: 0.5 }, children: label } },
            { type: 'div', props: { style: { display: 'flex', fontSize: 16, fontWeight: 900, color: GREEN, marginTop: 6 }, children: value } }
          ]
        }
      }
    }

    // Helper: bullet
    function bul(text: string, color = GREEN) {
      return {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
          children: [
            { type: 'div', props: { style: { display: 'flex', width: 7, height: 7, borderRadius: 99, background: GOLD, marginTop: 8, marginRight: 10, flexShrink: 0 } } },
            { type: 'div', props: { style: { display: 'flex', fontSize: 17, fontWeight: 700, color, lineHeight: 1.3 }, children: sh(text, 55) } }
          ]
        }
      }
    }

    // Helper: section card
    function sectionCard(title: string, x: number, y: number, w: number, h: number, children: any) {
      return {
        type: 'div',
        props: {
          style: { display: 'flex', flexDirection: 'column', position: 'absolute', left: x, top: y, width: w, height: h, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
          children: [
            { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, letterSpacing: 1, marginBottom: 14 }, children: title } },
            children
          ]
        }
      }
    }

    const imageEl = selfie
      ? { type: 'img', props: { src: selfie, width: 330, height: 290, style: { borderRadius: 18, border: `1px solid ${BORDER}` } } }
      : { type: 'div', props: { style: { display: 'flex', width: 330, height: 290, borderRadius: 18, background: '#efe2c4', border: `1px solid ${BORDER}`, alignItems: 'center', justifyContent: 'center' }, children: { type: 'div', props: { style: { display: 'flex', fontSize: 22, color: MUTED, fontWeight: 800 }, children: 'SELFIE' } } } }

    const root = {
      type: 'div',
      props: {
        style: { display: 'flex', flexDirection: 'column', width: W, height: H, background: BG, position: 'relative' },
        children: [
          // Header
          { type: 'div', props: {
            style: { display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', padding: '44px 64px 0 64px' },
            children: [
              { type: 'div', props: {
                style: { display: 'flex', flexDirection: 'column' },
                children: [
                  { type: 'div', props: { style: { display: 'flex', fontSize: 42, fontWeight: 900, color: GREEN, letterSpacing: 2 }, children: 'ASKGOGO SKIN CHECK' } },
                  { type: 'div', props: { style: { display: 'flex', fontSize: 13, fontWeight: 900, color: MUTED, letterSpacing: 4, marginTop: 4 }, children: 'VISUAL SKINCARE OBSERVATION' } }
                ]
              }},
              { type: 'div', props: { style: { display: 'flex', fontSize: 20, fontWeight: 900, color: GREEN }, children: dateStr } }
            ]
          }},

          // Row 1: selfie + face map
          { type: 'div', props: {
            style: { display: 'flex', flexDirection: 'row', padding: '18px 54px 0 54px', gap: 20 },
            children: [
              // Selfie card
              { type: 'div', props: {
                style: { display: 'flex', flexDirection: 'column', width: 390, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
                children: [
                  { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, marginBottom: 14 }, children: 'Selfie preview' } },
                  imageEl
                ]
              }},
              // Face map card
              { type: 'div', props: {
                style: { display: 'flex', flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
                children: [
                  { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, marginBottom: 14 }, children: 'Face map' } },
                  { type: 'div', props: {
                    style: { display: 'flex', flexDirection: 'column', gap: 10 },
                    children: [
                      { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', gap: 8 },
                        children: [
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 800, color: GOLD, width: 130 }, children: 'FOREHEAD' } },
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 700, color: GREEN }, children: forehead } }
                        ]
                      }},
                      { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', gap: 8 },
                        children: [
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 800, color: GOLD, width: 130 }, children: 'UNDER-EYE' } },
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 700, color: GREEN }, children: undereye } }
                        ]
                      }},
                      { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', gap: 8 },
                        children: [
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 800, color: GOLD, width: 130 }, children: 'CHEEKS' } },
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 700, color: GREEN }, children: cheeks } }
                        ]
                      }},
                      { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', gap: 8 },
                        children: [
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 800, color: GOLD, width: 130 }, children: 'NOSE/T-ZONE' } },
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 700, color: GREEN }, children: tzone } }
                        ]
                      }},
                      { type: 'div', props: { style: { display: 'flex', flexDirection: 'row', gap: 8 },
                        children: [
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 800, color: GOLD, width: 130 }, children: 'CHIN/JAWLINE' } },
                          { type: 'div', props: { style: { display: 'flex', fontSize: 14, fontWeight: 700, color: GREEN }, children: chin } }
                        ]
                      }}
                    ]
                  }}
                ]
              }}
            ]
          }},

          // Row 2: At a glance metrics
          { type: 'div', props: {
            style: { display: 'flex', flexDirection: 'row', padding: '14px 54px 0 54px' },
            children: { type: 'div', props: {
              style: { display: 'flex', flexDirection: 'column', width: '100%', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
              children: [
                { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, marginBottom: 14 }, children: 'At a glance' } },
                { type: 'div', props: {
                  style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between' },
                  children: [
                    metricBox('SKIN TYPE', skinType),
                    metricBox('OILINESS', oiliness),
                    metricBox('TEXTURE', texture),
                    metricBox('HYDRATION', `${hydration}%`),
                    metricBox('BARRIER', `${barrier}%`),
                    metricBox('SENSITIVITY', sensitivity),
                    metricBox('CONFIDENCE', confidence),
                  ]
                }}
              ]
            }}
          }},

          // Row 3: Metrics bars
          { type: 'div', props: {
            style: { display: 'flex', flexDirection: 'row', padding: '14px 54px 0 54px' },
            children: { type: 'div', props: {
              style: { display: 'flex', flexDirection: 'column', width: '100%', background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
              children: [
                { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, marginBottom: 14 }, children: 'Skin metrics' } },
                { type: 'div', props: {
                  style: { display: 'flex', flexDirection: 'row', gap: 60 },
                  children: [
                    { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', flex: 1 }, children: [barRow('Hydration', hydration), barRow('Barrier', barrier)] } },
                    { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', flex: 1 }, children: [
                      barRow('Oil balance', oiliness.toLowerCase().includes('high') ? 78 : oiliness.toLowerCase().includes('mod') ? 54 : 32),
                      barRow('Sensitivity', sensitivity.toLowerCase().includes('high') ? 75 : sensitivity.toLowerCase().includes('mod') ? 50 : 25)
                    ]}}
                  ]
                }}
              ]
            }}
          }},

          // Row 4: Observations + Cautions
          { type: 'div', props: {
            style: { display: 'flex', flexDirection: 'row', padding: '14px 54px 0 54px', gap: 20 },
            children: [
              { type: 'div', props: {
                style: { display: 'flex', flexDirection: 'column', flex: 2, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
                children: [
                  { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, marginBottom: 12 }, children: 'Key observations' } },
                  { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: obs.map(o => bul(o)) } }
                ]
              }},
              { type: 'div', props: {
                style: { display: 'flex', flexDirection: 'column', flex: 1, background: '#fff7f3', border: '1px solid #d7b6a9', borderRadius: 24, padding: 22 },
                children: [
                  { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: '#6e322f', marginBottom: 12 }, children: 'Avoid this week' } },
                  { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: cautions.map(c => bul(c, '#6e322f')) } }
                ]
              }}
            ]
          }},

          // Row 5: AM + PM routine
          { type: 'div', props: {
            style: { display: 'flex', flexDirection: 'row', padding: '14px 54px 0 54px', gap: 20 },
            children: [
              { type: 'div', props: {
                style: { display: 'flex', flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
                children: [
                  { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, marginBottom: 12 }, children: 'Personalized AM' } },
                  { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: am.map((a, i) => ({ type: 'div', props: { style: { display: 'flex', fontSize: 16, fontWeight: 700, color: GREEN, marginBottom: 8 }, children: `${i + 1}. ${sh(a, 45)}` } })) } }
                ]
              }},
              { type: 'div', props: {
                style: { display: 'flex', flexDirection: 'column', flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 24, padding: 22 },
                children: [
                  { type: 'div', props: { style: { display: 'flex', fontSize: 19, fontWeight: 900, color: GREEN, marginBottom: 12 }, children: 'Personalized PM' } },
                  { type: 'div', props: { style: { display: 'flex', flexDirection: 'column' }, children: pm.map((p, i) => ({ type: 'div', props: { style: { display: 'flex', fontSize: 16, fontWeight: 700, color: GREEN, marginBottom: 8 }, children: `${i + 1}. ${sh(p, 45)}` } })) } }
                ]
              }}
            ]
          }},

          // Footer
          { type: 'div', props: {
            style: { display: 'flex', padding: '14px 74px 0 74px', fontSize: 13, fontWeight: 700, color: MUTED, lineHeight: 1.3 },
            children: 'Not medical advice. For painful acne, rashes, infection, sudden pigmentation, or changing moles — consult a dermatologist.'
          }}
        ]
      }
    }

    return new ImageResponse(root as any, {
      width: W,
      height: H,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    })

  } catch (err: any) {
    console.error('[skin-report-card] failed:', err?.message)
    return new NextResponse('Failed: ' + err?.message, { status: 500 })
  }
}
