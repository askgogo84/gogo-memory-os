import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { cropFacePortraitFromMediaUrl } from '@/lib/services/face-crop'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function clean(value: any, fallback = '-') {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim()
  return output || fallback
}

function esc(value: any) {
  return clean(value, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
  const values = (items || []).map((item) => clean(item, '')).filter(Boolean).slice(0, limit)
  return values.length ? values : fallback.slice(0, limit)
}

function bulletText(items: string[], x: number, y: number, maxLen = 58, gap = 28, color = '#173a31') {
  return items.map((item, index) => {
    const yy = y + index * gap
    return `<circle cx="${x}" cy="${yy - 5}" r="4" fill="#c69a50"/><text x="${x + 14}" y="${yy}" class="body" fill="${color}">${esc(short(item, maxLen))}</text>`
  }).join('')
}

function metric(label: string, value: string, x: number, y: number, w: number) {
  return `<rect x="${x}" y="${y}" width="${w}" height="78" rx="16" fill="#fffaf0" stroke="#d7c49d"/>
<text x="${x + w / 2}" y="${y + 25}" text-anchor="middle" class="tiny" fill="#8b7650">${esc(label)}</text>
<text x="${x + w / 2}" y="${y + 58}" text-anchor="middle" class="metric" fill="#173a31">${esc(short(value, 15))}</text>`
}

function bar(label: string, percent: number, x: number, y: number, color: string) {
  const width = Math.max(12, Math.min(210, Math.round((percent / 100) * 210)))
  return `<text x="${x}" y="${y}" class="body" fill="#173a31">${esc(label)}</text>
<rect x="${x + 145}" y="${y - 15}" width="210" height="15" rx="8" fill="#e4d7bc"/>
<rect x="${x + 145}" y="${y - 15}" width="${width}" height="15" rx="8" fill="${color}"/>
<text x="${x + 370}" y="${y}" class="body" fill="#173a31">${percent}%</text>`
}

function routineLine(index: number, text: string, x: number, y: number) {
  return `<text x="${x}" y="${y}" class="body" fill="#173a31">${index}. ${esc(short(text, 54))}</text>`
}

function faceImage(id: string, href: string | null, x: number, y: number, w: number, h: number, overlay = false) {
  const image = href
    ? `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#efe2c4"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" class="body" fill="#8b7650">SELFIE</text>`

  const overlayShapes = overlay ? `<ellipse cx="${x + w * .50}" cy="${y + h * .22}" rx="${w * .25}" ry="${h * .075}" fill="#e0a54e" opacity=".28" stroke="#b88a4a"/>
<ellipse cx="${x + w * .33}" cy="${y + h * .44}" rx="${w * .15}" ry="${h * .10}" fill="#79a7c7" opacity=".24" stroke="#5e8ead"/>
<ellipse cx="${x + w * .67}" cy="${y + h * .44}" rx="${w * .15}" ry="${h * .10}" fill="#79a7c7" opacity=".24" stroke="#5e8ead"/>
<rect x="${x + w * .43}" y="${y + h * .35}" width="${w * .14}" height="${h * .30}" rx="18" fill="#c99a5d" opacity=".18"/>
<ellipse cx="${x + w * .50}" cy="${y + h * .82}" rx="${w * .25}" ry="${h * .07}" fill="#7d9f66" opacity=".24" stroke="#6f8f5d"/>` : ''

  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/></clipPath>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#efe2c4" stroke="#c7ad75"/>${image}${overlayShapes}`
}

async function getImageDataUrl(report: any) {
  if (!report?.image_url) return null

  try {
    return await cropFacePortraitFromMediaUrl(report.image_url)
  } catch (error: any) {
    console.error('[skin-report-card] face-focused image build failed:', error?.message || error)
    return null
  }
}

async function buildSvg(report: any) {
  const img = await getImageDataUrl(report)
  const hydration = scorePercent(score(report, 'hydration', 70), 70)
  const barrier = scorePercent(score(report, 'barrier_support', 65), 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const sensitivity = short(score(report, 'sensitivity', 'low'), 16)
  const skinType = short(report.skin_type || 'Combination', 22)
  const confidence = short(report.confidence_level || 'medium', 14)
  const observations = list(report.observations_json || [], 4, ['Slight shine on forehead and T-zone', 'Mild darkness under eyes', 'Overall even skin tone', 'Texture appears smooth'])
  const am = list(report.am_routine_json || [], 4, ['Gentle cleanser', 'Hydrating serum', 'Light moisturiser', 'SPF 50 sunscreen'])
  const pm = list(report.pm_routine_json || [], 4, ['Gentle cleanser', 'Niacinamide serum', 'Barrier serum', 'Light moisturiser'])
  const cautions = list(report.cautions_json || [], 4, ['Heavy creams on T-zone', 'Skipping sunscreen', 'Over-exfoliating', 'Harsh scrubs'])

  const forehead = short(zone(report, 'forehead', 'Slight shine visible'), 32)
  const underEye = short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'Mild darkness visible', 32)
  const cheeks = short(zone(report, 'cheeks', 'Even tone observed'), 32)
  const tzone = short(zone(report, 'nose_t-zone') || zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || 'Mild oiliness visible', 32)
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'Balanced / smooth', 32)
  const dateLabel = report?.created_at ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const oilPercent = oiliness.toLowerCase().includes('high') ? 75 : oiliness.toLowerCase().includes('moderate') ? 55 : 35
  const texturePercent = texture.toLowerCase().includes('smooth') ? 28 : texture.toLowerCase().includes('mild') ? 48 : 60
  const sensitivityPercent = sensitivity.toLowerCase().includes('low') ? 28 : sensitivity.toLowerCase().includes('moderate') ? 52 : 72

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs><style>.title{font:800 44px Georgia,serif;letter-spacing:3px;fill:#173a31}.sub{font:800 15px Arial,sans-serif;letter-spacing:5px;fill:#8b7650}.section{font:900 20px Arial,sans-serif;letter-spacing:1.2px;fill:#173a31}.tiny{font:900 10px Arial,sans-serif;letter-spacing:.6px}.metric{font:900 17px Arial,sans-serif}.body{font:700 17px Arial,sans-serif}.small{font:700 14px Arial,sans-serif}.micro{font:700 10px Arial,sans-serif}.note{font:900 13px Arial,sans-serif;fill:#8b7650}</style></defs>
<rect width="1080" height="1350" fill="#f7f0df"/>
<circle cx="960" cy="110" r="310" fill="#d9c79d" opacity=".32"/>
<circle cx="90" cy="1260" r="320" fill="#d9c79d" opacity=".26"/>
<text x="72" y="78" class="title">ASKGOGO SKIN CHECK</text>
<text x="74" y="112" class="sub">VISUAL SKINCARE OBSERVATION</text>
<text x="1008" y="78" text-anchor="end" class="body" fill="#173a31">${esc(dateLabel)}</text>

<rect x="54" y="150" width="396" height="392" rx="28" fill="#ffffff" stroke="#d5bf8d"/>
<text x="84" y="190" class="section">Selfie preview</text>
${faceImage('main', img, 84, 212, 336, 290, false)}

<rect x="474" y="150" width="552" height="392" rx="28" fill="#ffffff" stroke="#d5bf8d"/>
<text x="504" y="190" class="section">Facial map</text>
${faceImage('map', img, 504, 212, 210, 230, true)}
${bulletText([`Forehead: ${forehead}`, `Under-eye: ${underEye}`, `Cheeks: ${cheeks}`, `Nose / T-zone: ${tzone}`, `Chin / Jawline: ${chin}`], 748, 238, 35, 31)}

<rect x="54" y="570" width="972" height="140" rx="28" fill="#ffffff" stroke="#d5bf8d"/>
<text x="84" y="610" class="section">At a glance</text>
${metric('SKIN TYPE', skinType, 84, 628, 128)}${metric('OILINESS', oiliness, 226, 628, 120)}${metric('TEXTURE', texture, 360, 628, 120)}${metric('HYDRATION', `${hydration}%`, 494, 628, 120)}${metric('BARRIER', `${barrier}%`, 628, 628, 120)}${metric('SENSITIVITY', sensitivity, 762, 628, 126)}${metric('CONFIDENCE', confidence, 902, 628, 96)}

<rect x="54" y="735" width="972" height="155" rx="28" fill="#ffffff" stroke="#d5bf8d"/>
<text x="84" y="775" class="section">Skin metrics</text>
${bar('Hydration', hydration, 92, 825, '#2f9b80')}${bar('Barrier support', barrier, 92, 866, '#c99a50')}${bar('Oiliness', oilPercent, 560, 825, '#6485b2')}${bar('Texture', texturePercent, 560, 866, '#c36d67')}

<rect x="54" y="915" width="612" height="188" rx="28" fill="#ffffff" stroke="#d5bf8d"/>
<text x="84" y="955" class="section">Key observations</text>
${bulletText(observations.slice(0, 4), 92, 994, 60, 28)}

<rect x="690" y="915" width="336" height="188" rx="28" fill="#fff7f3" stroke="#d7b6a9"/>
<text x="720" y="955" class="section">Avoid this week</text>
${bulletText(cautions.slice(0, 4), 728, 994, 32, 28, '#6e322f')}

<rect x="54" y="1128" width="472" height="160" rx="28" fill="#ffffff" stroke="#d5bf8d"/>
<text x="84" y="1168" class="section">Personalized AM</text>
${am.slice(0,4).map((item,i)=>routineLine(i+1,item,92,1204+i*27)).join('')}

<rect x="554" y="1128" width="472" height="160" rx="28" fill="#ffffff" stroke="#d5bf8d"/>
<text x="584" y="1168" class="section">Personalized PM</text>
${pm.slice(0,4).map((item,i)=>routineLine(i+1,item,592,1204+i*27)).join('')}

<text x="74" y="1320" class="note">Not medical advice. For painful acne, irritation, rashes, infection, sudden pigmentation, bleeding or changing moles, consult a dermatologist.</text>
</svg>`
}

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const { data: report, error } = await supabaseAdmin.from('skin_check_reports').select('*').eq('id', id).maybeSingle()
    if (error) {
      console.error('[skin-report-card] fetch failed:', error.message)
      return new NextResponse('Skin report failed to load', { status: 500 })
    }
    if (!report) return new NextResponse('Skin report not found', { status: 404 })
    return new NextResponse(await buildSvg(report), { status: 200, headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error: any) {
    console.error('[skin-report-card] route failed:', error?.message || error)
    return new NextResponse('Skin report failed to render', { status: 500 })
  }
}
