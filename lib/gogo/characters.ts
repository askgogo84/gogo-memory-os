// Companion characters. Gogo is the first; more characters come later, and people will be able to build their own.
// The contract every character keeps: it draws ALL of the action states in agent-states.ts (idle, thinking,
// searching … failed), at any size, in light and dark, so a task card or Home never has to know which character
// the person picked. Status words (the live line) stay the same whatever the character looks like.
import { GOGO_AGENT_STATES, type GogoAgentState } from './agent-states'

export type CompanionId = 'gogo'
export type CompanionInfo = {
  id: CompanionId
  name: string
  /** States this character draws. Must be every state; checked by scripts/verify-home-v2.mts. */
  states: readonly GogoAgentState[]
}

export const COMPANIONS: Record<CompanionId, CompanionInfo> = {
  gogo: { id: 'gogo', name: 'Gogo', states: GOGO_AGENT_STATES },
}

export const DEFAULT_COMPANION: CompanionId = 'gogo'

/** The character to draw for a stored choice. An unknown or retired id falls back to Gogo, never to nothing. */
export function companionFor(choice?: string | null): CompanionInfo {
  const id = String(choice || '').trim().toLowerCase()
  return (COMPANIONS as Record<string, CompanionInfo>)[id] || COMPANIONS[DEFAULT_COMPANION]
}
