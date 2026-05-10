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
    .replace(/"/g, '&quot;')
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

function svgBullet(items: string[], x: number, startY: number, max = 4) {
  return list(items, max)
    .map((item, index) => `<text x="${x}" y="${startY + index * 28}" class="small">• ${esc(item).slice(0, 72)}</text>`)
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
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071d18"/>
      <stop offset="0.52" stop-color="#102620"/>
      <stop offset="1" stop-color="#050908"/>
    </linearGradient>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff6e6" stop-opacity="0.98"/>
      <stop offset="1" stop-color="#e7d6b8" stop-opacity="0.95"/>
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
  <rect width="1080" height="1350" fill="url(#bg)"/>
  <circle cx="920" cy="160" r="260" fill="#0f8f67" opacity="0.14"/>
  <circle cx="100" cy="1260" r="300" fill="#d8b76b" opacity="0.09"/>

  <text x="70" y="88" class="title">ASKGOGO SKIN CHECK</text>
  <text x="73" y="124" class="sub">VISUAL SKINCARE OBSERVATION</text>
  <text x="830" y="92" class="pill">${esc(dateLabel)}</text>

  <rect x="60" y="165" width="960" height="1110" rx="34" fill="url(#card)" stroke="#d5bd84" stroke-width="2"/>

  <text x="100" y="225" class="cardTitle">1. At a glance</text>
  <rect x="100" y="255" width="270" height="132" rx="22" fill="#f8efd9" stroke="#d1bd8a"/>
  <text x="126" y="292" class="tiny">SKIN TYPE INDICATOR</text>
  <text x="126" y="332" class="small">${esc(report.skin_type || 'Not captured').slice(0, 28)}</text>
  <text x="126" y="362" class="tiny">Based on visible selfie cues</text>

  <rect x="405" y="255" width="270" height="132" rx="22" fill="#f8efd9" stroke="#d1bd8a"/>
  <text x="431" y="292" class="tiny">OILINESS</text>
  <text x="431" y="342" class="score">${esc(oiliness).slice(0, 10)}</text>

  <rect x="710" y="255" width="270" height="132" rx="22" fill="#f8efd9" stroke="#d1bd8a"/>
  <text x="736" y="292" class="tiny">TEXTURE</text>
  <text x="736" y="342" class="score">${esc(texture).slice(0, 10)}</text>

  <text x="100" y="452" class="cardTitle">2. Skin scores</text>
  <rect x="100" y="482" width="420" height="145" rx="24" fill="#f8efd9" stroke="#d1bd8a"/>
  <text x="130" y="530" class="label">Hydration</text>
  <rect x="130" y="558" width="320" height="16" rx="8" fill="#e0cfaa"/>
  <rect x="130" y="558" width="${hydrationWidth}" height="16" rx="8" fill="#2e8f75"/>
  <text x="458" y="578" class="small">${esc(hydration)}/100</text>

  <rect x="560" y="482" width="420" height="145" rx="24" fill="#f8efd9" stroke="#d1bd8a"/>
  <text x="590" y="530" class="label">Barrier support</text>
  <rect x="590" y="558" width="320" height="16" rx="8" fill="#e0cfaa"/>
  <rect x="590" y="558" width="${barrierWidth}" height="16" rx="8" fill="#c2994b"/>
  <text x="918" y="578" class="small">${esc(barrier)}/100</text>

  <text x="100" y="697" class="cardTitle">3. Face map</text>
  <rect x="100" y="730" width="880" height="205" rx="24" fill="#f8efd9" stroke="#d1bd8a"/>
  <text x="135" y="778" class="small">Forehead: ${esc(zone(report, 'forehead')).slice(0, 48)}</text>
  <text x="135" y="818" class="small">Under-eye: ${esc(zone(report, 'under-eye') || zone(report, 'under_eye')).slice(0, 48)}</text>
  <text x="135" y="858" class="small">Cheeks: ${esc(zone(report, 'cheeks')).slice(0, 48)}</text>
  <text x="135" y="898" class="small">T-zone: ${esc(zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || zone(report, 'nose_t-zone')).slice(0, 48)}</text>

  <text x="100" y="1006" class="cardTitle">4. Key observations</text>
  ${svgBullet(observations, 105, 1045, 4)}

  <rect x="610" y="980" width="370" height="225" rx="24" fill="#173a31" opacity="0.94"/>
  <text x="640" y="1028" class="white" style="font:700 23px Arial,sans-serif">Routine focus</text>
  <text x="640" y="1072" class="pill">AM</text>
  ${am.map((item, i) => `<text x="690" y="1072" class="pill" transform="translate(0 ${i * 30})">${i + 1}. ${esc(item).slice(0, 32)}</text>`).join('')}
  <text x="640" y="1180" class="pill">PM</text>
  ${pm.slice(0, 2).map((item, i) => `<text x="690" y="1180" class="pill" transform="translate(0 ${i * 30})">${i + 1}. ${esc(item).slice(0, 32)}</text>`).join('')}

  <text x="100" y="1218" class="tiny">Avoid this week: ${esc(cautions.join(' • ')).slice(0, 100)}</text>
  <text x="100" y="1260" class="tiny">Not medical advice. For irritation, infection, painful acne, rashes or changing moles, consult a dermatologist.</text>
</svg>`.trim()
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
      `Tip: take your next selfie in similar lighting for cleaner progress tracking.`,
    mediaUrl,
  }
}
