import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

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
  const values = (items || [])
    .map((item) => clean(item, ''))
    .filter(Boolean)
    .slice(0, limit)

  return values.length ? values : fallback.slice(0, limit)
}

function bullet(items: string[], x: number, y: number) {
  return items
    .map((item, index) => {
      const yy = y + index * 30
      return `<circle cx="${x}" cy="${yy - 6}" r="4" fill="#c59a60"/>
<text x="${x + 14}" y="${yy}" class="mini" fill="#dfd3bc">${esc(short(item, 42))}</text>`
    })
    .join('')
}

function metric(label: string, value: string, x: number, y: number) {
  return `<rect x="${x}" y="${y}" width="145" height="88" rx="14" fill="#161715" stroke="#2f312d"/>
<text x="${x + 72}" y="${y + 28}" text-anchor="middle" class="tiny" fill="#8a816f">${esc(label)}</text>
<text x="${x + 72}" y="${y + 58}" text-anchor="middle" class="metric" fill="#e8decb">${esc(short(value, 16))}</text>`
}

function faceSvg(x: number, y: number, scale = 1) {
  return `<g transform="translate(${x},${y}) scale(${scale})">
<ellipse cx="168" cy="132" rx="75" ry="108" fill="#8e624a"/>
<ellipse cx="168" cy="42" rx="92" ry="36" fill="#2b221d"/>
<rect x="128" y="96" width="38" height="12" rx="6" fill="#1a1614"/>
<rect x="188" y="96" width="38" height="12" rx="6" fill="#1a1614"/>
<rect x="164" y="124" width="20" height="48" rx="10" fill="#755041"/>
<rect x="136" y="198" width="68" height="10" rx="5" fill="#3a2320"/>
<ellipse cx="168" cy="82" rx="55" ry="22" fill="#d7a05c" opacity=".25" stroke="#d5b27b"/>
<ellipse cx="122" cy="132" rx="34" ry="24" fill="#7ba7c3" opacity=".22" stroke="#a9bfca"/>
<ellipse cx="214" cy="132" rx="34" ry="24" fill="#7ba7c3" opacity=".22" stroke="#a9bfca"/>
<rect x="154" y="118" width="32" height="86" rx="16" fill="#c99a5d" opacity=".20"/>
<ellipse cx="168" cy="224" rx="54" ry="20" fill="#7d9f66" opacity=".24" stroke="#7d9f66"/>
</g>`
}

function productSteps(items: string[], x: number, y: number, tags: string[]) {
  return items
    .slice(0, 5)
    .map((item, index) => {
      const xx = x + index * 120
      return `<rect x="${xx + 28}" y="${y}" width="48" height="62" rx="12" fill="#d9cfbd" stroke="#9f9277"/>
<text x="${xx + 52}" y="${y + 84}" text-anchor="middle" class="label" fill="#ddd2be">${esc(short(item, 18))}</text>
<rect x="${xx + 12}" y="${y + 96}" width="80" height="18" rx="9" fill="#b7925d"/>
<text x="${xx + 52}" y="${y + 110}" text-anchor="middle" class="tag">${esc(tags[index] || 'STEP')}</text>`
    })
    .join('')
}

function buildSvg(report: any) {
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
  const underEye = short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'mild darkness', 28)
  const cheeks = short(zone(report, 'cheeks', 'even tone'), 28)
  const tzone = short(zone(report, 'nose_t-zone') || zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || 'visible oiliness', 28)
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'balanced', 28)

  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs>
