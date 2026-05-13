import React from 'react'
import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const CARD_WIDTH = 1080
const CARD_HEIGHT = 1350

function clean(value: any, fallback = '-') {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim()
  return output || fallback
}

function short(value: any, max = 52, fallback = '-') {
  const output = clean(value, fallback)
  return output.length > max ? `${output.slice(0, max - 3).trim()}...` : output
}

function score(report: any, key: string, fallback: string | number = '-') {
  return report?.scores_json?.[key] ?? fallback
}

function scorePercent(value: any, fallback = 65) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function zone(report: any, key: string, fallback = '-') {
  return report?.face_zones_json?.[key] ?? fallback
}

function list(items: any[], limit: number, fallback: string[] = []) {
  const values = (items || [])
    .map((item) => clean(item, ''))
    .filter(Boolean)
    .slice(0, limit)

  return values.length ? values : fallback.slice(0, limit)
}

function h(type: string, props: any, ...children: React.ReactNode[]) {
  return React.createElement(type, props, ...children)
}

function text(value: React.ReactNode, style: React.CSSProperties = {}) {
  return h('div', { style }, value)
}

function card(title: string, style: React.CSSProperties, children: React.ReactNode) {
  return h(
    'div',
    {
      style: {
        position: 'absolute',
        borderRadius: 28,
        background: '#ffffff',
        border: '1px solid #d8c28e',
        padding: 26,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...style,
      },
    },
    text(title, {
      color: '#173a31',
      fontSize: 22,
      fontWeight: 900,
      letterSpacing: 1.1,
      marginBottom: 16,
    }),
    children
  )
}

function bullet(value: string, color = '#173a31') {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
        width: '100%',
      },
    },
    h('div', {
      style: {
        width: 8,
        height: 8,
        borderRadius: 99,
        background: '#c69a50',
        marginTop: 9,
        marginRight: 12,
        flexShrink: 0,
      },
    }),
    text(short(value, 58), {
      color,
      fontSize: 19,
      fontWeight: 700,
      lineHeight: 1.25,
    })
  )
}

function metric(label: string, value: string) {
  return h(
    'div',
    {
      style: {
        width: 128,
        height: 86,
        borderRadius: 18,
        background: '#fff8ea',
        border: '1px solid #dcc99d',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 8,
      },
    },
    text(label, {
      color: '#8b7650',
      fontSize: 11,
      fontWeight: 900,
      letterSpacing: 0.7,
      textAlign: 'center',
    }),
    text(short(value, 16), {
      color: '#173a31',
      fontSize: 18,
      fontWeight: 900,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 1.1,
    })
  )
}

function bar(label: string, percent: number) {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 18,
        width: '100%',
      },
    },
    text(label, {
      color: '#173a31',
      fontSize: 19,
      fontWeight: 800,
      width: 180,
    }),
    h('div', {
      style: {
        width: 250,
        height: 17,
        borderRadius: 99,
        background: '#e5d7bc',
        overflow: 'hidden',
      },
    }, h('div', {
      style: {
        width: Math.max(12, Math.round((percent / 100) * 250)),
        height: 17,
        borderRadius: 99,
        background: '#2f9b80',
      },
    })),
    text(`${percent}%`, {
      color: '#173a31',
      fontSize: 19,
      fontWeight: 900,
      marginLeft: 16,
    })
  )
}

function routine(items: string[]) {
  return h(
    'div',
    { style: { display: 'flex', flexDirection: 'column' } },
    ...items.slice(0, 4).map((item, index) =>
      text(`${index + 1}. ${short(item, 42)}`, {
        color: '#173a31',
        fontSize: 19,
        fontWeight: 750,
        lineHeight: 1.25,
        marginBottom: 10,
      })
    )
  )
}

