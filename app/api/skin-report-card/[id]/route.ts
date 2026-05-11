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

function levelPercent(value: any, fallback = 50) {
  const lower = clean(value, '').toLowerCase()
  if (lower.includes('high') || lower.includes('visible') || lower.includes('oily')) return 72
  if (lower.includes('moderate') || lower.includes('mild')) return 52
  if (lower.includes('low') || lower.includes('smooth') || lower.includes('clear')) return 28
  return fallback
}

function list(items: any[], limit: number, fallback: string[] = []) {
  const values = (items || []).map((item) => clean(item, '')).filter(Boolean).slice(0, limit)
  return values.length ? values : fallback.slice(0, limit)
}

function bullet(items: string[], x: number, y: number, maxLen = 44, color = '#dfd3bc') {
  return items.map((item, index) => {
    const yy = y + index * 28
    return `<circle cx="${x}" cy="${yy - 6}" r="4" fill="#c59a60"/><text x="${x + 14}" y="${yy}" class="mini" fill="${color}">${esc(short(item, maxLen))}</text>`
  }).join('')
}

function metric(label: string, value: string, x: number, y: number, width = 118) {
  return `<rect x="${x}" y="${y}" width="${width}" height="82" rx="14" fill="#151614" stroke="#322d25"/>
<text x="${x + width / 2}" y="${y + 27}" text-anchor="middle" class="tiny" fill="#8f806d">${esc(label)}</text>
<text x="${x + width / 2}" y="${y + 58}" text-anchor="middle" class="metric" fill="#f1e2c7">${esc(short(value, 15))}</text>`
}

function slider(label: string, value: any, x: number, y: number, color: string) {
  const p = levelPercent(value, 50)
  const knob = x + Math.round((150 * p) / 100)
  return `<text x="${x + 75}" y="${y}" text-anchor="middle" class="tiny" fill="#b68b56">${esc(label)}</text>
<line x1="${x}" y1="${y + 24}" x2="${x + 150}" y2="${y + 24}" stroke="#51483d" stroke-width="4" stroke-linecap="round"/>
<circle cx="${knob}" cy="${y + 24}" r="8" fill="${color}"/>
<text x="${x}" y="${y + 47}" class="label" fill="#77736c">LOW</text><text x="${x + 126}" y="${y + 47}" class="label" fill="#77736c">HIGH</text>`
}

function productSteps(items: string[], x: number, y: number, tags: string[]) {
  return items.slice(0, 5).map((item, index) => {
    const xx = x + index * 108
    return `<rect x="${xx + 26}" y="${y}" width="48" height="58" rx="12" fill="#ded5c2" stroke="#a9987a"/>
<path d="M${xx + 34} ${y + 6} h32" stroke="#f6efe2" stroke-width="3" opacity=".55"/>
<text x="${xx + 50}" y="${y + 78}" text-anchor="middle" class="label" fill="#e4d8c1">${esc(short(item, 18))}</text>
<rect x="${xx + 10}" y="${y + 91}" width="80" height="18" rx="9" fill="#b99158"/>
<text x="${xx + 50}" y="${y + 105}" text-anchor="middle" class="tag">${esc(tags[index] || 'STEP')}</text>`
  }).join('')
}

