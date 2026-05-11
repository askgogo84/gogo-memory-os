import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { downloadTwilioMediaAsDataUrl } from '@/lib/services/image-note-reader'

export const dynamic = 'force-dynamic'

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

function splitLine(text: string, max = 34) {
  const value = short(text, max)
  const words = value.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > Math.floor(max / 2) && current) {
      lines.push(current)
      current = word
    } else {
      current = (current + ' ' + word).trim()
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, 2)
}

function bulletText(items: string[], x: number, y: number, maxLen = 42, gap = 26, color = '#d8c5a7') {
  return items.map((item, index) => {
    const yy = y + index * gap
    return `<circle cx="${x}" cy="${yy - 5}" r="4" fill="#c99a5d"/><text x="${x + 14}" y="${yy}" class="body" fill="${color}">${esc(short(item, maxLen))}</text>`
  }).join('')
}

function metric(label: string, value: string, x: number, y: number, w: number) {
  return `<rect x="${x}" y="${y}" width="${w}" height="78" rx="12" fill="#151614" stroke="#343027"/>
<text x="${x + w / 2}" y="${y + 24}" text-anchor="middle" class="tiny" fill="#9b8b74">${esc(label)}</text>
<text x="${x + w / 2}" y="${y + 55}" text-anchor="middle" class="metric" fill="#f1dfc1">${esc(short(value, 15))}</text>`
}

function concern(label: string, x: number, y: number, active = true) {
  return `<circle cx="${x}" cy="${y}" r="23" fill="${active ? '#211b15' : '#131513'}" stroke="${active ? '#b88a55' : '#393a35'}"/>
<text x="${x}" y="${y + 7}" text-anchor="middle" font-size="18" font-weight="900" fill="${active ? '#c99a5d' : '#777'}">${esc(label[0])}</text>
<text x="${x}" y="${y + 42}" text-anchor="middle" class="micro" fill="${active ? '#c9ad82' : '#777'}">${esc(label)}</text>`
}

function slider(label: string, percent: number, x: number, y: number, color: string) {
  const knob = x + Math.round((150 * Math.max(0, Math.min(100, percent))) / 100)
  return `<text x="${x + 75}" y="${y}" text-anchor="middle" class="tiny" fill="#b88a55">${esc(label)}</text>
<line x1="${x}" y1="${y + 22}" x2="${x + 150}" y2="${y + 22}" stroke="#545047" stroke-width="4" stroke-linecap="round"/>
<circle cx="${knob}" cy="${y + 22}" r="8" fill="${color}"/>
<text x="${x}" y="${y + 44}" class="micro" fill="#77736c">LOW</text>
<text x="${x + 128}" y="${y + 44}" class="micro" fill="#77736c">HIGH</text>`
}

function routineStep(title: string, tag: string, x: number, y: number) {
  const lines = splitLine(title, 24)
  return `<rect x="${x + 18}" y="${y}" width="46" height="58" rx="12" fill="#ded5c2" stroke="#a9987a"/>
<path d="M${x + 26} ${y + 8} h30" stroke="#f6efe2" stroke-width="3" opacity=".55"/>
${lines.map((line, i) => `<text x="${x + 41}" y="${y + 76 + i * 12}" text-anchor="middle" class="micro" fill="#ded2bc">${esc(line)}</text>`).join('')}
<rect x="${x}" y="${y + 104}" width="82" height="18" rx="9" fill="#b99158"/>
<text x="${x + 41}" y="${y + 117}" text-anchor="middle" class="tag">${esc(tag)}</text>`
}

function faceImage(id: string, href: string | null, x: number, y: number, w: number, h: number, overlay = false) {
  const image = href
    ? `<image href="${href}" x="${x - w * 0.18}" y="${y - h * 0.20}" width="${w * 1.36}" height="${h * 1.45}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${id})"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#231b16"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" class="body" fill="#c99a5d">SELFIE</text>`

  const overlayShapes = overlay ? `<ellipse cx="${x + w * .50}" cy="${y + h * .22}" rx="${w * .25}" ry="${h * .075}" fill="#d9a259" opacity=".30" stroke="#e2bf85"/>
<ellipse cx="${x + w * .33}" cy="${y + h * .44}" rx="${w * .15}" ry="${h * .10}" fill="#7da8c8" opacity=".25" stroke="#a9bfca"/>
<ellipse cx="${x + w * .67}" cy="${y + h * .44}" rx="${w * .15}" ry="${h * .10}" fill="#7da8c8" opacity=".25" stroke="#a9bfca"/>
<rect x="${x + w * .43}" y="${y + h * .35}" width="${w * .14}" height="${h * .30}" rx="18" fill="#c99a5d" opacity=".20"/>
<ellipse cx="${x + w * .50}" cy="${y + h * .82}" rx="${w * .25}" ry="${h * .07}" fill="#7d9f66" opacity=".26" stroke="#8aa36c"/>` : ''

  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/></clipPath>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#111210" stroke="#5a4430"/>${image}${overlayShapes}`
}