<linearGradient id="faceBg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#352821"/>
<stop offset="1" stop-color="#141514"/>
</linearGradient>
<style>
.title{font:700 42px Georgia,serif;letter-spacing:4px;fill:#c49a61}
.sub{font:800 15px Arial,sans-serif;letter-spacing:5px;fill:#8b8f89}
.sect{font:900 18px Arial,sans-serif;letter-spacing:1.4px;fill:#c59a60}
.tiny{font:900 11px Arial,sans-serif;letter-spacing:.8px}
.metric{font:900 15px Arial,sans-serif}
.mini{font:700 13px Arial,sans-serif}
.label{font:700 10px Arial,sans-serif}
.tag{font:900 9px Arial,sans-serif;fill:#121411}
.note{font:900 14px Arial,sans-serif;fill:#baa37f}
</style>
</defs>

<rect width="1080" height="1350" fill="#080a09"/>
<text x="540" y="74" text-anchor="middle" class="title">SKIN ANALYSIS &amp; CONSULTATION</text>
<text x="540" y="110" text-anchor="middle" class="sub">PERSONALIZED SKIN INSIGHTS</text>
<text x="1000" y="56" text-anchor="end" class="mini" fill="#ceb386">${esc(dateLabel)}</text>

<rect x="42" y="138" width="380" height="330" rx="20" fill="#111210" stroke="#2b2d29"/>
<text x="62" y="170" class="sect">SELFIE PREVIEW</text>
<rect x="64" y="190" width="336" height="250" rx="18" fill="url(#faceBg)" stroke="#5a4430"/>
${faceSvg(64, 190, 1)}

<rect x="442" y="138" width="596" height="330" rx="20" fill="#111210" stroke="#2b2d29"/>
<text x="462" y="170" class="sect">FACIAL MAP</text>
<rect x="462" y="190" width="250" height="250" rx="18" fill="url(#faceBg)" stroke="#5a4430"/>
${faceSvg(412, 190, 1)}
${bullet([`Forehead: ${forehead}`, `Under-eye: ${underEye}`, `Cheeks: ${cheeks}`, `Nose / T-zone: ${tzone}`, `Chin / Jawline: ${chin}`], 742, 220)}

<rect x="42" y="486" width="996" height="148" rx="20" fill="#111210" stroke="#2b2d29"/>
<text x="62" y="520" class="sect">AT A GLANCE</text>
${metric('SKIN TYPE', skinType, 68, 536)}
${metric('OILINESS', oiliness, 225, 536)}
${metric('TEXTURE', texture, 382, 536)}
${metric('HYDRATION', `${hydration}%`, 539, 536)}
${metric('BARRIER', `${barrier}%`, 696, 536)}
${metric('SENSITIVITY', sensitivity, 853, 536)}

<rect x="42" y="650" width="996" height="126" rx="20" fill="#111210" stroke="#2b2d29"/>
<text x="62" y="682" class="sect">CONCERNS</text>
${['TEXTURE', 'REDNESS', 'DEHYDRATION', 'FINE LINES', 'PORES'].map((label, i) => {
  const x = 76 + i * 92
  return `<circle cx="${x}" cy="718" r="22" fill="#221c16" stroke="#b48c58"/>
<text x="${x}" y="725" text-anchor="middle" font-size="18" font-weight="900" fill="#c59a60">${label[0]}</text>
<text x="${x}" y="760" text-anchor="middle" class="label" fill="#c8a16a">${label}</text>`
}).join('')}

<rect x="42" y="792" width="736" height="202" rx="20" fill="#111210" stroke="#2b2d29"/>
<text x="62" y="824" class="sect">CURRENT VS TARGET BALANCE</text>
<rect x="62" y="842" width="130" height="115" rx="14" fill="url(#faceBg)" stroke="#5a4430"/>
${faceSvg(-25, 800, .55)}
${bullet(observations.slice(0, 4), 220, 864)}
<text x="440" y="922" font-size="38" font-weight="900" fill="#c89a58">&gt;</text>
<rect x="480" y="842" width="130" height="115" rx="14" fill="url(#faceBg)" stroke="#5a4430"/>
${faceSvg(393, 800, .55)}
${bullet(['Smoother visible texture', 'Hydrated glow', 'Calmer tone', 'Stronger barrier'], 635, 864)}

<rect x="796" y="792" width="242" height="202" rx="20" fill="#111210" stroke="#3b2b29"/>
<text x="816" y="824" class="sect">AVOID / CAUTION</text>
${cautions.slice(0, 4).map((item, i) => `<circle cx="828" cy="${858 + i * 34}" r="14" fill="none" stroke="#6e322f"/>
<text x="828" y="${864 + i * 34}" text-anchor="middle" font-size="18" font-weight="900" fill="#d16c60">!</text>
<text x="850" y="${864 + i * 34}" class="mini" fill="#cf8478">${esc(short(item, 24))}</text>`).join('')}

<rect x="42" y="1010" width="996" height="230" rx="20" fill="#111210" stroke="#2b2d29"/>
<text x="62" y="1042" class="sect">PERSONALIZED ROUTINE</text>
<text x="70" y="1098" class="sect" fill="#d5b279">AM</text>
${productSteps(am, 130, 1060, ['CLEANSE', 'HYDRATE', 'BALANCE', 'REPAIR', 'PROTECT'])}
<text x="70" y="1198" class="sect" fill="#8da6d8">PM</text>
${productSteps(pm, 130, 1160, ['CLEANSE', 'RENEW', 'SOOTHE', 'REPAIR'])}

<rect x="42" y="1276" width="996" height="40" rx="12" fill="#111210" stroke="#2b2d29"/>
<text x="64" y="1302" class="note" fill="#d4a66d">EXPERT NOTES</text>
<text x="220" y="1302" class="note">BARRIER FIRST</text>
<text x="390" y="1302" class="note">HYDRATE DAILY</text>
<text x="560" y="1302" class="note">PROTECT AM</text>
<text x="720" y="1302" class="note">CONSISTENCY WINS</text>
</svg>`
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params

    const { data: report, error } = await supabaseAdmin
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

    return new NextResponse(buildSvg(report), {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error: any) {
    console.error('[skin-report-card] route failed:', error?.message || error)
    return new NextResponse('Skin report failed to render', { status: 500 })
  }
}