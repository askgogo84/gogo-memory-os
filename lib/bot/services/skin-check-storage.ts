import { supabaseAdmin } from '@/lib/supabase-admin'

type ParsedSkinReport = {
  summary?: string
  lighting_quality?: string
  face_visibility?: string
  confidence_level?: string
  skin_type?: string
  observations_json?: any[]
  scores_json?: Record<string, any>
  face_zones_json?: Record<string, string>
  am_routine_json?: string[]
  pm_routine_json?: string[]
  cautions_json?: string[]
  progress_tip?: string
}

const SECTION_HEADINGS = [
  'Important',
  'Photo quality',
  'Face map',
  'Face-zone observations',
  'Key observations',
  'Visible observations',
  'Skin type indicator',
  'Possible skin type indicators',
  'Skin scores',
  'Personalized AM',
  'Suggested AM routine',
  'Personalized PM',
  'Suggested PM routine',
  'Avoid this week',
  'Avoid / caution',
  'Choose your goal',
  'Next',
  'Progress tip',
]

function stripMarkdown(text: string) {
  return String(text || '').replace(/\*/g, '').trim()
}

function extractSection(text: string, heading: string) {
  const plain = stripMarkdown(text)
  const escaped = SECTION_HEADINGS.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const regex = new RegExp(`${heading}\\s*\\n([\\s\\S]*?)(?=\\n(?:${escaped})\\s*\\n|$)`, 'i')
  const match = plain.match(regex)
  return (match?.[1] || '').trim()
}

function cleanLine(line: string) {
  return String(line || '')
    .replace(/^[-•\d.)\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function listLines(section: string) {
  return section
    .split('\n')
    .map(cleanLine)
    .filter(Boolean)
}

function valueAfterColon(line: string) {
  const index = line.indexOf(':')
  if (index === -1) return line.trim()
  return line.slice(index + 1).trim()
}

function parsePhotoQuality(section: string) {
  const lines = listLines(section)
  const find = (label: string) => valueAfterColon(lines.find((line) => line.toLowerCase().startsWith(label)) || '')

  return {
    lighting_quality: find('lighting') || undefined,
    face_visibility: find('face visibility') || undefined,
    confidence_level: find('confidence') || undefined,
  }
}

function parseFaceZones(section: string) {
  const zones: Record<string, string> = {}
  for (const line of listLines(section)) {
    const [key, ...rest] = line.split(':')
    if (!key || !rest.length) continue
    zones[key.trim().toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_')] = rest.join(':').trim()
  }
  return zones
}

function parseScores(section: string) {
  const scores: Record<string, any> = {}
  for (const line of listLines(section)) {
    const [key, ...rest] = line.split(':')
    if (!key || !rest.length) continue
    const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_')
    const raw = rest.join(':').trim()
    const number = raw.match(/\d+/)?.[0]
    scores[normalizedKey] = number && /hydration|barrier/.test(normalizedKey) ? Number(number) : raw
  }
  return scores
}

function firstNonEmpty(...values: string[]) {
  return values.find((value) => value && value.trim()) || ''
}

export function parseSkinCheckReport(rawReport: string): ParsedSkinReport {
  const photo = parsePhotoQuality(extractSection(rawReport, 'Photo quality'))
  const faceZones = parseFaceZones(firstNonEmpty(
    extractSection(rawReport, 'Face map'),
    extractSection(rawReport, 'Face-zone observations')
  ))
  const observations = listLines(firstNonEmpty(
    extractSection(rawReport, 'Key observations'),
    extractSection(rawReport, 'Visible observations')
  )).slice(0, 8)
  const skinType = cleanLine(firstNonEmpty(
    extractSection(rawReport, 'Skin type indicator'),
    extractSection(rawReport, 'Possible skin type indicators')
  ))
  const scores = parseScores(extractSection(rawReport, 'Skin scores'))
  const amRoutine = listLines(firstNonEmpty(
    extractSection(rawReport, 'Personalized AM'),
    extractSection(rawReport, 'Suggested AM routine')
  )).slice(0, 8)
  const pmRoutine = listLines(firstNonEmpty(
    extractSection(rawReport, 'Personalized PM'),
    extractSection(rawReport, 'Suggested PM routine')
  )).slice(0, 8)
  const cautions = listLines(firstNonEmpty(
    extractSection(rawReport, 'Avoid this week'),
    extractSection(rawReport, 'Avoid / caution')
  )).slice(0, 8)
  const progressTip = cleanLine(firstNonEmpty(
    extractSection(rawReport, 'Next'),
    extractSection(rawReport, 'Progress tip')
  ))

  const summaryParts = []
  if (skinType) summaryParts.push(skinType)
  if (observations[0]) summaryParts.push(observations[0])
  if (observations[1]) summaryParts.push(observations[1])

  return {
    ...photo,
    skin_type: skinType || undefined,
    summary: summaryParts.join(' • ').slice(0, 500),
    observations_json: observations,
    scores_json: scores,
    face_zones_json: faceZones,
    am_routine_json: amRoutine,
    pm_routine_json: pmRoutine,
    cautions_json: cautions,
    progress_tip: progressTip || undefined,
  }
}

export async function saveSkinCheckReport(params: {
  telegramId: number
  imageUrl?: string | null
  rawReport: string
}) {
  const parsed = parseSkinCheckReport(params.rawReport)

  const { data, error } = await supabaseAdmin
    .from('skin_check_reports')
    .insert({
      telegram_id: params.telegramId,
      source_platform: 'whatsapp',
      image_url: params.imageUrl || null,
      summary: parsed.summary || null,
      lighting_quality: parsed.lighting_quality || null,
      face_visibility: parsed.face_visibility || null,
      confidence_level: parsed.confidence_level || null,
      skin_type: parsed.skin_type || null,
      observations_json: parsed.observations_json || [],
      scores_json: parsed.scores_json || {},
      face_zones_json: parsed.face_zones_json || {},
      am_routine_json: parsed.am_routine_json || [],
      pm_routine_json: parsed.pm_routine_json || [],
      cautions_json: parsed.cautions_json || [],
      progress_tip: parsed.progress_tip || null,
      raw_report: params.rawReport,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[skin-check-storage] save failed:', error.message)
    return null
  }

  return data
}

export async function getLatestSkinChecks(telegramId: number, limit = 5) {
  const { data, error } = await supabaseAdmin
    .from('skin_check_reports')
    .select('*')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[skin-check-storage] fetch failed:', error.message)
    return []
  }

  return data || []
}
