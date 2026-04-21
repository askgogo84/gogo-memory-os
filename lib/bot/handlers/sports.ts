const IPL_2026_RCB_SCHEDULE = [
  { date: '2026-03-28', opponent: 'SRH', venueType: 'vs', label: 'RCB vs SRH' },
  { date: '2026-04-05', opponent: 'CSK', venueType: 'vs', label: 'RCB vs CSK' },
  { date: '2026-04-10', opponent: 'RR', venueType: 'at', label: 'RR vs RCB' },
  { date: '2026-04-12', opponent: 'MI', venueType: 'at', label: 'MI vs RCB' },
  { date: '2026-04-15', opponent: 'LSG', venueType: 'vs', label: 'RCB vs LSG' },
  { date: '2026-04-18', opponent: 'DC', venueType: 'vs', label: 'RCB vs DC' },
  { date: '2026-04-24', opponent: 'GT', venueType: 'vs', label: 'RCB vs GT' },
  { date: '2026-04-27', opponent: 'DC', venueType: 'at', label: 'DC vs RCB' },
  { date: '2026-04-30', opponent: 'GT', venueType: 'at', label: 'GT vs RCB' },
  { date: '2026-05-07', opponent: 'LSG', venueType: 'at', label: 'LSG vs RCB' },
  { date: '2026-05-10', opponent: 'MI', venueType: 'vs', label: 'RCB vs MI' },
  { date: '2026-05-13', opponent: 'KKR', venueType: 'vs', label: 'RCB vs KKR' },
  { date: '2026-05-17', opponent: 'PBKS', venueType: 'at', label: 'PBKS vs RCB' },
  { date: '2026-05-22', opponent: 'SRH', venueType: 'at', label: 'SRH vs RCB' },
]

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00+05:30').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}

export function isSportsScheduleQuery(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    (lower.includes('rcb') && lower.includes('match')) ||
    (lower.includes('ipl') && lower.includes('match')) ||
    lower.includes('next rcb match') ||
    lower.includes('when is the next rcb match')
  )
}

export function getNextRCBMatch(now = new Date()) {
  const today = new Date(
    now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  )
  const todayKey = today.toISOString().slice(0, 10)

  return IPL_2026_RCB_SCHEDULE.find((m) => m.date >= todayKey) || null
}

export function buildSportsReply(text: string): string | null {
  if (!isSportsScheduleQuery(text)) return null

  const nextMatch = getNextRCBMatch()
  if (!nextMatch) {
    return `I could not find a next RCB match in the current IPL 2026 schedule.`
  }

  return `RCB's next match is *${nextMatch.label}* on *${formatDate(nextMatch.date)}*.\n\nWant me to set a reminder for it?`
}
