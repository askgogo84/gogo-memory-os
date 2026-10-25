import { saveFollowupState } from './followup-state'

type SportsReplyResult = {
  reply: string
  followup?: {
    kind: string
    payload: Record<string, any>
  }
}

type Match = {
  team: string
  opponent: string
  label: string
  venue: string
  city: string
  dateText: string
  timeText: string
  iso: string
}

function istToUtcIso(year: number, month: number, day: number, hour: number, minute: number) {
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 5, minute - 30, 0))
  return utc.toISOString()
}

const RCB_2026_MATCHES: Match[] = [
  {
    team: 'RCB',
    opponent: 'SRH',
    label: 'RCB vs SRH',
    venue: 'M. Chinnaswamy Stadium',
    city: 'Bengaluru',
    dateText: 'Sat, 28 Mar, 2026',
    timeText: '7:30 PM IST',
    iso: istToUtcIso(2026, 3, 28, 19, 30),
  },
  {
    team: 'RCB',
    opponent: 'CSK',
    label: 'RCB vs CSK',
    venue: 'M. Chinnaswamy Stadium',
    city: 'Bengaluru',
    dateText: 'Sun, 5 Apr, 2026',
    timeText: '7:30 PM IST',
    iso: istToUtcIso(2026, 4, 5, 19, 30),
  },
  {
    team: 'RR',
    opponent: 'RCB',
    label: 'RR vs RCB',
    venue: 'ACA Stadium',
    city: 'Guwahati',
    dateText: 'Fri, 10 Apr, 2026',
    timeText: '7:30 PM IST',
    iso: istToUtcIso(2026, 4, 10, 19, 30),
  },
  {
    team: 'MI',
    opponent: 'RCB',
    label: 'MI vs RCB',
    venue: 'Wankhede Stadium',
    city: 'Mumbai',
    dateText: 'Sun, 12 Apr, 2026',
    timeText: '7:30 PM IST',
    iso: istToUtcIso(2026, 4, 12, 19, 30),
  },
  {
    team: 'RCB',
    opponent: 'LSG',
    label: 'RCB vs LSG',
    venue: 'M. Chinnaswamy Stadium',
    city: 'Bengaluru',
    dateText: 'Wed, 15 Apr, 2026',
    timeText: '7:30 PM IST',
    iso: istToUtcIso(2026, 4, 15, 19, 30),
  },
  {
    team: 'RCB',
    opponent: 'DC',
    label: 'RCB vs DC',
    venue: 'M. Chinnaswamy Stadium',
    city: 'Bengaluru',
    dateText: 'Sat, 18 Apr, 2026',
    timeText: '3:30 PM IST',
    iso: istToUtcIso(2026, 4, 18, 15, 30),
  },
  {
    team: 'RCB',
    opponent: 'GT',
    label: 'RCB vs GT',
    venue: 'M. Chinnaswamy Stadium',
    city: 'Bengaluru',
    dateText: 'Fri, 24 Apr, 2026',
    timeText: '7:30 PM IST',
    iso: istToUtcIso(2026, 4, 24, 19, 30),
  },
  {
    team: 'DC',
    opponent: 'RCB',
    label: 'DC vs RCB',
    venue: 'Arun Jaitley Stadium',
    city: 'Delhi',
    dateText: 'Mon, 27 Apr, 2026',
    timeText: '7:30 PM IST',
    iso: istToUtcIso(2026, 4, 27, 19, 30),
  },
]

function isRcbQuery(input: string) {
  const lower = input.toLowerCase()

  return (
    lower.includes('next rcb match') ||
    lower.includes('when is next rcb match') ||
    lower.includes('when is the next rcb match') ||
    lower.includes('rcb next match') ||
    lower.includes('royal challengers next match')
  )
}

function getNextRcbMatch() {
  const now = new Date()

  return RCB_2026_MATCHES.find((match) => {
    return new Date(match.iso).getTime() > now.getTime()
  }) || null
}

function buildNoMatchReply() {
  return `🏏 *RCB match update*

I don’t see another upcoming RCB fixture in the saved schedule.

I can still check live cricket updates if you ask:
“latest RCB news” or “IPL points table”.`
}

function buildReply(match: Match) {
  return `🏏 *Next RCB match*

${match.label}
${match.dateText}
${match.timeText}
${match.venue}, ${match.city}

Reply “Yes” and I’ll remind you 1 hour before.`
}

export function buildSportsReply(input: string): string | null {
  if (!isRcbQuery(input)) return null

  const match = getNextRcbMatch()

  if (!match) return buildNoMatchReply()

  return buildReply(match)
}

export async function buildSportsReplyWithState(
  input: string,
  telegramId: number
): Promise<SportsReplyResult | null> {
  if (!isRcbQuery(input)) return null

  const match = getNextRcbMatch()

  if (!match) {
    return {
      reply: buildNoMatchReply(),
    }
  }

  await saveFollowupState(telegramId, 'sports_match', {
    team: 'RCB',
    opponent: match.opponent,
    match_label: match.label,
    match_time_iso: match.iso,
  })

  return {
    reply: buildReply(match),
  }
}
