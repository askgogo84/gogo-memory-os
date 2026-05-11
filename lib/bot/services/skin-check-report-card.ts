import React from 'react'
import { ImageResponse } from 'next/og'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLatestSkinChecks } from '@/lib/bot/services/skin-check-storage'

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350

export function isSkinReportCardCommand(text: string) {
  const lower = (text || '')
    .toLowerCase()
    .replace(/[*_~`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const compact = lower.replace(/\s+/g, '')

  return (
    lower.includes('skin report card') ||
    lower.includes('create skin report card') ||
    lower.includes('generate skin report card') ||
    lower.includes('visual skin report') ||
    lower.includes('share skin report') ||
    compact.includes('skinreportcard') ||
    compact.includes('createskinreportcard') ||
    compact.includes('generateskinreportcard') ||
    compact.includes('visualskinreport')
  )
}

function clean(value: any, fallback = '-') {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim()
  return output || fallback
}

function short(value: any, max = 42, fallback = '-') {
  const output = clean(value, fallback)
  return output.length > max ? `${output.slice(0, max - 3).trim()}...` : output
}

function score(report: any, key: string, fallback: string | number = '-') {
  return report?.scores_json?.[key] ?? fallback
}

function zone(report: any, key: string, fallback = '-') {
  return report?.face_zones_json?.[key] ?? fallback
}

function scorePercent(value: any, fallback = 65) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function list(items: any[], limit: number, fallback: string[] = []) {
  const values = (items || [])
    .map((item) => clean(item, ''))
    .filter(Boolean)
    .slice(0, limit)

  return values.length ? values : fallback.slice(0, limit)
}

function levelPercent(value: any, fallback = 50) {
  const lower = clean(value, '').toLowerCase()

  if (
    lower.includes('high') ||
    lower.includes('oily') ||
    lower.includes('visible') ||
    lower.includes('strong')
  ) {
    return 75
  }

  if (
    lower.includes('moderate') ||
    lower.includes('mild') ||
    lower.includes('medium')
  ) {
    return 52
  }

  if (
    lower.includes('low') ||
    lower.includes('smooth') ||
    lower.includes('clear') ||
    lower.includes('balanced')
  ) {
    return 28
  }

  return fallback
}

function box(children: React.ReactNode, style: React.CSSProperties) {
  return React.createElement('div', { style }, children)
}

function txt(children: React.ReactNode, style?: React.CSSProperties) {
  return React.createElement('div', { style }, children)
}

function sectionCard(
  title: string,
  x: number,
  y: number,
  w: number,
  h: number,
  children: React.ReactNode
) {
  return box(
    [
      txt(title, {
        color: '#c59a60',
        fontSize: 18,
        fontWeight: 900,
        letterSpacing: 1.4,
      }),
      box(children, {
        display: 'flex',
        flexDirection: 'column',
        marginTop: 14,
      }),
    ],
    {
      position: 'absolute',
      left: x,
      top: y,
      width: w,
      height: h,
      borderRadius: 20,
      background: '#111210',
      border: '1px solid #2b2d29',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }
  )
}

function metricCard(label: string, value: string) {
  return box(
    [
      txt(label, {
        color: '#8a816f',
        fontSize: 11,
        fontWeight: 900,
        textAlign: 'center',
        letterSpacing: 0.8,
      }),
      txt(value, {
        color: '#e8decb',
        fontSize: 15,
        fontWeight: 900,
        textAlign: 'center',
        lineHeight: 1.15,
        marginTop: 8,
      }),
    ],
    {
      width: 106,
      height: 84,
      borderRadius: 12,
      background: '#161715',
      border: '1px solid #2f312d',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    }
  )
}

function miniBullet(textValue: string, color = '#c59a60') {
  return box(
    [
      box(null, {
        width: 6,
        height: 6,
        borderRadius: 99,
        background: color,
        marginTop: 7,
        marginRight: 8,
        flexShrink: 0,
      }),
      txt(textValue, {
        color: '#dfd3bc',
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1.3,
      }),
    ],
    {
      display: 'flex',
      flexDirection: 'row',
      marginBottom: 7,
      width: '100%',
    }
  )
}

function pillTitle(textValue: string) {
  return txt(textValue, {
    color: '#d5b279',
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: 1,
  })
}

function slider(
  label: string,
  percent: number,
  leftLabel: string,
  rightLabel: string,
  color: string
) {
  const trackWidth = 152
  const knobLeft = 10 + Math.round(((trackWidth - 20) * percent) / 100)

  return box(
    [
      txt(label, {
        color: '#b48c58',
        fontSize: 13,
        fontWeight: 900,
        textAlign: 'center',
      }),
      box(
        [
          box(null, {
            position: 'absolute',
            left: 0,
            top: 7,
            width: trackWidth,
            height: 3,
            borderRadius: 99,
            background: '#5a5348',
          }),
          box(null, {
            position: 'absolute',
            left: knobLeft,
            top: 1,
            width: 14,
            height: 14,
            borderRadius: 99,
            background: color,
          }),
        ],
        {
          position: 'relative',
          width: trackWidth,
          height: 16,
          marginTop: 8,
        }
      ),
      box(
        [
          txt(leftLabel, {
            color: '#7f7b72',
            fontSize: 9,
            fontWeight: 700,
          }),
          txt(rightLabel, {
            color: '#7f7b72',
            fontSize: 9,
            fontWeight: 700,
          }),
        ],
        {
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          width: trackWidth,
          marginTop: 2,
        }
      ),
    ],
    {
      width: 165,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }
  )
}

function simpleConcern(label: string, active?: boolean) {
  return box(
    [
      box(label.charAt(0), {
        width: 42,
        height: 42,
        borderRadius: 99,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: active ? '#221c16' : '#131513',
        border: `1px solid ${active ? '#b48c58' : '#393b36'}`,
        color: active ? '#c59a60' : '#8a8f89',
        fontSize: 18,
        fontWeight: 900,
      }),
      txt(label, {
        color: active ? '#c8a16a' : '#8a8f89',
        fontSize: 10,
        fontWeight: 900,
        textAlign: 'center',
        marginTop: 7,
      }),
    ],
    {
      width: 78,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }
  )
}

function faceMapGraphic() {
  return box(
    [
      box(null, {
        position: 'absolute',
        left: 100,
        top: 22,
        width: 150,
        height: 220,
        borderRadius: 999,
        background: '#8e624a',
      }),
      box(null, {
        position: 'absolute',
        left: 88,
        top: 8,
        width: 175,
        height: 58,
        borderRadius: 999,
        background: '#2b221d',
      }),
      box(null, {
        position: 'absolute',
        left: 122,
        top: 84,
        width: 38,
        height: 12,
        borderRadius: 99,
        background: '#1a1614',
      }),
      box(null, {
        position: 'absolute',
        left: 189,
        top: 84,
        width: 38,
        height: 12,
        borderRadius: 99,
        background: '#1a1614',
      }),
      box(null, {
        position: 'absolute',
        left: 168,
        top: 124,
        width: 16,
        height: 44,
        borderRadius: 99,
        background: '#755041',
      }),
      box(null, {
        position: 'absolute',
        left: 143,
        top: 186,
        width: 68,
        height: 10,
        borderRadius: 99,
        background: '#3a2320',
      }),
      box(null, {
        position: 'absolute',
        left: 127,
        top: 66,
        width: 96,
        height: 38,
        borderRadius: 99,
        background: 'rgba(223,177,103,0.25)',
        border: '1px solid rgba(223,177,103,0.4)',
      }),
      box(null, {
        position: 'absolute',
        left: 95,
        top: 118,
        width: 62,
        height: 44,
        borderRadius: 99,
        background: 'rgba(123,168,199,0.20)',
        border: '1px solid rgba(123,168,199,0.35)',
      }),
      box(null, {
        position: 'absolute',
        left: 194,
        top: 118,
        width: 62,
        height: 44,
        borderRadius: 99,
        background: 'rgba(123,168,199,0.20)',
        border: '1px solid rgba(123,168,199,0.35)',
      }),
      box(null, {
        position: 'absolute',
        left: 161,
        top: 112,
        width: 28,
        height: 86,
        borderRadius: 99,
        background: 'rgba(201,154,93,0.18)',
      }),
      box(null, {
        position: 'absolute',
        left: 128,
        top: 208,
        width: 96,
        height: 34,
        borderRadius: 99,
        background: 'rgba(125,159,102,0.22)',
        border: '1px solid rgba(125,159,102,0.38)',
      }),
    ],
    {
      position: 'relative',
      width: 350,
      height: 250,
      borderRadius: 18,
      background: 'linear-gradient(135deg, #352821, #141514)',
      border: '1px solid #5a4430',
      overflow: 'hidden',
    }
  )
}

function routineStep(title: string, tag: string) {
  return box(
    [
      box(null, {
        width: 40,
        height: 52,
        borderRadius: 10,
        background: '#d9cfbd',
        border: '1px solid #9f9277',
      }),
      txt(short(title, 18), {
        color: '#ddd2be',
        fontSize: 10,
        fontWeight: 800,
        textAlign: 'center',
        lineHeight: 1.1,
        marginTop: 8,
      }),
      box(tag, {
        marginTop: 6,
        borderRadius: 99,
        background: '#b7925d',
        color: '#121411',
        fontSize: 9,
        fontWeight: 900,
        padding: '3px 8px',
      }),
    ],
    {
      width: 82,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }
  )
}

function buildSkinReportCardAdvancedImageResponse(report: any) {
  const hydration = scorePercent(score(report, 'hydration', 70), 70)
  const barrier = scorePercent(score(report, 'barrier_support', 65), 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const sensitivity = short(score(report, 'sensitivity', 'low'), 16)
  const skinType = short(report.skin_type || 'Combination', 20)

  const observations = list(report.observations_json || [], 4, [
    'T-zone shine visible',
    'Mild under-eye darkness',
    'Even overall tone',
    'Skin barrier appears stable',
  ])

  const am = list(report.am_routine_json || [], 5, [
    'Gentle cleanser',
    'Hydrating serum',
    'Niacinamide serum',
    'Light moisturizer',
    'SPF 50 sunscreen',
  ])

  const pm = list(report.pm_routine_json || [], 4, [
    'Gentle cleanser',
    'Repair treatment',
    'Barrier serum',
    'Light moisturizer',
  ])

  const cautions = list(report.cautions_json || [], 4, [
    'Harsh exfoliation',
    'Strong acids too often',
    'Stripping cleansers',
    'Heavy fragrance',
  ])

  const forehead = short(zone(report, 'forehead', 'mild texture'), 28)
  const underEye = short(
    zone(report, 'under-eye') || zone(report, 'under_eye') || 'mild darkness',
    28
  )
  const cheeks = short(zone(report, 'cheeks', 'even tone'), 28)
  const tzone = short(
    zone(report, 'nose_t-zone') ||
      zone(report, 'nose___t-zone') ||
      zone(report, 'nose__t-zone') ||
      'visible oiliness',
    28
  )
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'balanced', 28)

  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      })
    : new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      })

  const element = box(
    [
      box(null, {
        position: 'absolute',
        inset: 0,
        background: '#080a09',
      }),

      txt('SKIN ANALYSIS & CONSULTATION', {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 36,
        color: '#c49a61',
        fontSize: 42,
        fontWeight: 700,
        textAlign: 'center',
        letterSpacing: 4,
      }),

      txt('PERSONALIZED SKIN INSIGHTS', {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 90,
        color: '#8b8f89',
        fontSize: 15,
        fontWeight: 800,
        textAlign: 'center',
        letterSpacing: 5,
      }),

      txt(dateLabel, {
        position: 'absolute',
        right: 40,
        top: 42,
        color: '#ceb386',
        fontSize: 18,
        fontWeight: 800,
      }),

      sectionCard('SELFIE PREVIEW', 42, 138, 380, 330, [
        faceMapGraphic(),
      ]),

      sectionCard('FACIAL MAP', 442, 138, 596, 330, [
        box(
          [
            faceMapGraphic(),
            box(
              [
                miniBullet(`Forehead: ${forehead}`),
                miniBullet(`Under-eye: ${underEye}`),
                miniBullet(`Cheeks: ${cheeks}`),
                miniBullet(`Nose / T-zone: ${tzone}`),
                miniBullet(`Chin / Jawline: ${chin}`),
              ],
              {
                display: 'flex',
                flexDirection: 'column',
                width: 205,
                marginLeft: 18,
                marginTop: 4,
              }
            ),
          ],
          {
            display: 'flex',
            flexDirection: 'row',
          }
        ),
      ]),

      sectionCard('AT A GLANCE', 42, 486, 996, 148, [
        box(
          [
            metricCard('SKIN TYPE', skinType),
            metricCard('OILINESS', oiliness),
            metricCard('TEXTURE', texture),
            metricCard('HYDRATION', `${hydration}%`),
            metricCard('BARRIER', `${barrier}%`),
            metricCard('SENSITIVITY', sensitivity),
          ],
          {
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
          }
        ),
      ]),

      sectionCard('CONCERNS', 42, 650, 996, 126, [
        box(
          [
            simpleConcern('TEXTURE', true),
            simpleConcern('REDNESS'),
            simpleConcern('DEHYDRATION', true),
            simpleConcern('FINE LINES'),
            simpleConcern('PORES', true),
            simpleConcern('SENSITIVITY'),
            box(null, {
              width: 1,
              height: 60,
              background: '#2a2c29',
              marginLeft: 6,
              marginRight: 8,
            }),
            slider('TEXTURE', levelPercent(texture, 44), 'SMOOTH', 'UNEVEN', '#c59a60'),
            slider('PORES', levelPercent(tzone, 60), 'SMALL', 'VISIBLE', '#6485b2'),
            slider(
              'SENSITIVITY',
              levelPercent(sensitivity, 32),
              'LOW',
              'HIGH',
              '#c36d67'
            ),
          ],
          {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
          }
        ),
      ]),

      sectionCard('CURRENT VS TARGET BALANCE', 42, 792, 736, 202, [
        box(
          [
            box([faceMapGraphic()], {
              width: 145,
              height: 118,
              overflow: 'hidden',
              borderRadius: 14,
            }),
            box(
              observations.slice(0, 4).map((item) =>
                miniBullet(short(item, 32), '#6b93c5')
              ),
              {
                display: 'flex',
                flexDirection: 'column',
                width: 200,
                marginLeft: 14,
                marginTop: 4,
              }
            ),
            txt('>', {
              color: '#c89a58',
              fontSize: 36,
              fontWeight: 900,
              marginLeft: 8,
              marginRight: 8,
              marginTop: 34,
            }),
            box([faceMapGraphic()], {
              width: 145,
              height: 118,
              overflow: 'hidden',
              borderRadius: 14,
            }),
            box(
              [
                miniBullet('Smoother visible texture'),
                miniBullet('Hydrated glow'),
                miniBullet('Calmer tone'),
                miniBullet('Stronger barrier'),
              ],
              {
                display: 'flex',
                flexDirection: 'column',
                width: 170,
                marginLeft: 14,
                marginTop: 4,
              }
            ),
          ],
          {
            display: 'flex',
            flexDirection: 'row',
          }
        ),
      ]),

      sectionCard('AVOID / CAUTION', 796, 792, 242, 202, [
        box(
          cautions.slice(0, 4).map((item) =>
            box(
              [
                box('!', {
                  width: 30,
                  height: 30,
                  borderRadius: 99,
                  border: '1px solid #6e322f',
                  color: '#d16c60',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 18,
                  fontWeight: 900,
                  marginRight: 10,
                  flexShrink: 0,
                }),
                txt(short(item, 25), {
                  color: '#cf8478',
                  fontSize: 13,
                  fontWeight: 900,
                  lineHeight: 1.15,
                }),
              ],
              {
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 12,
              }
            )
          ),
          {
            display: 'flex',
            flexDirection: 'column',
            marginTop: 2,
          }
        ),
      ]),

      sectionCard('PERSONALIZED ROUTINE', 42, 1010, 996, 230, [
        box(
          [
            pillTitle('AM'),
            routineStep(am[0] || 'Gentle cleanser', 'CLEANSE'),
            routineStep(am[1] || 'Hydrating serum', 'HYDRATE'),
            routineStep(am[2] || 'Niacinamide serum', 'BALANCE'),
            routineStep(am[3] || 'Light moisturizer', 'REPAIR'),
            routineStep(am[4] || 'SPF 50 sunscreen', 'PROTECT'),
          ],
          {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
          }
        ),
        box(
          [
            pillTitle('PM'),
            routineStep(pm[0] || 'Gentle cleanser', 'CLEANSE'),
            routineStep(pm[1] || 'Repair treatment', 'RENEW'),
            routineStep(pm[2] || 'Barrier serum', 'SOOTHE'),
            routineStep(pm[3] || 'Light moisturizer', 'REPAIR'),
          ],
          {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-start',
            marginTop: 20,
          }
        ),
      ]),

      box(
        [
          txt('EXPERT NOTES', {
            color: '#d4a66d',
            fontSize: 15,
            fontWeight: 900,
            letterSpacing: 1.1,
            marginRight: 28,
          }),
          txt('BARRIER FIRST', {
            color: '#baa37f',
            fontSize: 14,
            fontWeight: 900,
            marginRight: 28,
          }),
          txt('HYDRATE DAILY', {
            color: '#baa37f',
            fontSize: 14,
            fontWeight: 900,
            marginRight: 28,
          }),
          txt('PROTECT AM', {
            color: '#baa37f',
            fontSize: 14,
            fontWeight: 900,
            marginRight: 28,
          }),
          txt('CONSISTENCY WINS', {
            color: '#baa37f',
            fontSize: 14,
            fontWeight: 900,
          }),
        ],
        {
          position: 'absolute',
          left: 42,
          bottom: 26,
          width: 996,
          height: 40,
          borderRadius: 12,
          background: '#111210',
          border: '1px solid #2b2d29',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          padding: '0 16px',
        }
      ),
    ],
    {
      position: 'relative',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      display: 'flex',
      background: '#080a09',
      fontFamily: 'Arial, sans-serif',
      overflow: 'hidden',
    }
  )

  return new ImageResponse(element, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  })
}

export async function buildSkinReportCardSafeFallbackImageResponse(report: any) {
  const hydration = score(report, 'hydration', 70)
  const barrier = score(report, 'barrier_support', 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const skinType = short(report.skin_type || 'Combination', 22)

  const observations = list(report.observations_json || [], 4, [
    'T-zone shine visible',
    'Mild under-eye darkness',
    'Even overall tone',
    'Skin barrier appears stable',
  ])

  const am = list(report.am_routine_json || [], 3, [
    'Gentle cleanser',
    'Lightweight moisturizer',
    'SPF 50 sunscreen',
  ])

  const pm = list(report.pm_routine_json || [], 3, [
    'Gentle cleanser',
    'Niacinamide serum',
    'Lightweight moisturizer',
  ])

  const cautions = list(report.cautions_json || [], 3, [
    'Avoid harsh exfoliation',
    'Avoid skipping sunscreen',
    'Avoid heavy pore-clogging creams',
  ])

  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      })
    : new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
      })

  const panelStyle: React.CSSProperties = {
    borderRadius: 28,
    background: '#f2e4c7',
    padding: 30,
    display: 'flex',
    flexDirection: 'column',
  }

  const titleStyle: React.CSSProperties = {
    color: '#173a31',
    fontSize: 24,
    fontWeight: 900,
  }

  const lineStyle: React.CSSProperties = {
    marginTop: 12,
    color: '#173a31',
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.25,
  }

  const element = box(
    [
      box(null, {
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, #071d18 0%, #102620 52%, #050908 100%)',
      }),
      txt('ASKGOGO SKIN CHECK', {
        position: 'absolute',
        top: 56,
        left: 60,
        color: '#e7d4b0',
        fontSize: 40,
        fontWeight: 800,
        letterSpacing: 2,
      }),
      txt('VISUAL SKIN ANALYSIS', {
        position: 'absolute',
        top: 105,
        left: 62,
        color: '#bfae8a',
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 4,
      }),
      txt(dateLabel, {
        position: 'absolute',
        top: 62,
        right: 64,
        color: '#d7c29a',
        fontSize: 20,
        fontWeight: 700,
      }),
      box(
        [
          txt('AT A GLANCE', titleStyle),
          txt(`Skin Type: ${skinType}`, lineStyle),
          txt(`Hydration: ${scorePercent(hydration, 70)} / 100`, lineStyle),
          txt(`Barrier Support: ${scorePercent(barrier, 65)} / 100`, lineStyle),
          txt(`Oiliness: ${oiliness}`, lineStyle),
          txt(`Texture: ${texture}`, lineStyle),
        ],
        { ...panelStyle, position: 'absolute', top: 170, left: 60, width: 450, height: 320 }
      ),
      box(
        [
          txt('KEY OBSERVATIONS', titleStyle),
          ...observations.map((item) => txt(`- ${item}`, lineStyle)),
        ],
        { ...panelStyle, position: 'absolute', top: 170, right: 60, width: 510, height: 320 }
      ),
      box(
        [
          txt('AM ROUTINE', titleStyle),
          ...am.map((item, i) => txt(`${i + 1}. ${item}`, lineStyle)),
        ],
        { ...panelStyle, position: 'absolute', top: 540, left: 60, width: 450, height: 280 }
      ),
      box(
        [
          txt('PM ROUTINE', titleStyle),
          ...pm.map((item, i) => txt(`${i + 1}. ${item}`, lineStyle)),
        ],
        { ...panelStyle, position: 'absolute', top: 540, right: 60, width: 510, height: 280 }
      ),
      box(
        [
          txt('AVOID THIS WEEK', titleStyle),
          ...cautions.map((item) => txt(`- ${item}`, lineStyle)),
        ],
        { ...panelStyle, position: 'absolute', top: 870, left: 60, right: 60, height: 210 }
      ),
      txt(
        'Not medical advice. For painful acne, infection, irritation, rashes, or changing moles, consult a dermatologist.',
        {
          position: 'absolute',
          left: 60,
          right: 60,
          bottom: 60,
          color: '#c7b28d',
          fontSize: 16,
          fontWeight: 600,
          textAlign: 'center',
        }
      ),
    ],
    {
      display: 'flex',
      position: 'relative',
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      fontFamily: 'Arial, sans-serif',
      overflow: 'hidden',
    }
  )

  return new ImageResponse(element, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  })
}

export async function buildSkinReportCardImageResponse(report: any) {
  try {
    return buildSkinReportCardAdvancedImageResponse(report)
  } catch (error: any) {
    console.error(
      '[skin-report-card] advanced renderer failed, using fallback:',
      error?.message || error
    )
    return buildSkinReportCardSafeFallbackImageResponse(report)
  }
}

export async function getSkinCheckReportById(id: string) {
  const { data, error } = await supabaseAdmin
    .from('skin_check_reports')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[skin-report-card] fetch failed:', error.message)
    return null
  }

  return data
}

export async function buildSkinReportCardReply(telegramId?: number) {
  if (!telegramId) {
    return `Skin Report Card\n\nRun skin check first, then say create skin report card.`
  }

  const [latest] = await getLatestSkinChecks(telegramId, 1)

  if (!latest) {
    return `Skin Report Card\n\nNo skin check found yet. Send a clear selfie and type skin check first.`
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
  const mediaUrl = `${appUrl}/api/skin-report-card/${latest.id}`

  return {
    text:
      `Skin Report Card ready\n\n` +
      `I created your visual Skin Check card.\n\n` +
      `Open card:\n${mediaUrl}\n\n` +
      `Tip: take your next selfie in similar lighting for cleaner progress tracking.`,
    mediaUrl,
  }
}