async function getImageDataUrl(report: any) {
  if (!report?.image_url) return null
  try {
    return await downloadTwilioMediaAsDataUrl({ mediaUrl: report.image_url, contentType: 'image/jpeg' })
  } catch (error: any) {
    console.error('[skin-report-card] selfie image embed failed:', error?.message || error)
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
  const am = list(report.am_routine_json || [], 5, ['Gentle cleanser', 'Hydrating serum', 'Niacinamide serum', 'Light moisturiser', 'SPF 50 sunscreen'])
  const pm = list(report.pm_routine_json || [], 4, ['Gentle cleanser', 'Niacinamide serum', 'Barrier serum', 'Light moisturiser'])
  const cautions = list(report.cautions_json || [], 4, ['Heavy creams on T-zone', 'Skipping sunscreen', 'Over-exfoliating', 'Harsh scrubs'])

  const forehead = short(zone(report, 'forehead', 'Slight shine visible'), 28)
  const underEye = short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'Mild darkness visible', 28)
  const cheeks = short(zone(report, 'cheeks', 'Even tone observed'), 28)
  const tzone = short(zone(report, 'nose_t-zone') || zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || 'Mild oiliness visible', 28)
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'Balanced / smooth', 28)
  const dateLabel = report?.created_at ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const oilPercent = oiliness.toLowerCase().includes('high') ? 75 : oiliness.toLowerCase().includes('moderate') ? 55 : 35
  const texturePercent = texture.toLowerCase().includes('smooth') ? 28 : texture.toLowerCase().includes('mild') ? 48 : 60
  const sensitivityPercent = sensitivity.toLowerCase().includes('low') ? 28 : sensitivity.toLowerCase().includes('moderate') ? 52 : 72

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs><style>.title{font:700 43px Georgia,serif;letter-spacing:4px;fill:#c49a61}.sub{font:800 15px Arial,sans-serif;letter-spacing:5px;fill:#8b8f89}.section{font:900 17px Arial,sans-serif;letter-spacing:1.2px;fill:#c59a60}.tiny{font:900 9px Arial,sans-serif;letter-spacing:.6px}.metric{font:900 15px Arial,sans-serif}.body{font:700 12px Arial,sans-serif}.micro{font:700 8px Arial,sans-serif}.tag{font:900 8px Arial,sans-serif;fill:#121411}.note{font:900 13px Arial,sans-serif;fill:#baa37f}</style></defs>
<rect width="1080" height="1350" fill="#080a09"/><circle cx="970" cy="80" r="310" fill="#123d30" opacity=".42"/>
<text x="540" y="70" text-anchor="middle" class="title">SKIN ANALYSIS &amp; CONSULTATION</text>
<text x="540" y="104" text-anchor="middle" class="sub">PERSONALIZED SKIN INSIGHTS</text>
<text x="1010" y="58" text-anchor="end" class="body" fill="#ceb386">${esc(dateLabel)}</text>

<rect x="38" y="128" width="420" height="348" rx="18" fill="#111210" stroke="#2b2d29"/>
${faceImage('main', img, 58, 152, 380, 300, false)}

<rect x="478" y="128" width="564" height="348" rx="18" fill="#111210" stroke="#2b2d29"/>
<text x="500" y="160" class="section">FACIAL MAP</text>
${faceImage('map', img, 500, 178, 230, 225, true)}
${bulletText([`FOREHEAD  ${forehead}`, `UNDER-EYE  ${underEye}`, `CHEEKS  ${cheeks}`, `NOSE / T-ZONE  ${tzone}`, `CHIN / JAWLINE  ${chin}`], 762, 200, 30, 28)}
<text x="500" y="442" class="section">AT A GLANCE</text>
${metric('SKIN TYPE', skinType, 500, 456, 95)}${metric('OILINESS', oiliness, 604, 456, 95)}${metric('TEXTURE', texture, 708, 456, 95)}${metric('HYDRATION', `${hydration}%`, 812, 456, 95)}${metric('BARRIER', `${barrier}%`, 916, 456, 95)}

<rect x="38" y="495" width="1004" height="122" rx="18" fill="#111210" stroke="#2b2d29"/>
<text x="60" y="526" class="section">CONCERNS</text>
${concern('TEXTURE', 80, 565, true)}${concern('REDNESS', 172, 565, false)}${concern('DEHYDRATION', 264, 565, true)}${concern('FINE LINES', 356, 565, false)}${concern('PORES', 448, 565, true)}
${slider('TEXTURE', texturePercent, 568, 542, '#c59a60')}${slider('PORES', oilPercent, 746, 542, '#6485b2')}${slider('SENSITIVITY', sensitivityPercent, 924, 542, '#c36d67')}

<rect x="38" y="636" width="730" height="200" rx="18" fill="#111210" stroke="#2b2d29"/>
<text x="60" y="668" class="section">CURRENT VS TARGET BALANCE</text>
${faceImage('current', img, 62, 692, 142, 112, false)}
${bulletText(observations.slice(0, 4), 232, 704, 28, 24)}
<text x="425" y="764" font-size="38" font-weight="900" fill="#c89a58">&gt;</text>
${faceImage('target', img, 468, 692, 142, 112, true)}
${bulletText(['Smoother texture', 'Hydrated glow', 'Calmer tone', 'Stronger barrier'], 635, 704, 24, 24)}

<rect x="790" y="636" width="252" height="200" rx="18" fill="#111210" stroke="#3b2b29"/>
<text x="812" y="668" class="section">AVOID / CAUTION</text>
${cautions.slice(0,4).map((item,i)=>`<circle cx="824" cy="${704+i*34}" r="13" fill="none" stroke="#6e322f"/><text x="824" y="${710+i*34}" text-anchor="middle" font-size="17" font-weight="900" fill="#d16c60">!</text><text x="848" y="${710+i*34}" class="body" fill="#cf8478">${esc(short(item,22))}</text>`).join('')}

<rect x="38" y="856" width="730" height="226" rx="18" fill="#111210" stroke="#2b2d29"/>
<text x="60" y="888" class="section">PERSONALIZED ROUTINE</text>
<text x="70" y="946" class="section" fill="#d5b279">AM</text>
${routineStep(am[0] || 'Gentle cleanser', 'CLEANSE', 135, 910)}${routineStep(am[1] || 'Hydrating serum', 'HYDRATE', 245, 910)}${routineStep(am[2] || 'Niacinamide serum', 'BALANCE', 355, 910)}${routineStep(am[3] || 'Light moisturiser', 'REPAIR', 465, 910)}${routineStep(am[4] || 'SPF 50 sunscreen', 'PROTECT', 575, 910)}
<text x="70" y="1038" class="section" fill="#8da6d8">PM</text>
${routineStep(pm[0] || 'Gentle cleanser', 'CLEANSE', 135, 1000)}${routineStep(pm[1] || 'Niacinamide serum', 'RENEW', 245, 1000)}${routineStep(pm[2] || 'Barrier serum', 'SOOTHE', 355, 1000)}${routineStep(pm[3] || 'Light moisturiser', 'REPAIR', 465, 1000)}

<rect x="790" y="856" width="252" height="226" rx="18" fill="#111210" stroke="#2b2d29"/>
<text x="812" y="888" class="section">EXPERT NOTES</text>
${bulletText(['Barrier first', 'Hydrate daily', 'Protect every AM', 'Consistency wins'], 814, 928, 24, 28)}
<text x="812" y="1060" class="micro" fill="#8d8370">Visual skincare observation only. Not medical advice.</text>

<rect x="38" y="1102" width="1004" height="212" rx="18" fill="#111210" stroke="#2b2d29"/>
<text x="60" y="1136" class="section">COMPLETE ANALYSIS</text>
${bulletText([...observations.slice(0,4), `Skin type indicator: ${skinType}`, `Hydration: ${hydration}/100`, `Barrier support: ${barrier}/100`], 68, 1174, 76, 24)}
<text x="68" y="1292" class="micro" fill="#8d8370">Generated by AskGogo Skin Check. For irritation, painful acne, rashes, bleeding, infection, sudden pigmentation or changing moles, consult a dermatologist.</text>
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
