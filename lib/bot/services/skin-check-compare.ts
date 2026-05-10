import { getLatestSkinChecks } from '@/lib/bot/services/skin-check-storage'

function formatDate(value: string) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function scoreValue(report: any, key: string) {
  return report?.scores_json?.[key]
}

function compareScore(label: string, current: any, previous: any, key: string) {
  const c = Number(scoreValue(current, key))
  const p = Number(scoreValue(previous, key))
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null
  const diff = c - p
  const sign = diff > 0 ? '+' : ''
  return `• ${label}: ${p} → ${c} (${sign}${diff})`
}

export function isSkinHistoryCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'skin history' ||
    lower === 'my skin history' ||
    lower === 'show skin history' ||
    lower === 'show my skin history' ||
    lower === 'last skin check' ||
    lower === 'when was my last skin check'
  )
}

export function isSkinCompareCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'compare skin' ||
    lower === 'compare skin check' ||
    lower === 'compare with last skin check' ||
    lower === 'compare my skin' ||
    lower === 'what changed from last skin check' ||
    lower === 'skin progress'
  )
}

export async function buildSkinHistoryReply(telegramId: number) {
  const reports = await getLatestSkinChecks(telegramId, 5)

  if (!reports.length) {
    return `✨ *Skin history*\n\nNo skin checks saved yet.\n\nSend a clear selfie with caption: *skin check*.`
  }

  const lines = reports.map((report: any, index: number) => {
    const date = formatDate(report.created_at)
    const type = report.skin_type || 'skin type not captured'
    const hydration = report.scores_json?.hydration ? ` • Hydration ${report.scores_json.hydration}` : ''
    const barrier = report.scores_json?.barrier_support ? ` • Barrier ${report.scores_json.barrier_support}` : ''
    return `${index + 1}. ${date}\n   ${type}${hydration}${barrier}`
  })

  return `✨ *Skin history*\n\n${lines.join('\n\n')}\n\nTry: *compare with last skin check*`
}

export async function buildSkinCompareReply(telegramId: number) {
  const reports = await getLatestSkinChecks(telegramId, 2)

  if (reports.length < 2) {
    return `✨ *Skin progress*\n\nI need at least 2 skin checks to compare progress.\n\nTake another selfie in similar lighting after a few days and send: *skin check*.`
  }

  const [current, previous] = reports
  const scoreLines = [
    compareScore('Hydration', current, previous, 'hydration'),
    compareScore('Barrier support', current, previous, 'barrier_support'),
  ].filter(Boolean)

  const currentObs = (current.observations_json || []).slice(0, 3)
  const previousObs = (previous.observations_json || []).slice(0, 2)

  return (
    `✨ *Skin progress comparison*\n\n` +
    `Previous: ${formatDate(previous.created_at)}\n` +
    `Current: ${formatDate(current.created_at)}\n\n` +
    `*Current indicators*\n` +
    `• ${current.skin_type || 'Not captured'}\n` +
    currentObs.map((item: string) => `• ${item}`).join('\n') +
    `\n\n` +
    (scoreLines.length ? `*Score movement*\n${scoreLines.join('\n')}\n\n` : '') +
    `*Previous notes*\n` +
    previousObs.map((item: string) => `• ${item}`).join('\n') +
    `\n\n` +
    `Tip: take progress selfies in the same lighting and angle for better comparison.`
  )
}
