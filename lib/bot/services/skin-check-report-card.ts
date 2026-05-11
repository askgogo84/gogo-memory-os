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

function clean(value: any, fallback = '-') {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim()
  return output || fallback
}

function short(value: any, max = 42, fallback = '-') {
  const output = clean(value, fallback)
  return output.length > max ? `${output.slice(0, max - 1).trim()}…` : output
}

function score(report: any, key: string, fallback: string | number = '-') {
  return report?.scores_json?.[key] ?? fallback
}

function zone(report: any, key: string, fallback = '-') {
  return report?.face_zones_json?.[key] ?? fallback
}

function list(items: any[], limit: number, fallback: string[] = []) {
  const values = (items || []).map((item) => clean(item, '')).filter(Boolean).slice(0, limit)
  return values.length ? values : fallback.slice(0, limit)
}

function scorePercent(value: any, fallback = 65) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function levelPercent(value: any, fallback = 55) {
  const lower = clean(value, '').toLowerCase()
  if (lower.includes('high') || lower.includes('visible') || lower.includes('oily')) return 72
  if (lower.includes('moderate') || lower.includes('mild')) return 52
  if (lower.includes('low') || lower.includes('smooth') || lower.includes('clear')) return 28
  return fallback
}

function cx(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ')
}

async function getImageDataUrl(url?: string | null) {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await response.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch (error: any) {
    console.error('[skin-report-card] image fetch failed:', error?.message || error)
    return null
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

function box(children: React.ReactNode, style: React.CSSProperties) {
  return React.createElement('div', { style }, children)
}

function Txt(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return React.createElement('div', { style: props.style }, props.children)
}

function SectionTitle(props: { number: string; title: string; dark?: boolean }) {
  return box(
    [
      box(props.number, {
        width: 26,
        height: 26,
        borderRadius: 999,
        background: props.dark ? '#2a2017' : '#efe0bd',
        color: props.dark ? '#c79c5f' : '#7d6033',
        fontSize: 14,
        fontWeight: 900,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 10,
      }),
      Txt({ children: props.title, style: { color: props.dark ? '#d4a66d' : '#654a29', fontSize: 21, fontWeight: 900, letterSpacing: 1.3 } }),
    ],
    { display: 'flex', flexDirection: 'row', alignItems: 'center' }
  )
}

function MiniMetric(props: { icon: string; label: string; value: string; accent?: string }) {
  return box(
    [
      Txt({ children: props.icon, style: { fontSize: 31, color: props.accent || '#c79c5f', lineHeight: 1 } }),
      Txt({ children: props.label, style: { marginTop: 9, color: '#ab8b60', fontSize: 12, fontWeight: 900, letterSpacing: 0.8, textAlign: 'center' } }),
      Txt({ children: props.value, style: { marginTop: 8, color: '#eee4ce', fontSize: 15, fontWeight: 800, textAlign: 'center' } }),
    ],
    {
      width: 115,
      height: 112,
      borderRadius: 13,
      border: '1px solid #3b3327',
      background: '#141513',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 8,
    }
  )
}

function ConcernIcon(props: { icon: string; label: string; active?: boolean }) {
  return box(
    [
      box(props.icon, {
        width: 56,
        height: 56,
        borderRadius: 999,
        border: `2px solid ${props.active ? '#c79c5f' : '#343632'}`,
        color: props.active ? '#d9b376' : '#708077',
        fontSize: 25,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: props.active ? '#241f18' : '#141713',
      }),
      Txt({ children: props.label, style: { marginTop: 9, color: props.active ? '#d7b77b' : '#8a9289', fontSize: 12, fontWeight: 800, textAlign: 'center' } }),
    ],
    { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 92 }
  )
}

function Slider(props: { label: string; left: string; right: string; percent: number; accent?: string }) {
  const percent = Math.max(8, Math.min(92, props.percent))
  return box(
    [
      Txt({ children: props.label, style: { color: '#b38b58', fontSize: 15, fontWeight: 900, letterSpacing: 1 } }),
      box(
        [
          box(null, { width: '100%', height: 3, background: '#5c5143', borderRadius: 999 }),
          box(null, { position: 'absolute', left: `${percent}%`, top: -5, width: 15, height: 15, borderRadius: 999, background: props.accent || '#c79c5f', border: '2px solid #0c0d0c' }),
        ],
        { display: 'flex', position: 'relative', width: 172, height: 18, marginTop: 13, alignItems: 'center' }
      ),
      box(
        [
          Txt({ children: props.left, style: { color: '#827f75', fontSize: 10, fontWeight: 700 } }),
          Txt({ children: props.right, style: { color: '#827f75', fontSize: 10, fontWeight: 700 } }),
        ],
        { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: 172 }
      ),
    ],
    { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 200 }
  )
}

function RoutineStep(props: { icon: string; title: string; tag: string }) {
  return box(
    [
      Txt({ children: props.icon, style: { color: '#e1d8c8', fontSize: 34, lineHeight: 1 } }),
      Txt({ children: short(props.title, 18), style: { marginTop: 8, color: '#d8d0bf', fontSize: 12, fontWeight: 800, textAlign: 'center', lineHeight: 1.15 } }),
      box(short(props.tag, 14), { marginTop: 8, color: '#101613', background: '#b9965f', borderRadius: 999, padding: '4px 10px', fontSize: 10, fontWeight: 900 }),
    ],
    { width: 94, display: 'flex', flexDirection: 'column', alignItems: 'center' }
  )
}

function Arrow() {
  return Txt({ children: '›', style: { color: '#8a6a40', fontSize: 31, fontWeight: 900, marginTop: 9 } })
}

function Bullet(props: { text: string; color?: string; dark?: boolean }) {
  return box(
    [
      box(null, { width: 7, height: 7, borderRadius: 99, background: props.color || '#c79c5f', marginTop: 8, marginRight: 10, flexShrink: 0 }),
      Txt({ children: props.text, style: { color: props.dark ? '#e9dcc5' : '#2c382f', fontSize: props.dark ? 14 : 17, lineHeight: 1.25, fontWeight: 700 } }),
    ],
    { display: 'flex', flexDirection: 'row', marginBottom: 8, width: '100%' }
  )
}

function FacePlaceholder(props: { imageDataUrl?: string | null; small?: boolean }) {
  const width = props.small ? 160 : 362
  const height = props.small ? 178 : 415
  if (props.imageDataUrl) {
    return React.createElement('img', {
      src: props.imageDataUrl,
      width,
      height,
      style: {
        objectFit: 'cover',
        width,
        height,
        borderRadius: props.small ? 18 : 20,
        border: '1px solid #4a3925',
      },
    })
  }

  return box(
    [
      box(null, { position: 'absolute', width: props.small ? 82 : 150, height: props.small ? 110 : 210, borderRadius: '50% 50% 44% 44%', background: '#b88461', top: props.small ? 25 : 60, left: props.small ? 39 : 105, opacity: 0.95 }),
      box(null, { position: 'absolute', width: props.small ? 90 : 168, height: props.small ? 32 : 60, borderRadius: '50%', background: '#2c211c', top: props.small ? 15 : 36, left: props.small ? 35 : 96 }),
      Txt({ children: 'SELFIE', style: { position: 'absolute', bottom: 22, width: '100%', textAlign: 'center', color: '#d4b27a', fontSize: props.small ? 12 : 18, fontWeight: 900, letterSpacing: 2 } }),
    ],
    { position: 'relative', width, height, borderRadius: props.small ? 18 : 20, background: 'linear-gradient(135deg, #32271f, #151514)', border: '1px solid #4a3925', overflow: 'hidden' }
  )
}

function FaceMapOverlay(props: { imageDataUrl?: string | null; faceZones: string[] }) {
  return box(
    [
      FacePlaceholder({ imageDataUrl: props.imageDataUrl, small: false }),
      box(null, { position: 'absolute', top: 92, left: 127, width: 108, height: 47, borderRadius: '50%', background: '#d8a56c', opacity: 0.34, border: '1px solid #dfc292' }),
      box(null, { position: 'absolute', top: 157, left: 98, width: 62, height: 46, borderRadius: '50%', background: '#8bb6c8', opacity: 0.28, border: '1px solid #bdd2d8' }),
      box(null, { position: 'absolute', top: 157, left: 202, width: 62, height: 46, borderRadius: '50%', background: '#8bb6c8', opacity: 0.28, border: '1px solid #bdd2d8' }),
      box(null, { position: 'absolute', top: 150, left: 164, width: 34, height: 106, borderRadius: '42%', background: '#d2a046', opacity: 0.24, border: '1px solid #d9b570' }),
      box(null, { position: 'absolute', top: 260, left: 127, width: 108, height: 42, borderRadius: '50%', background: '#82a978', opacity: 0.28, border: '1px solid #aec59d' }),
      box(null, { position: 'absolute', top: 115, left: 235, width: 92, height: 2, background: '#a88554' }),
      box(null, { position: 'absolute', top: 176, left: 236, width: 92, height: 2, background: '#6b8fb1' }),
      box(null, { position: 'absolute', top: 214, left: 236, width: 92, height: 2, background: '#b77464' }),
      box(null, { position: 'absolute', top: 281, left: 236, width: 92, height: 2, background: '#80a26b' }),
    ],
    { position: 'relative', width: 362, height: 415 }
  )
}

export async function buildSkinReportCardImageResponse(report: any) {
  const hydration = score(report, 'hydration', 70)
  const barrier = score(report, 'barrier_support', 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'mild texture'), 18)
  const skinType = short(report.skin_type || 'Combination', 20)
  const overall = short(report.overall_condition || report.photo_quality || 'Healthy + mildly dehydrated', 23)
  const undertone = short(report.undertone || 'Neutral-warm', 18)
  const imageDataUrl = await getImageDataUrl(report.image_url)

  const observations = list(report.observations_json || [], 4, [
    'T-zone shine and visible oiliness.',
    'Mild under-eye darkness.',
    'Slight cheek texture visible.',
    'Skin barrier looks stable overall.',
  ])

  const am = list(report.am_routine_json || [], 5, [
    'Gentle cleanser',
    'Hydrating serum',
    'Niacinamide serum',
    'Ceramide moisturiser',
    'SPF 50 sunscreen',
  ])

  const pm = list(report.pm_routine_json || [], 4, [
    'Gentle cleanser',
    'Repair treatment',
    'Barrier serum',
    'Ceramide moisturiser',
  ])

  const cautions = list(report.cautions_json || [], 4, [
    'Harsh exfoliation',
    'Strong actives too often',
    'Stripping cleansers',
    'Heavy fragrance',
  ])

  const faceZones = [
    `Forehead — ${short(zone(report, 'forehead', 'mild texture / fine lines'), 28)}`,
    `Under-eye — ${short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'mild darkness', 28)}`,
    `Cheeks — ${short(zone(report, 'cheeks', 'slight texture'), 28)}`,
    `Nose / T-zone — ${short(zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || zone(report, 'nose_t-zone') || 'visible oiliness', 28)}`,
    `Chin / Jawline — ${short(zone(report, 'chin') || zone(report, 'jawline') || 'balanced', 28)}`,
  ]

  const texturePercent = levelPercent(texture, 52)
  const poresPercent = levelPercent(`${zone(report, 'nose_t-zone', '')} ${texture}`, 58)
  const sensitivityPercent = levelPercent(`${zone(report, 'cheeks', '')} ${overall}`, 42)
  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const element = box(
    [
      box(null, { position: 'absolute', inset: 0, background: 'radial-gradient(circle at 15% 4%, #183a2f 0, #070908 36%, #070908 100%)' }),
      box(
        [
          Txt({ children: 'SKIN ANALYSIS & CONSULTATION', style: { color: '#c39a61', fontSize: 46, fontWeight: 700, letterSpacing: 4, textAlign: 'center' } }),
          Txt({ children: 'PERSONALIZED SKIN INSIGHTS', style: { color: '#8e938c', fontSize: 16, fontWeight: 800, letterSpacing: 6, marginTop: 8, textAlign: 'center' } }),
          Txt({ children: dateLabel, style: { position: 'absolute', right: 36, top: 28, color: '#cdb487', fontSize: 20, fontWeight: 800 } }),
        ],
        { position: 'absolute', top: 36, left: 42, right: 42, display: 'flex', flexDirection: 'column', alignItems: 'center' }
      ),
      box(
        [
          box(
            [
              FacePlaceholder({ imageDataUrl, small: false }),
            ],
            { width: 382, height: 435, borderRadius: 22, border: '1px solid #5e4931', overflow: 'hidden' }
          ),
          box(
            [
              SectionTitle({ number: '1', title: 'FACIAL MAP', dark: true }),
              box(
                [
                  FaceMapOverlay({ imageDataUrl, faceZones }),
                  box(
                    faceZones.map((item, index) =>
                      box(
                        [
                          box(['〰️', '👁️', '✦', '💧', '🛡️'][index] || '•', {
                            width: 42,
                            height: 42,
                            borderRadius: 999,
                            border: '1px solid #4b3c2b',
                            color: '#c79c5f',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginRight: 12,
                            fontSize: 18,
                          }),
                          Txt({ children: item, style: { color: '#d8c5a3', fontSize: 14, fontWeight: 800, lineHeight: 1.15, width: 168 } }),
                        ],
                        { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 9 }
                      )
                    ),
                    { display: 'flex', flexDirection: 'column', width: 224, marginLeft: 18, marginTop: 8 }
                  ),
                ],
                { display: 'flex', flexDirection: 'row', marginTop: 18 }
              ),
            ],
            { width: 572, height: 435, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 18 }
          ),
        ],
        { position: 'absolute', top: 134, left: 42, display: 'flex', flexDirection: 'row' }
      ),
      box(
        [
          SectionTitle({ number: '2', title: 'AT A GLANCE', dark: true }),
          box(
            [
              MiniMetric({ icon: '💧', label: 'SKIN TYPE', value: skinType }),
              MiniMetric({ icon: '♡', label: 'CONDITION', value: overall }),
              MiniMetric({ icon: '◐', label: 'UNDERTONE', value: undertone }),
              MiniMetric({ icon: '💦', label: 'HYDRATION', value: `${scorePercent(hydration, 70)}%`, accent: '#6fa5d7' }),
              MiniMetric({ icon: '🛡', label: 'BARRIER', value: `${scorePercent(barrier, 65)}%`, accent: '#8fba78' }),
            ],
            { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }
          ),
        ],
        { position: 'absolute', top: 590, left: 42, width: 996, height: 168, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 18 }
      ),
      box(
        [
          SectionTitle({ number: '3', title: 'CONCERNS', dark: true }),
          box(
            [
              ConcernIcon({ icon: '〰️', label: 'TEXTURE', active: true }),
              ConcernIcon({ icon: '✹', label: 'REDNESS' }),
              ConcernIcon({ icon: '💧', label: 'DEHYDRATION', active: true }),
              ConcernIcon({ icon: '👁', label: 'FINE LINES' }),
              ConcernIcon({ icon: '◌', label: 'PORES', active: true }),
              box(null, { width: 1, height: 74, background: '#2d2d28', marginLeft: 6, marginRight: 8 }),
              Slider({ label: 'TEXTURE', left: 'SMOOTH', right: 'UNEVEN', percent: texturePercent }),
              Slider({ label: 'PORES', left: 'SMALL', right: 'VISIBLE', percent: poresPercent, accent: '#597aa5' }),
              Slider({ label: 'SENSITIVITY', left: 'LOW', right: 'HIGH', percent: sensitivityPercent, accent: '#be6a65' }),
            ],
            { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: 16 }
          ),
        ],
        { position: 'absolute', top: 775, left: 42, width: 996, height: 138, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }
      ),
      box(
        [
          SectionTitle({ number: '4', title: 'CURRENT VS TARGET BALANCE', dark: true }),
          box(
            [
              box([FacePlaceholder({ imageDataUrl, small: true }), Txt({ children: 'CURRENT', style: { color: '#c79c5f', fontSize: 14, fontWeight: 900, textAlign: 'center', marginTop: 8 } })], { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 182 }),
              box(observations.slice(0, 4).map((item) => Bullet({ text: short(item, 33), dark: true })), { width: 260, display: 'flex', flexDirection: 'column', marginTop: 18 }),
              Txt({ children: '➜', style: { color: '#c99a57', fontSize: 44, fontWeight: 900, marginTop: 68 } }),
              box([FacePlaceholder({ imageDataUrl, small: true }), Txt({ children: 'TARGET BALANCE', style: { color: '#c79c5f', fontSize: 14, fontWeight: 900, textAlign: 'center', marginTop: 8 } })], { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 182 }),
              box([
                Bullet({ text: 'Smoother visible texture', dark: true }),
                Bullet({ text: 'Hydrated glow', dark: true }),
                Bullet({ text: 'Calmer tone', dark: true }),
                Bullet({ text: 'Stronger barrier', dark: true }),
              ], { width: 230, display: 'flex', flexDirection: 'column', marginTop: 18 }),
            ],
            { display: 'flex', flexDirection: 'row', marginTop: 18, alignItems: 'flex-start' }
          ),
        ],
        { position: 'absolute', top: 930, left: 42, width: 744, height: 228, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }
      ),
      box(
        [
          SectionTitle({ number: '5', title: 'AVOID / CAUTION', dark: true }),
          box(cautions.slice(0, 4).map((item, index) =>
            box(
              [
                box(['⚠', '⚗', '⊗', '♨'][index] || '!', { color: '#d26b60', fontSize: 25, width: 38, height: 38, borderRadius: 999, border: '1px solid #5c332f', display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 12 }),
                Txt({ children: short(item, 27), style: { color: '#ce8578', fontSize: 16, lineHeight: 1.1, fontWeight: 900, width: 162 } }),
              ],
              { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 16 }
            )
          ), { display: 'flex', flexDirection: 'column', marginTop: 20 }),
        ],
        { position: 'absolute', top: 930, left: 804, width: 234, height: 228, borderRadius: 18, border: '1px solid #3b2b29', background: '#111210', padding: 16 }
      ),
      box(
        [
          SectionTitle({ number: '6', title: 'PERSONALIZED ROUTINE', dark: true }),
          box(
            [
              box('☀ AM ROUTINE', { width: 92, color: '#d3a665', fontSize: 17, fontWeight: 900, display: 'flex', alignItems: 'center' }),
              ...am.slice(0, 5).flatMap((item, index) => [RoutineStep({ icon: ['🧴', '💧', '🧪', '◒', '☀'][index] || '•', title: item, tag: ['CLEANSE', 'HYDRATE', 'BALANCE', 'REPAIR', 'PROTECT'][index] || 'STEP' }), index < Math.min(am.length, 5) - 1 ? Arrow() : null]).filter(Boolean),
            ],
            { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: 16 }
          ),
          box(
            [
              box('☾ PM ROUTINE', { width: 92, color: '#8da6d8', fontSize: 17, fontWeight: 900, display: 'flex', alignItems: 'center' }),
              ...pm.slice(0, 4).flatMap((item, index) => [RoutineStep({ icon: ['🧴', '🧪', '💚', '◒'][index] || '•', title: item, tag: ['CLEANSE', 'RENEW', 'SOOTHE', 'REPAIR'][index] || 'STEP' }), index < Math.min(pm.length, 4) - 1 ? Arrow() : null]).filter(Boolean),
            ],
            { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: 14 }
          ),
        ],
        { position: 'absolute', bottom: 88, left: 42, width: 996, height: 202, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }
      ),
      box(
        [
          box('7', { width: 26, height: 26, borderRadius: 999, background: '#2a2017', color: '#c79c5f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 900, marginRight: 10 }),
          Txt({ children: 'EXPERT NOTES', style: { color: '#d4a66d', fontSize: 16, fontWeight: 900, letterSpacing: 1.2, marginRight: 30 } }),
          Txt({ children: '🛡 BARRIER FIRST', style: { color: '#bca681', fontSize: 15, fontWeight: 900, marginRight: 36 } }),
          Txt({ children: '💧 HYDRATE DAILY', style: { color: '#bca681', fontSize: 15, fontWeight: 900, marginRight: 36 } }),
          Txt({ children: '☀ PROTECT AM', style: { color: '#bca681', fontSize: 15, fontWeight: 900, marginRight: 36 } }),
          Txt({ children: '✦ CONSISTENCY WINS', style: { color: '#bca681', fontSize: 15, fontWeight: 900 } }),
        ],
        { position: 'absolute', bottom: 34, left: 42, width: 996, height: 42, borderRadius: 12, border: '1px solid #2d2d28', background: '#111210', display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px' }
      ),
    ],
    {
      display: 'flex',
      position: 'relative',
      width: '100%',
      height: '100%',
      background: '#070908',
      fontFamily: 'Arial, sans-serif',
      overflow: 'hidden',
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
      `I created a premium visual Skin Analysis & Consultation card from your latest Skin Check.\n\n` +
      `Open card:\n${mediaUrl}\n\n` +
      `Tip: take your next selfie in similar lighting for cleaner progress tracking.`,
    mediaUrl,
  }
}
