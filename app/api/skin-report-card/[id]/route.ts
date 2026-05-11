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

function bullet(items: string[], x: number, y: number, maxLen = 50, color = '#dfd3bc') {
  return items.map((item, index) => {
    const yy = y + index * 34
    return `<circle cx="${x}" cy="${yy - 6}" r="4" fill="#c59a60"/><text x="${x + 16}" y="${yy}" class="body" fill="${color}">${esc(short(item, maxLen))}</text>`
  }).join('')
}

function metric(label: string, value: string, x: number, y: number, w = 132) {
  return `<rect x="${x}" y="${y}" width="${w}" height="90" rx="16" fill="#151614" stroke="#353027"/>
<text x="${x + w / 2}" y="${y + 30}" text-anchor="middle" class="tiny" fill="#9b8b74">${esc(label)}</text>
<text x="${x + w / 2}" y="${y + 64}" text-anchor="middle" class="metric" fill="#f0dfc2">${esc(short(value, 15))}</text>`
}

function bar(label: string, value: number, x: number, y: number, color: string) {
  const width = Math.max(12, Math.min(210, Math.round((value / 100) * 210)))
  return `<text x="${x}" y="${y}" class="body" fill="#dfd3bc">${esc(label)}</text>
<rect x="${x + 145}" y="${y - 15}" width="210" height="15" rx="8" fill="#34322d"/>
<rect x="${x + 145}" y="${y - 15}" width="${width}" height="15" rx="8" fill="${color}"/>
<text x="${x + 370}" y="${y}" class="body" fill="#c9ad78">${value}%</text>`
}

function faceImage(id: string, href: string | null, x: number, y: number, w: number, h: number, overlay = false) {
  const img = href
    ? `<image href="${href}" x="${x - w * 0.30}" y="${y - h * 0.18}" width="${w * 1.60}" height="${h * 1.60}" preserveAspectRatio="xMidYMin slice" clip-path="url(#${id})"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#211a16"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" class="body" fill="#c9a66f">SELFIE</text>`

  const overlays = overlay ? `<ellipse cx="${x + w * .50}" cy="${y + h * .24}" rx="${w * .23}" ry="${h * .075}" fill="#d9a259" opacity=".30" stroke="#e2bf85"/>
<ellipse cx="${x + w * .35}" cy="${y + h * .46}" rx="${w * .16}" ry="${h * .10}" fill="#7da8c8" opacity=".24" stroke="#a9bfca"/>
<ellipse cx="${x + w * .65}" cy="${y + h * .46}" rx="${w * .16}" ry="${h * .10}" fill="#7da8c8" opacity=".24" stroke="#a9bfca"/>
<rect x="${x + w * .43}" y="${y + h * .35}" width="${w * .14}" height="${h * .30}" rx="20" fill="#c99a5d" opacity=".20"/>
<ellipse cx="${x + w * .50}" cy="${y + h * .82}" rx="${w * .25}" ry="${h * .07}" fill="#7d9f66" opacity=".25" stroke="#8aa36c"/>` : ''

  return `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22"/></clipPath>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#111210" stroke="#5a4430"/>${img}${overlays}`
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

  const observations = list(report.observations_json || [], 5, ['T-zone shine visible', 'Mild under-eye darkness', 'Even overall tone', 'Skin barrier appears stable'])
  const am = list(report.am_routine_json || [], 4, ['Gentle cleanser', 'Hydrating serum', 'Light moisturizer', 'SPF 50 sunscreen'])
  const pm = list(report.pm_routine_json || [], 4, ['Gentle cleanser', 'Repair treatment', 'Barrier serum', 'Light moisturizer'])
  const cautions = list(report.cautions_json || [], 4, ['Avoid harsh exfoliation', 'Avoid skipping sunscreen', 'Avoid heavy fragrance', 'Avoid too many actives'])

  const forehead = short(zone(report, 'forehead', 'Slight shine visible'), 35)
  const underEye = short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'Mild darkness visible', 35)
  const cheeks = short(zone(report, 'cheeks', 'Even tone observed'), 35)
  const tzone = short(zone(report, 'nose_t-zone') || zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || 'Mild oiliness visible', 35)
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'Balanced / even texture', 35)
  const dateLabel = report?.created_at ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1600" viewBox="0 0 1080 1600">
