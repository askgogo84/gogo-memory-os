// The Gogo crew: Gogo and five friends built on Gogo's body (approved mock "Gogo Crew Dashboard", 12 Nov 2026).
// Pure data, no React. Colours are the mock's; a character only differs in hair, colour and glow.
import type { GogoAgentState } from './agent-states'

export const CREW_IDS = ['gogo', 'mishti', 'chai', 'tara', 'bolt', 'momo'] as const
export type CrewId = (typeof CREW_IDS)[number]
export type CrewMood = 'idle' | 'thinking' | 'done' | 'needs' | 'sleep'
export type CrewLook = { name: string; line: string; b1: string; b2: string; b3: string; core1: string; core: string; h1: string; h2: string; hair: 'curls' | 'bun' | 'beanie' | 'puffs' | 'tuft' | 'ears'; dot: string; wash: string }

export const CREW_LOOKS: Record<CrewId, CrewLook> = {
  gogo:   { name: 'Gogo',   line: 'The original. Calm, warm, gets things done.',       b1: '#FFFBF3', b2: '#F3E7D3', b3: '#E4D3B9', core1: '#FFB06A', core: '#EF7A27', h1: '#4A2E20', h2: '#2C1A13', hair: 'curls',  dot: '#D67528', wash: '#FDF0E2' },
  mishti: { name: 'Mishti', line: 'Gentle and thoughtful. Great with plans and people.', b1: '#FFF9FB', b2: '#F3E3EC', b3: '#DEC5D3', core1: '#E39AD0', core: '#A9478E', h1: '#4A2A45', h2: '#24121F', hair: 'bun',    dot: '#A9478E', wash: '#F6EAF2' },
  chai:   { name: 'Chai',   line: 'Cosy and steady. Never misses a reminder.',         b1: '#FBFFF8', b2: '#E5EFDD', b3: '#CCDBC0', core1: '#9BD7A9', core: '#3F8E5C', h1: '#3E6B57', h2: '#22402F', hair: 'beanie', dot: '#3F8E5C', wash: '#EAF3E6' },
  tara:   { name: 'Tara',   line: 'Curious explorer. Loves trips and finding deals.',  b1: '#F8FBFF', b2: '#E1EBF6', b3: '#C6D5E7', core1: '#9CC3F2', core: '#2F6FC4', h1: '#3A3F5C', h2: '#1C1F33', hair: 'puffs',  dot: '#2F6FC4', wash: '#E8F0FA' },
  bolt:   { name: 'Bolt',   line: 'Quick and direct. Short replies, fast answers.',    b1: '#FFFEF3', b2: '#F5EDC6', b3: '#E3D59E', core1: '#FFD36B', core: '#D4920F', h1: '#7A4E1C', h2: '#46290C', hair: 'tuft',   dot: '#A8730B', wash: '#FBF3DA' },
  momo:   { name: 'Momo',   line: 'Playful and sweet. Keeps the day light.',           b1: '#FFF8F4', b2: '#F6E2D8', b3: '#E5C6B5', core1: '#F7A3B4', core: '#D84F6C', h1: '#5A3326', h2: '#2E1911', hair: 'ears',   dot: '#C23F5C', wash: '#FBEAEE' },
}

/** Pure. The crew's five moods cover all fifteen action states; the live line (words) still says which one it is. */
export function moodForState(state: GogoAgentState): CrewMood {
  switch (state) {
    case 'idle': return 'idle'
    case 'done': return 'done'
    case 'approval': case 'otp': case 'blocked': return 'needs'
    case 'watcher': return 'sleep'
    default: return 'thinking' // thinking, searching, browsing, comparing, flight, train, grocery, booking, failed ("trying another way", never red)
  }
}

export function isCrewId(v: unknown): v is CrewId { return typeof v === 'string' && (CREW_IDS as readonly string[]).includes(v) }

type Env = Record<string, string | undefined>
/** Off unless GOGO_CREW is "on" or lists the owner's telegram id (exact string). */
export function crewEnabledFor(owner: string, env: Env = process.env): boolean {
  const v = String(env.GOGO_CREW || '').trim(), id = String(owner || '').trim()
  return v === 'on' || (Boolean(id) && v.split(',').map(s => s.trim()).includes(id))
}

/** Pure. The older GogoCharacter poses (chat avatar, empty states) mapped to crew moods. */
export function moodForPose(pose: string): CrewMood {
  switch (pose) {
    case 'thinking': case 'remembering': case 'acting': return 'thinking'
    case 'watching': case 'breathing': case 'sleeping': return 'sleep'
    case 'found': case 'done': return 'done'
    case 'approval': case 'secure': return 'needs'
    default: return 'idle' // calm, listening
  }
}
