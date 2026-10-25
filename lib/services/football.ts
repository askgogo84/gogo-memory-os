const BASE = 'https://api.football-data.org/v4'
const COMPETITION = 'WC'

function headers() {
  const key = process.env.FOOTBALL_DATA_API_KEY
  return key ? { 'X-Auth-Token': key } : {}
}

export interface FootballMatch {
  id: number
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string
  utcDate: string
  minute?: number
  group?: string
}

function mapMatch(m: any): FootballMatch {
  return {
    id: m.id,
    homeTeam: m.homeTeam?.shortName || m.homeTeam?.name || 'TBD',
    awayTeam: m.awayTeam?.shortName || m.awayTeam?.name || 'TBD',
    homeScore: m.score?.fullTime?.home ?? m.score?.currentPeriod?.home ?? null,
    awayScore: m.score?.fullTime?.away ?? m.score?.currentPeriod?.away ?? null,
    status: m.status,
    utcDate: m.utcDate,
    minute: m.minute || null,
    group: m.group || null,
  }
}

export async function getTodayMatches(): Promise<FootballMatch[]> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const res = await fetch(`${BASE}/competitions/${COMPETITION}/matches?dateFrom=${today}&dateTo=${today}`, { headers: headers() as any })
    if (!res.ok) return []
    const data = await res.json()
    return (data.matches || []).map(mapMatch)
  } catch { return [] }
}

export async function getLiveMatches(): Promise<FootballMatch[]> {
  try {
    const res = await fetch(`${BASE}/competitions/${COMPETITION}/matches?status=LIVE`, { headers: headers() as any, cache: 'no-store' })
    if (!res.ok) return []
    const data = await res.json()
    return (data.matches || []).map(mapMatch)
  } catch { return [] }
}

export async function getUpcomingMatches(days = 3): Promise<FootballMatch[]> {
  try {
    const from = new Date().toISOString().slice(0, 10)
    const to = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    const res = await fetch(`${BASE}/competitions/${COMPETITION}/matches?dateFrom=${from}&dateTo=${to}&status=SCHEDULED`, { headers: headers() as any })
    if (!res.ok) return []
    const data = await res.json()
    return (data.matches || []).map(mapMatch)
  } catch { return [] }
}

export async function getTeamMatches(teamName: string): Promise<FootballMatch[]> {
  const all = await getUpcomingMatches(30)
  const norm = teamName.toLowerCase()
  return all.filter(m => m.homeTeam.toLowerCase().includes(norm) || m.awayTeam.toLowerCase().includes(norm))
}

export async function getStandings(): Promise<any[]> {
  try {
    const res = await fetch(`${BASE}/competitions/${COMPETITION}/standings`, { headers: headers() as any })
    if (!res.ok) return []
    const data = await res.json()
    const entries: any[] = []
    for (const group of data.standings || []) {
      for (const row of group.table || []) {
        entries.push({ position: row.position, team: row.team?.shortName || row.team?.name, played: row.playedGames, won: row.won, drawn: row.draw, lost: row.lost, points: row.points, group: group.group || 'GROUP' })
      }
    }
    return entries
  } catch { return [] }
}

export function formatMatch(m: FootballMatch, tz = 'Asia/Kolkata'): string {
  const kickoff = new Date(m.utcDate).toLocaleString('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  if (m.status === 'FINISHED') return `${m.homeTeam} ${m.homeScore} - ${m.awayScore} ${m.awayTeam} (FT)`
  if (m.status === 'IN_PLAY' || m.status === 'LIVE') return `LIVE ${m.homeTeam} ${m.homeScore ?? 0} - ${m.awayScore ?? 0} ${m.awayTeam} ${m.minute ? `(${m.minute}')` : ''}`
  return `${m.homeTeam} vs ${m.awayTeam} | ${kickoff} IST`
}

export function isStartingSoon(match: FootballMatch, withinMinutes = 30): boolean {
  const diff = new Date(match.utcDate).getTime() - Date.now()
  return diff > 0 && diff <= withinMinutes * 60 * 1000
}

export function normalizeTeamName(input: string): string {
  const map: Record<string, string> = { brazil: 'Brazil', argentina: 'Argentina', france: 'France', england: 'England', germany: 'Germany', spain: 'Spain', portugal: 'Portugal', india: 'India', usa: 'USA', mexico: 'Mexico', japan: 'Japan', australia: 'Australia', morocco: 'Morocco', colombia: 'Colombia', uruguay: 'Uruguay', croatia: 'Croatia', canada: 'Canada' }
  return map[input.toLowerCase().trim()] || input
}