<defs><style>.title{font:700 42px Georgia,serif;letter-spacing:4px;fill:#c49a61}.sub{font:800 15px Arial,sans-serif;letter-spacing:5px;fill:#8b8f89}.section{font:900 20px Arial,sans-serif;letter-spacing:1.4px;fill:#c59a60}.tiny{font:900 10px Arial,sans-serif;letter-spacing:.8px}.metric{font:900 17px Arial,sans-serif}.body{font:700 14px Arial,sans-serif}.note{font:900 14px Arial,sans-serif;fill:#baa37f}</style></defs>
<rect width="1080" height="1600" fill="#080a09"/><circle cx="940" cy="80" r="310" fill="#123d30" opacity=".45"/><circle cx="110" cy="1500" r="330" fill="#143126" opacity=".42"/>
<text x="540" y="78" text-anchor="middle" class="title">SKIN ANALYSIS &amp; CONSULTATION</text><text x="540" y="116" text-anchor="middle" class="sub">PERSONALIZED SKIN INSIGHTS</text><text x="1000" y="64" text-anchor="end" class="body" fill="#ceb386">${esc(dateLabel)}</text>

<rect x="38" y="150" width="430" height="505" rx="26" fill="#111210" stroke="#2b2d29"/><text x="62" y="188" class="section">SELFIE PREVIEW</text>${faceImage('mainFace', img, 68, 215, 370, 400, false)}

<rect x="492" y="150" width="550" height="505" rx="26" fill="#111210" stroke="#2b2d29"/><text x="516" y="188" class="section">FACIAL MAP</text>${faceImage('mapFace', img, 520, 215, 240, 305, true)}
${bullet([`Forehead: ${forehead}`, `Under-eye: ${underEye}`, `Cheeks: ${cheeks}`, `Nose / T-zone: ${tzone}`, `Chin / Jawline: ${chin}`], 790, 245, 34)}
<text x="516" y="570" class="section">KEY OBSERVATIONS</text>${bullet(observations.slice(0, 4), 528, 605, 52)}

<rect x="38" y="680" width="1004" height="155" rx="26" fill="#111210" stroke="#2b2d29"/><text x="62" y="718" class="section">AT A GLANCE</text>
${metric('SKIN TYPE', skinType, 64, 735, 130)}${metric('OILINESS', oiliness, 210, 735, 120)}${metric('TEXTURE', texture, 346, 735, 120)}${metric('HYDRATION', `${hydration}%`, 482, 735, 120)}${metric('BARRIER', `${barrier}%`, 618, 735, 120)}${metric('SENSITIVITY', sensitivity, 754, 735, 130)}${metric('CONFIDENCE', confidence, 900, 735, 110)}

<rect x="38" y="860" width="1004" height="165" rx="26" fill="#111210" stroke="#2b2d29"/><text x="62" y="898" class="section">SKIN METRICS</text>
${bar('Hydration', hydration, 72, 945, '#2f9b80')}${bar('Barrier support', barrier, 72, 990, '#c69b50')}${bar('Oiliness', oiliness.toLowerCase().includes('moderate') ? 55 : oiliness.toLowerCase().includes('high') ? 75 : 35, 560, 945, '#6485b2')}${bar('Texture', texture.toLowerCase().includes('smooth') ? 28 : 55, 560, 990, '#c36d67')}

<rect x="38" y="1050" width="654" height="250" rx="26" fill="#111210" stroke="#2b2d29"/><text x="62" y="1088" class="section">CURRENT VS TARGET BALANCE</text>
${faceImage('currentFace', img, 68, 1120, 150, 140, false)}${bullet(observations.slice(0, 4), 245, 1145, 34)}<text x="410" y="1210" font-size="42" font-weight="900" fill="#c89a58">&gt;</text>${faceImage('targetFace', img, 462, 1120, 150, 140, true)}${bullet(['Smoother visible texture', 'Hydrated glow', 'Calmer tone', 'Stronger skin barrier'], 635, 1145, 28)}

<rect x="714" y="1050" width="328" height="250" rx="26" fill="#111210" stroke="#3b2b29"/><text x="738" y="1088" class="section">AVOID / CAUTION</text>${cautions.slice(0,4).map((item,i)=>`<circle cx="750" cy="${1125+i*40}" r="14" fill="none" stroke="#6e322f"/><text x="750" y="${1131+i*40}" text-anchor="middle" font-size="18" font-weight="900" fill="#d16c60">!</text><text x="775" y="${1131+i*40}" class="body" fill="#cf8478">${esc(short(item,28))}</text>`).join('')}

<rect x="38" y="1325" width="489" height="190" rx="26" fill="#111210" stroke="#2b2d29"/><text x="62" y="1363" class="section">AM ROUTINE</text>${am.slice(0,4).map((item,i)=>`<text x="78" y="${1405+i*30}" class="body" fill="#e6d8c0">${i+1}. ${esc(short(item,48))}</text>`).join('')}
<rect x="553" y="1325" width="489" height="190" rx="26" fill="#111210" stroke="#2b2d29"/><text x="577" y="1363" class="section">PM ROUTINE</text>${pm.slice(0,4).map((item,i)=>`<text x="593" y="${1405+i*30}" class="body" fill="#e6d8c0">${i+1}. ${esc(short(item,48))}</text>`).join('')}

<rect x="38" y="1540" width="1004" height="40" rx="12" fill="#111210" stroke="#2b2d29"/><text x="64" y="1566" class="note" fill="#d4a66d">EXPERT NOTES</text><text x="220" y="1566" class="note">BARRIER FIRST</text><text x="390" y="1566" class="note">HYDRATE DAILY</text><text x="560" y="1566" class="note">PROTECT AM</text><text x="720" y="1566" class="note">CONSISTENCY WINS</text>
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
