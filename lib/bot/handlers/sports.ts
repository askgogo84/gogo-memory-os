import { saveFollowupState } from './followup-state'

type SportsReplyResult = {
  reply: string
  followup?: {
    kind: string
    payload: Record<string, any>
  }
}

function toIsoWithIst(dateText: string, timeText: string) {
  const monthMap: Record<string, number> = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  }

  const m = dateText.match(/(\d{1,2})\s+([A-Za-z]{3}),\s*(\d{4})/)
  const t = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)

  if (!m || !t) return null

  const day = Number(m[1])
  const month = monthMap[m[2]]
  const year = Number(m[3])

  let hour = Number(t[1])
  const minute = Number(t[2])
  const ampm = t[3].toUpperCase()

  if (ampm === 'PM' && hour < 12) hour += 12
  if (ampm === 'AM' && hour === 12) hour = 0

  const utc = new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0))
  return utc.toISOString()
}

export function buildSportsReply(input: string): string | null {
  const lower = input.toLowerCase()

  if (
    lower.includes('next rcb match') ||
    lower.includes('when is next rcb match') ||
    lower.includes('when is the next rcb match')
  ) {
    return `RCB's next match is RCB vs GT on Fri, 24 Apr, 2026.\n\nWant me to set a reminder for it?`
  }

  return null
}

export async function buildSportsReplyWithState(
  input: string,
  telegramId: number
): Promise<SportsReplyResult | null> {
  const lower = input.toLowerCase()

  if (
    lower.includes('next rcb match') ||
    lower.includes('when is next rcb match') ||
    lower.includes('when is the next rcb match')
  ) {
    const matchIso = toIsoWithIst('24 Apr, 2026', '7:30 PM')
    if (matchIso) {
      await saveFollowupState(telegramId, 'sports_match', {
        team: 'RCB',
        opponent: 'GT',
        match_label: 'RCB vs GT',
        match_time_iso: matchIso,
      })
    }

    return {
      reply: `RCB's next match is RCB vs GT on Fri, 24 Apr, 2026.\n\nWant me to set a reminder for it?`,
    }
  }

  return null
}