async function getImageDataUrl(report: any) {
  if (!report?.image_url) return null

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    if (!accountSid || !authToken) return null

    const auth = btoa(`${accountSid}:${authToken}`)
    const res = await fetch(report.image_url, {
      headers: { Authorization: `Basic ${auth}` },
    })
    if (!res.ok) {
      console.warn('[skin-report-card] selfie fetch failed:', res.status, '- using placeholder')
      return null
    }
    const arrayBuffer = await res.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    bytes.forEach(b => binary += String.fromCharCode(b))
    const b64 = btoa(binary)
    return `data:image/jpeg;base64,${b64}`
  } catch (error: any) {
    console.error('[skin-report-card] selfie embed failed:', error?.message || error)
    return null
  }
}

async function buildPngCard(report: any) {
  const selfie = await getImageDataUrl(report)
  const hydration = scorePercent(score(report, 'hydration', 70), 70)
  const barrier = scorePercent(score(report, 'barrier_support', 65), 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const sensitivity = short(score(report, 'sensitivity', 'low'), 16)
  const skinType = short(report.skin_type || 'Combination', 22)
  const confidence = short(report.confidence_level || 'medium', 14)

  const observations = list(report.observations_json || [], 4, [
    'Slight shine visible on forehead and T-zone',
    'Mild darkness visible under the eyes',
    'Overall skin tone appears even',
    'Skin barrier appears reasonably stable',
  ])

  const cautions = list(report.cautions_json || [], 4, [
    'Avoid harsh scrubs',
    'Avoid over-exfoliating',
    'Avoid skipping sunscreen',
    'Avoid heavy fragrance this week',
  ])

  const am = list(report.am_routine_json || [], 4, [
    'Gentle cleanser',
    'Hydrating serum',
    'Light moisturiser',
    'SPF 50 sunscreen',
  ])

  const pm = list(report.pm_routine_json || [], 4, [
    'Gentle cleanser',
    'Niacinamide serum',
    'Barrier serum',
    'Light moisturiser',
  ])

  const forehead = short(zone(report, 'forehead', 'Slight shine visible'), 30)
  const underEye = short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'Mild darkness visible', 30)
  const cheeks = short(zone(report, 'cheeks', 'Even tone observed'), 30)
  const tzone = short(zone(report, 'nose_t-zone') || zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || 'Mild oiliness visible', 30)
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'Balanced / smooth', 30)

  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const root = h(
    'div',
    {
      style: {
        position: 'relative',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        background: '#f7f0df',
        fontFamily: 'Arial, sans-serif',
        overflow: 'hidden',
      },
    },
    h('div', { style: { position: 'absolute', width: 620, height: 620, borderRadius: 999, right: -260, top: -260, background: '#dfd0a8', opacity: 0.55 } }),
    h('div', { style: { position: 'absolute', width: 520, height: 520, borderRadius: 999, left: -260, bottom: -250, background: '#dfd0a8', opacity: 0.45 } }),

    text('ASKGOGO SKIN CHECK', {
      position: 'absolute',
      left: 64,
      top: 48,
      color: '#173a31',
      fontSize: 46,
      fontWeight: 900,
      letterSpacing: 2.5,
    }),
    text('VISUAL SKINCARE OBSERVATION', {
      position: 'absolute',
      left: 66,
      top: 104,
      color: '#8b7650',
      fontSize: 15,
      fontWeight: 900,
      letterSpacing: 4,
    }),
    text(dateLabel, {
      position: 'absolute',
      right: 72,
      top: 56,
      color: '#173a31',
      fontSize: 22,
      fontWeight: 900,
    }),

    card('Selfie preview', { left: 54, top: 150, width: 396, height: 392 },
      selfie
        ? h('img', {
            src: selfie,
            style: {
              width: 336,
              height: 292,
              borderRadius: 22,
              objectFit: 'cover',
              border: '1px solid #c7ad75',
            },
          })
        : h('div', {
            style: {
              width: 336,
              height: 292,
              borderRadius: 22,
              background: '#efe2c4',
              border: '1px solid #c7ad75',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#8b7650',
              fontSize: 24,
              fontWeight: 900,
            },
          }, 'SELFIE')
    ),

    card('Facial map', { left: 474, top: 150, width: 552, height: 392 },
      h('div', { style: { display: 'flex', flexDirection: 'row' } },
        h('div', {
          style: {
            width: 198,
            height: 260,
            borderRadius: 22,
            background: '#efe2c4',
            border: '1px solid #c7ad75',
            position: 'relative',
            overflow: 'hidden',
          },
        },
          selfie && h('img', { src: selfie, style: { width: 198, height: 260, objectFit: 'cover', opacity: 0.88 } }),
          h('div', { style: { position: 'absolute', left: 52, top: 35, width: 96, height: 34, borderRadius: 99, background: 'rgba(224,165,78,.30)', border: '1px solid rgba(184,138,74,.6)' } }),
          h('div', { style: { position: 'absolute', left: 26, top: 112, width: 58, height: 44, borderRadius: 99, background: 'rgba(121,167,199,.28)' } }),
          h('div', { style: { position: 'absolute', right: 26, top: 112, width: 58, height: 44, borderRadius: 99, background: 'rgba(121,167,199,.28)' } }),
          h('div', { style: { position: 'absolute', left: 78, top: 90, width: 42, height: 112, borderRadius: 99, background: 'rgba(201,154,93,.20)' } })
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', marginLeft: 22, marginTop: 2 } },
          bullet(`Forehead: ${forehead}`),
          bullet(`Under-eye: ${underEye}`),
          bullet(`Cheeks: ${cheeks}`),
          bullet(`Nose / T-zone: ${tzone}`),
          bullet(`Chin / Jawline: ${chin}`)
        )
      )
    ),

    card('At a glance', { left: 54, top: 570, width: 972, height: 140 },
      h('div', { style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '100%' } },
        metric('SKIN TYPE', skinType),
        metric('OILINESS', oiliness),
        metric('TEXTURE', texture),
        metric('HYDRATION', `${hydration}%`),
        metric('BARRIER', `${barrier}%`),
        metric('SENSITIVITY', sensitivity),
        metric('CONFIDENCE', confidence)
      )
    ),

    card('Skin metrics', { left: 54, top: 735, width: 972, height: 155 },
      h('div', { style: { display: 'flex', flexDirection: 'row', gap: 60 } },
        h('div', { style: { display: 'flex', flexDirection: 'column', width: 450 } },
          bar('Hydration', hydration),
          bar('Barrier support', barrier)
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', width: 390 } },
          bar('Oil balance', oiliness.toLowerCase().includes('high') ? 75 : oiliness.toLowerCase().includes('moderate') ? 55 : 35),
          bar('Sensitivity', sensitivity.toLowerCase().includes('high') ? 75 : sensitivity.toLowerCase().includes('moderate') ? 52 : 28)
        )
      )
    ),

    card('Key observations', { left: 54, top: 915, width: 612, height: 188 },
      h('div', { style: { display: 'flex', flexDirection: 'column' } }, ...observations.map((item) => bullet(item)))
    ),

    card('Avoid this week', { left: 690, top: 915, width: 336, height: 188, background: '#fff7f3', border: '1px solid #d7b6a9' },
      h('div', { style: { display: 'flex', flexDirection: 'column' } }, ...cautions.map((item) => bullet(item, '#6e322f')))
    ),

    card('Personalized AM', { left: 54, top: 1128, width: 472, height: 160 }, routine(am)),
    card('Personalized PM', { left: 554, top: 1128, width: 472, height: 160 }, routine(pm)),

    text('Not medical advice. For painful acne, irritation, rashes, infection, sudden pigmentation, bleeding or changing moles, consult a dermatologist.', {
      position: 'absolute',
      left: 74,
      right: 74,
      bottom: 28,
      color: '#8b7650',
      fontSize: 14,
      fontWeight: 900,
      lineHeight: 1.25,
    })
  )

  return new ImageResponse(root, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const { data: report, error } = await getSupabase()
      .from('skin_check_reports')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('[skin-report-card] fetch failed:', error.message)
      return new NextResponse('Skin report failed to load', { status: 500 })
    }

    if (!report) {
      return new NextResponse('Skin report not found', { status: 404 })
    }

    return await buildPngCard(report)
  } catch (error: any) {
    console.error('[skin-report-card] route failed:', error?.message || error)
    return new NextResponse('Skin report failed to render', { status: 500 })
  }
}
