import React from 'react'
import { ImageResponse } from 'next/og'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLatestSkinChecks } from '@/lib/bot/services/skin-check-storage'

export function isSkinReportCardCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'skin report card' ||
    lower === 'create skin report card' ||
    lower === 'generate skin report card' ||
    lower === 'share skin report' ||
    lower === 'visual skin report'
  )
}

function esc(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
}

function text(value: any, fallback = '-') {
  const clean = String(value ?? '').trim()
  return clean || fallback
}

function score(report: any, key: string, fallback: string | number = '-') {
  return report?.scores_json?.[key] ?? fallback
}

function zone(report: any, key: string, fallback = '-') {
  return report?.face_zones_json?.[key] ?? fallback
}

function list(items: any[], limit: number) {
  return (items || []).slice(0, limit).map((item) => String(item))
}

function scorePercent(value: any, fallback = 65) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function svgBullet(items: string[], x: number, startY: number, max = 4) {
  return list(items, max)
    .map((item, index) => `<text x=\"${x}\" y=\"${startY + index * 28}\" class=\"small\">• ${esc(item).slice(0, 72)}</text>`)
    .join('')
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

export function buildSkinReportCardSvg(report: any) {
  const hydration = score(report, 'hydration', 70)
  const barrier = score(report, 'barrier_support', 65)
  const oiliness = score(report, 'oiliness', 'moderate')
  const texture = score(report, 'texture', 'smooth')
  const observations = list(report.observations_json || [], 4)
  const am = list(report.am_routine_json || [], 3)
  const pm = list(report.pm_routine_json || [], 3)
  const cautions = list(report.cautions_json || [], 3)
  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const hydrationWidth = Math.max(20, Math.min(320, Number(hydration) * 3.2 || 210))
  const barrierWidth = Math.max(20, Math.min(320, Number(barrier) * 3.2 || 210))

  return `
<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1080\" height=\"1350\" viewBox=\"0 0 1080 1350\">
  <defs>
    <linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">
      <stop offset=\"0\" stop-color=\"#071d18\"/>
      <stop offset=\"0.52\" stop-color=\"#102620\"/>
      <stop offset=\"1\" stop-color=\"#050908\"/>
    </linearGradient>
    <linearGradient id=\"card\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">
      <stop offset=\"0\" stop-color=\"#fff6e6\" stop-opacity=\"0.98\"/>
      <stop offset=\"1\" stop-color=\"#e7d6b8\" stop-opacity=\"0.95\"/>
    </linearGradient>
    <style>
      .title{font:700 44px Georgia,serif;fill:#e9d7b4;letter-spacing:2px}
      .sub{font:500 17px Arial,sans-serif;fill:#b9a982;letter-spacing:4px}
      .cardTitle{font:700 23px Arial,sans-serif;fill:#15332a;letter-spacing:1px}
      .label{font:700 17px Arial,sans-serif;fill:#285548}
      .small{font:500 20px Arial,sans-serif;fill:#173a31}
      .tiny{font:500 16px Arial,sans-serif;fill:#43665c}
      .score{font:800 38px Arial,sans-serif;fill:#0f3329}
      .pill{font:700 18px Arial,sans-serif;fill:#e9d7b4}
      .white{fill:#fff7e7}
    </style>
  </defs>
  <rect width=\"1080\" height=\"1350\" fill=\"url(#bg)\"/>
  <circle cx=\"920\" cy=\"160\" r=\"260\" fill=\"#0f8f67\" opacity=\"0.14\"/>
  <circle cx=\"100\" cy=\"1260\" r=\"300\" fill=\"#d8b76b\" opacity=\"0.09\"/>

  <text x=\"70\" y=\"88\" class=\"title\">ASKGOGO SKIN CHECK</text>
  <text x=\"73\" y=\"124\" class=\"sub\">VISUAL SKINCARE OBSERVATION</text>
  <text x=\"830\" y=\"92\" class=\"pill\">${esc(dateLabel)}</text>

  <rect x=\"60\" y=\"165\" width=\"960\" height=\"1110\" rx=\"34\" fill=\"url(#card)\" stroke=\"#d5bd84\" stroke-width=\"2\"/>

  <text x=\"100\" y=\"225\" class=\"cardTitle\">1. At a glance</text>
  <rect x=\"100\" y=\"255\" width=\"270\" height=\"132\" rx=\"22\" fill=\"#f8efd9\" stroke=\"#d1bd8a\"/>
  <text x=\"126\" y=\"292\" class=\"tiny\">SKIN TYPE INDICATOR</text>
  <text x=\"126\" y=\"332\" class=\"small\">${esc(report.skin_type || 'Not captured').slice(0, 28)}</text>
  <text x=\"126\" y=\"362\" class=\"tiny\">Based on visible selfie cues</text>

  <rect x=\"405\" y=\"255\" width=\"270\" height=\"132\" rx=\"22\" fill=\"#f8efd9\" stroke=\"#d1bd8a\"/>
  <text x=\"431\" y=\"292\" class=\"tiny\">OILINESS</text>
  <text x=\"431\" y=\"342\" class=\"score\">${esc(oiliness).slice(0, 10)}</text>

  <rect x=\"710\" y=\"255\" width=\"270\" height=\"132\" rx=\"22\" fill=\"#f8efd9\" stroke=\"#d1bd8a\"/>
  <text x=\"736\" y=\"292\" class=\"tiny\">TEXTURE</text>
  <text x=\"736\" y=\"342\" class=\"score\">${esc(texture).slice(0, 10)}</text>

  <text x=\"100\" y=\"452\" class=\"cardTitle\">2. Skin scores</text>
  <rect x=\"100\" y=\"482\" width=\"420\" height=\"145\" rx=\"24\" fill=\"#f8efd9\" stroke=\"#d1bd8a\"/>
  <text x=\"130\" y=\"530\" class=\"label\">Hydration</text>
  <rect x=\"130\" y=\"558\" width=\"320\" height=\"16\" rx=\"8\" fill=\"#e0cfaa\"/>
  <rect x=\"130\" y=\"558\" width=\"${hydrationWidth}\" height=\"16\" rx=\"8\" fill=\"#2e8f75\"/>
  <text x=\"458\" y=\"578\" class=\"small\">${esc(hydration)}/100</text>

  <rect x=\"560\" y=\"482\" width=\"420\" height=\"145\" rx=\"24\" fill=\"#f8efd9\" stroke=\"#d1bd8a\"/>
  <text x=\"590\" y=\"530\" class=\"label\">Barrier support</text>
  <rect x=\"590\" y=\"558\" width=\"320\" height=\"16\" rx=\"8\" fill=\"#e0cfaa\"/>
  <rect x=\"590\" y=\"558\" width=\"${barrierWidth}\" height=\"16\" rx=\"8\" fill=\"#c2994b\"/>
  <text x=\"918\" y=\"578\" class=\"small\">${esc(barrier)}/100</text>

  <text x=\"100\" y=\"697\" class=\"cardTitle\">3. Face map</text>
  <rect x=\"100\" y=\"730\" width=\"880\" height=\"205\" rx=\"24\" fill=\"#f8efd9\" stroke=\"#d1bd8a\"/>
  <text x=\"135\" y=\"778\" class=\"small\">Forehead: ${esc(zone(report, 'forehead')).slice(0, 48)}</text>
  <text x=\"135\" y=\"818\" class=\"small\">Under-eye: ${esc(zone(report, 'under-eye') || zone(report, 'under_eye')).slice(0, 48)}</text>
  <text x=\"135\" y=\"858\" class=\"small\">Cheeks: ${esc(zone(report, 'cheeks')).slice(0, 48)}</text>
  <text x=\"135\" y=\"898\" class=\"small\">T-zone: ${esc(zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || zone(report, 'nose_t-zone')).slice(0, 48)}</text>

  <text x=\"100\" y=\"1006\" class=\"cardTitle\">4. Key observations</text>
  ${svgBullet(observations, 105, 1045, 4)}

  <rect x=\"610\" y=\"980\" width=\"370\" height=\"225\" rx=\"24\" fill=\"#173a31\" opacity=\"0.94\"/>
  <text x=\"640\" y=\"1028\" class=\"white\" style=\"font:700 23px Arial,sans-serif\">Routine focus</text>
  <text x=\"640\" y=\"1072\" class=\"pill\">AM</text>
  ${am.map((item, i) => `<text x=\"690\" y=\"1072\" class=\"pill\" transform=\"translate(0 ${i * 30})\">${i + 1}. ${esc(item).slice(0, 32)}</text>`).join('')}
  <text x=\"640\" y=\"1180\" class=\"pill\">PM</text>
  ${pm.slice(0, 2).map((item, i) => `<text x=\"690\" y=\"1180\" class=\"pill\" transform=\"translate(0 ${i * 30})\">${i + 1}. ${esc(item).slice(0, 32)}</text>`).join('')}

  <text x=\"100\" y=\"1218\" class=\"tiny\">Avoid this week: ${esc(cautions.join(' • ')).slice(0, 100)}</text>
  <text x=\"100\" y=\"1260\" class=\"tiny\">Not medical advice. For irritation, infection, painful acne, rashes or changing moles, consult a dermatologist.</text>
</svg>`.trim()
}

function box(children: React.ReactNode, style: React.CSSProperties) {
  return React.createElement('div', { style }, children)
}

function labelBlock(label: string, value: string, note?: string) {
  return box(
    [
      React.createElement('div', { key: 'label', style: { fontSize: 16, letterSpacing: 2, color: '#46665d', fontWeight: 700 } }, label),
      React.createElement('div', { key: 'value', style: { marginTop: 18, fontSize: 34, color: '#12372e', fontWeight: 800 } }, value),
      note ? React.createElement('div', { key: 'note', style: { marginTop: 12, fontSize: 16, color: '#55776d' } }, note) : null,
    ],
    {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      width: 280,
      height: 138,
      borderRadius: 24,
      background: '#f8efd9',
      border: '2px solid #d1bd8a',
      padding: 26,
    }
  )
}

function progressBlock(title: string, value: any, accent: string) {
  const percent = scorePercent(value)
  return box(
    [
      React.createElement('div', { key: 'title', style: { fontSize: 24, color: '#285548', fontWeight: 800 } }, title),
      box(
        React.createElement('div', {
          style: {
            width: `${percent}%`,
            height: 18,
            borderRadius: 999,
            background: accent,
          },
        }),
        {
          display: 'flex',
          width: 315,
          height: 18,
          borderRadius: 999,
          background: '#e0cfaa',
          marginTop: 26,
        }
      ),
      React.createElement('div', { key: 'score', style: { marginTop: 18, fontSize: 24, color: '#173a31', fontWeight: 800 } }, `${text(value, String(percent))}/100`),
    ],
    {
      display: 'flex',
      flexDirection: 'column',
      width: 410,
      height: 150,
      borderRadius: 26,
      background: '#f8efd9',
      border: '2px solid #d1bd8a',
      padding: 30,
    }
  )
}

function bulletList(items: string[], max = 4) {
  const safeItems = list(items, max)
  if (!safeItems.length) safeItems.push('Keep a consistent routine and compare again in similar lighting.')

  return box(
    safeItems.map((item, index) =>
      React.createElement(
        'div',
        {
          key: `${index}-${item}`,
          style: {
            display: 'flex',
            fontSize: 22,
            lineHeight: 1.35,
            color: '#173a31',
            marginBottom: 12,
          },
        },
        `• ${item.slice(0, 82)}`
      )
    ),
    { display: 'flex', flexDirection: 'column' }
  )
}

export function buildSkinReportCardImageResponse(report: any) {
  const hydration = score(report, 'hydration', 70)
  const barrier = score(report, 'barrier_support', 65)
  const oiliness = text(score(report, 'oiliness', 'moderate')).slice(0, 16)
  const texture = text(score(report, 'texture', 'smooth')).slice(0, 16)
  const skinType = text(report.skin_type, 'Not captured').slice(0, 24)
  const observations = list(report.observations_json || [], 4)
  const am = list(report.am_routine_json || [], 3)
  const pm = list(report.pm_routine_json || [], 2)
  const cautions = list(report.cautions_json || [], 3)
  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const faceMap = [
    `Forehead: ${text(zone(report, 'forehead')).slice(0, 58)}`,
    `Under-eye: ${text(zone(report, 'under-eye') || zone(report, 'under_eye')).slice(0, 58)}`,
    `Cheeks: ${text(zone(report, 'cheeks')).slice(0, 58)}`,
    `T-zone: ${text(zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || zone(report, 'nose_t-zone')).slice(0, 58)}`,
  ]

  const element = box(
    [
      box(null, {
        position: 'absolute',
        width: 520,
        height: 520,
        borderRadius: 999,
        background: '#0f8f67',
        opacity: 0.16,
        right: -160,
        top: -190,
      }),
      box(null, {
        position: 'absolute',
        width: 620,
        height: 620,
        borderRadius: 999,
        background: '#d8b76b',
        opacity: 0.1,
        left: -300,
        bottom: -330,
      }),
      box(
        [
          box(
            [
              React.createElement('div', { key: 'title', style: { fontSize: 46, fontWeight: 800, letterSpacing: 2, color: '#e9d7b4' } }, 'ASKGOGO SKIN CHECK'),
              React.createElement('div', { key: 'sub', style: { marginTop: 12, fontSize: 18, fontWeight: 700, letterSpacing: 4, color: '#b9a982' } }, 'VISUAL SKINCARE OBSERVATION'),
            ],
            { display: 'flex', flexDirection: 'column' }
          ),
          React.createElement('div', { key: 'date', style: { fontSize: 24, color: '#e9d7b4', fontWeight: 800 } }, dateLabel),
        ],
        { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', width: 940 }
      ),
      box(
        [
          React.createElement('div', { key: 'section1', style: { fontSize: 25, fontWeight: 800, color: '#15332a', marginBottom: 24 } }, '1. At a glance'),
          box(
            [
              labelBlock('SKIN TYPE INDICATOR', skinType, 'Based on visible selfie cues'),
              labelBlock('OILINESS', oiliness),
              labelBlock('TEXTURE', texture),
            ],
            { display: 'flex', flexDirection: 'row', gap: 26 }
          ),
          React.createElement('div', { key: 'section2', style: { fontSize: 25, fontWeight: 800, color: '#15332a', marginTop: 46, marginBottom: 24 } }, '2. Skin scores'),
          box(
            [
              progressBlock('Hydration', hydration, '#2e8f75'),
              progressBlock('Barrier support', barrier, '#c2994b'),
            ],
            { display: 'flex', flexDirection: 'row', gap: 40 }
          ),
          React.createElement('div', { key: 'section3', style: { fontSize: 25, fontWeight: 800, color: '#15332a', marginTop: 46, marginBottom: 22 } }, '3. Face map'),
          box(
            faceMap.map((item, index) =>
              React.createElement('div', { key: `${index}-${item}`, style: { fontSize: 22, color: '#173a31', marginBottom: 13 } }, item)
            ),
            {
              display: 'flex',
              flexDirection: 'column',
              width: 880,
              borderRadius: 24,
              background: '#f8efd9',
              border: '2px solid #d1bd8a',
              padding: 28,
            }
          ),
          box(
            [
              box(
                [
                  React.createElement('div', { key: 'obs-title', style: { fontSize: 25, fontWeight: 800, color: '#15332a', marginBottom: 22 } }, '4. Key observations'),
                  bulletList(observations, 4),
                ],
                { display: 'flex', flexDirection: 'column', width: 465 }
              ),
              box(
                [
                  React.createElement('div', { key: 'routine-title', style: { fontSize: 25, fontWeight: 800, color: '#fff7e7', marginBottom: 20 } }, 'Routine focus'),
                  React.createElement('div', { key: 'am-label', style: { fontSize: 20, color: '#e9d7b4', fontWeight: 800, marginBottom: 8 } }, 'AM'),
                  bulletList(am, 3),
                  React.createElement('div', { key: 'pm-label', style: { fontSize: 20, color: '#e9d7b4', fontWeight: 800, marginTop: 8, marginBottom: 8 } }, 'PM'),
                  bulletList(pm, 2),
                ],
                {
                  display: 'flex',
                  flexDirection: 'column',
                  width: 365,
                  borderRadius: 26,
                  background: '#173a31',
                  padding: 30,
                }
              ),
            ],
            { display: 'flex', flexDirection: 'row', gap: 46, marginTop: 44 }
          ),
          React.createElement(
            'div',
            { key: 'avoid', style: { marginTop: 28, fontSize: 17, lineHeight: 1.35, color: '#43665c' } },
            `Avoid this week: ${cautions.join(' • ').slice(0, 112) || 'Avoid harsh scrubs and adding too many actives at once.'}`
          ),
          React.createElement(
            'div',
            { key: 'medical', style: { marginTop: 22, fontSize: 16, lineHeight: 1.35, color: '#43665c' } },
            'Not medical advice. For irritation, infection, painful acne, rashes or changing moles, consult a dermatologist.'
          ),
        ],
        {
          display: 'flex',
          flexDirection: 'column',
          width: 960,
          marginTop: 38,
          borderRadius: 36,
          background: '#f2e3c4',
          border: '2px solid #d5bd84',
          padding: 40,
        }
      ),
    ],
    {
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      width: '100%',
      height: '100%',
      background: 'linear-gradient(135deg, #071d18 0%, #102620 52%, #050908 100%)',
      padding: 62,
      fontFamily: 'Arial, sans-serif',
    }
  )

  return new ImageResponse(element, {
    width: 1080,
    height: 1350,
  })
}

export async function buildSkinReportCardReply(telegramId?: number) {
  if (!telegramId) {
    return `✨ *Skin Report Card*\n\nRun *skin check* first, then say *create skin report card*.`
  }

  const [latest] = await getLatestSkinChecks(telegramId, 1)
  if (!latest) {
    return `✨ *Skin Report Card*\n\nNo skin check found yet. Send a clear selfie and type *skin check* first.`
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
  const mediaUrl = `${appUrl}/api/skin-report-card/${latest.id}`

  return {
    text:
      `✨ *Skin Report Card ready*\n\n` +
      `I created a premium visual summary of your latest Skin Check.\n\n` +
      `Open card:\n${mediaUrl}\n\n` +
      `Tip: take your next selfie in similar lighting for cleaner progress tracking.`,
    mediaUrl,
  }
}
