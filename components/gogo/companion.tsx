'use client'

// Draws the person's companion character in an action state. Today every choice resolves to Gogo; a new character
// is added by registering it in lib/gogo/characters.ts and adding its drawing here — callers never change.
// With no theme given it follows the dashboard's light/dark choice, so the props around Gogo (cards, laptop) match.
import { createContext, useContext, useEffect, useState } from 'react'
import { GogoAgent } from './gogo-agent'
import { companionFor } from '@/lib/gogo/characters'
import type { GogoAgentState } from '@/lib/gogo/agent-states'
import { Crewmate } from './crewmate'
import { isCrewId, moodForPose, moodForState } from '@/lib/gogo/crew'
import { GogoCharacter, type GogoState } from './gogo-character'

// The person's choice for the whole dashboard (set once in the shell). `crew` false keeps the original Gogo drawing.
const CompanionChoice = createContext<{ choice: string | null; crew: boolean }>({ choice: null, crew: false })
export function CompanionProvider({ choice, crew, children }: { choice: string | null; crew: boolean; children: React.ReactNode }) {
  return <CompanionChoice.Provider value={{ choice, crew }}>{children}</CompanionChoice.Provider>
}

function useDashboardTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.querySelector('.dashboard-root')
    if (!root) return
    const read = () => setTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
    read()
    if (typeof MutationObserver !== 'function') return
    const obs = new MutationObserver(read)
    obs.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

export function Companion({ character, state = 'idle', size = 120, theme, label, className, animate }: {
  character?: string | null; state?: GogoAgentState; size?: number; theme?: 'light' | 'dark'; label?: string; className?: string; animate?: boolean
}) {
  const current = useDashboardTheme()
  const ctx = useContext(CompanionChoice)
  const who = companionFor(character ?? ctx.choice)
  // The crew (with eyes that follow the pointer) is shown only where it is switched on for this person.
  if (ctx.crew && isCrewId(who.id)) return <Crewmate kind={who.id} mood={moodForState(state)} size={size} label={label === '' ? '' : label ?? who.name} className={className}/>
  return <GogoAgent state={state} size={size} theme={theme || current} label={label} className={className} animate={animate}/>
}

/** For places that draw the older GogoCharacter poses: the person's crewmate when the crew is on, else unchanged. */
export function PoseCompanion({ state = 'calm', size = 72, showStatus, hands, className }: { state?: GogoState; size?: number; showStatus?: boolean; hands?: boolean; className?: string }) {
  const ctx = useContext(CompanionChoice)
  const who = companionFor(ctx.choice)
  if (ctx.crew && isCrewId(who.id)) return <Crewmate kind={who.id} mood={moodForPose(state)} size={size} label="" className={className}/>
  return <GogoCharacter state={state} size={size} showStatus={showStatus} hands={hands} className={className}/>
}