function imageBlock(imageDataUrl: string | null, x: number, y: number, w: number, h: number, withOverlay = false) {
  const image = imageDataUrl
    ? `<image href="${imageDataUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip${x}${y})"/>`
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="url(#faceBg)"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" class="mini" fill="#c9a66f">SELFIE</text>`

  const overlay = withOverlay ? `<ellipse cx="${x + w * 0.5}" cy="${y + h * 0.22}" rx="${w * 0.20}" ry="${h * 0.08}" fill="#d9a259" opacity=".28" stroke="#e2bf85"/>
<ellipse cx="${x + w * 0.36}" cy="${y + h * 0.45}" rx="${w * 0.16}" ry="${h * 0.11}" fill="#7da8c8" opacity=".24" stroke="#a9bfca"/>
<ellipse cx="${x + w * 0.64}" cy="${y + h * 0.45}" rx="${w * 0.16}" ry="${h * 0.11}" fill="#7da8c8" opacity=".24" stroke="#a9bfca"/>
<rect x="${x + w * 0.43}" y="${y + h * 0.34}" width="${w * 0.14}" height="${h * 0.34}" rx="18" fill="#c99a5d" opacity=".18"/>
<ellipse cx="${x + w * 0.5}" cy="${y + h * 0.83}" rx="${w * 0.23}" ry="${h * 0.08}" fill="#7d9f66" opacity=".22" stroke="#8aa36c"/>` : ''

  return `<clipPath id="clip${x}${y}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/></clipPath>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#111210" stroke="#5a4430"/>${image}${overlay}`
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
  const imageDataUrl = await getImageDataUrl(report)
  const hydration = scorePercent(score(report, 'hydration', 70), 70)
  const barrier = scorePercent(score(report, 'barrier_support', 65), 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const sensitivity = short(score(report, 'sensitivity', 'low'), 16)
  const skinType = short(report.skin_type || 'Combination', 20)
  const observations = list(report.observations_json || [], 5, ['T-zone shine visible', 'Mild under-eye darkness', 'Even overall tone', 'Skin barrier appears stable'])
  const am = list(report.am_routine_json || [], 5, ['Gentle cleanser', 'Hydrating serum', 'Niacinamide serum', 'Light moisturizer', 'SPF 50 sunscreen'])
  const pm = list(report.pm_routine_json || [], 4, ['Gentle cleanser', 'Repair treatment', 'Barrier serum', 'Light moisturizer'])
  const cautions = list(report.cautions_json || [], 4, ['Harsh exfoliation', 'Strong acids too often', 'Stripping cleansers', 'Heavy fragrance'])
  const forehead = short(zone(report, 'forehead', 'mild texture'), 30)
  const underEye = short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'mild darkness', 30)
  const cheeks = short(zone(report, 'cheeks', 'even tone'), 30)
  const tzone = short(zone(report, 'nose_t-zone') || zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || 'visible oiliness', 30)
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'balanced', 30)
  const dateLabel = report?.created_at ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs><linearGradient id="faceBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#352821"/><stop offset="1" stop-color="#141514"/></linearGradient><style>.title{font:700 42px Georgia,serif;letter-spacing:4px;fill:#c49a61}.sub{font:800 15px Arial,sans-serif;letter-spacing:5px;fill:#8b8f89}.sect{font:900 18px Arial,sans-serif;letter-spacing:1.4px;fill:#c59a60}.tiny{font:900 10px Arial,sans-serif;letter-spacing:.8px}.metric{font:900 15px Arial,sans-serif}.mini{font:700 12px Arial,sans-serif}.label{font:700 9px Arial,sans-serif}.tag{font:900 9px Arial,sans-serif;fill:#121411}.note{font:900 14px Arial,sans-serif;fill:#baa37f}</style></defs>
<rect width="1080" height="1350" fill="#080a09"/><circle cx="930" cy="60" r="280" fill="#123d30" opacity=".42"/>
<text x="540" y="74" text-anchor="middle" class="title">SKIN ANALYSIS &amp; CONSULTATION</text><text x="540" y="110" text-anchor="middle" class="sub">PERSONALIZED SKIN INSIGHTS</text><text x="1000" y="56" text-anchor="end" class="mini" fill="#ceb386">${esc(dateLabel)}</text>

<rect x="38" y="135" width="392" height="340" rx="20" fill="#111210" stroke="#2b2d29"/><text x="58" y="169" class="sect">SELFIE PREVIEW</text>${imageBlock(imageDataUrl, 60, 188, 348, 260, false)}

<rect x="450" y="135" width="592" height="340" rx="20" fill="#111210" stroke="#2b2d29"/><text x="470" y="169" class="sect">FACIAL MAP &amp; OBSERVATIONS</text>${imageBlock(imageDataUrl, 472, 188, 250, 260, true)}${bullet([`Forehead: ${forehead}`,`Under-eye: ${underEye}`,`Cheeks: ${cheeks}`,`Nose / T-zone: ${tzone}`,`Chin / Jawline: ${chin}`], 752, 215, 33)}

<rect x="38" y="492" width="1004" height="142" rx="20" fill="#111210" stroke="#2b2d29"/><text x="58" y="526" class="sect">AT A GLANCE</text>${metric('SKIN TYPE', skinType, 64, 542)}${metric('OILINESS', oiliness, 202, 542)}${metric('TEXTURE', texture, 340, 542)}${metric('HYDRATION', `${hydration}%`, 478, 542)}${metric('BARRIER', `${barrier}%`, 616, 542)}${metric('SENSITIVITY', sensitivity, 754, 542)}<rect x="892" y="542" width="118" height="82" rx="14" fill="#151614" stroke="#322d25"/><text x="951" y="569" text-anchor="middle" class="tiny" fill="#8f806d">CONFIDENCE</text><text x="951" y="600" text-anchor="middle" class="metric" fill="#f1e2c7">${esc(short(report.confidence_level || 'high', 12))}</text>

<rect x="38" y="650" width="1004" height="132" rx="20" fill="#111210" stroke="#2b2d29"/><text x="58" y="684" class="sect">CONCERNS &amp; SKIN METRICS</text>${['TEXTURE','REDNESS','DEHYDRATION','FINE LINES','PORES','OILINESS'].map((label,i)=>{const x=76+i*82;return `<circle cx="${x}" cy="724" r="22" fill="#221c16" stroke="#b48c58"/><text x="${x}" y="731" text-anchor="middle" font-size="18" font-weight="900" fill="#c59a60">${label[0]}</text><text x="${x}" y="764" text-anchor="middle" class="label" fill="#c8a16a">${label}</text>`}).join('')}${slider('TEXTURE', texture, 620, 706, '#c59a60')}${slider('PORES', tzone, 795, 706, '#6485b2')}

<rect x="38" y="800" width="740" height="205" rx="20" fill="#111210" stroke="#2b2d29"/><text x="58" y="833" class="sect">CURRENT VS TARGET BALANCE</text>${imageBlock(imageDataUrl, 60, 855, 135, 118, false)}${bullet(observations.slice(0,4), 220, 876, 35)}<text x="440" y="928" font-size="38" font-weight="900" fill="#c89a58">&gt;</text>${imageBlock(imageDataUrl, 478, 855, 135, 118, true)}${bullet(['Smoother visible texture','Hydrated glow','Calmer tone','Stronger skin barrier'], 638, 876, 28)}

<rect x="796" y="800" width="246" height="205" rx="20" fill="#111210" stroke="#3b2b29"/><text x="816" y="833" class="sect">AVOID / CAUTION</text>${cautions.slice(0,4).map((item,i)=>`<circle cx="828" cy="${868+i*34}" r="14" fill="none" stroke="#6e322f"/><text x="828" y="${874+i*34}" text-anchor="middle" font-size="18" font-weight="900" fill="#d16c60">!</text><text x="850" y="${874+i*34}" class="mini" fill="#cf8478">${esc(short(item,24))}</text>`).join('')}

<rect x="38" y="1022" width="1004" height="230" rx="20" fill="#111210" stroke="#2b2d29"/><text x="58" y="1055" class="sect">PERSONALIZED ROUTINE</text><text x="70" y="1110" class="sect" fill="#d5b279">AM</text>${productSteps(am, 126, 1075, ['CLEANSE','HYDRATE','BALANCE','REPAIR','PROTECT'])}<text x="70" y="1210" class="sect" fill="#8da6d8">PM</text>${productSteps(pm, 126, 1175, ['CLEANSE','RENEW','SOOTHE','REPAIR'])}

<rect x="38" y="1276" width="1004" height="40" rx="12" fill="#111210" stroke="#2b2d29"/><text x="64" y="1302" class="note" fill="#d4a66d">EXPERT NOTES</text><text x="220" y="1302" class="note">BARRIER FIRST</text><text x="390" y="1302" class="note">HYDRATE DAILY</text><text x="560" y="1302" class="note">PROTECT AM</text><text x="720" y="1302" class="note">CONSISTENCY WINS</text></svg>`
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
