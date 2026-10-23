'use client'

// Draws the person's companion character in an action state. Today every choice resolves to Gogo; a new character
// is added by registering it in lib/gogo/characters.ts and adding its drawing here — callers never change.
// With no theme given it follows the dashboard's light/dark choice, so the props around Gogo (cards, laptop) match.
import { useEffect, useState } from 'react'
import { GogoAgent } from './gogo-agent'
import { companionFor } from '@/lib/gogo/characters'
import type { GogoAgentState } from '@/lib/gogo/agent-states'

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
  const who = companionFor(character)
  switch (who.id) {
    case 'gogo':
    default:
      return <GogoAgent state={state} size={size} theme={theme || current} label={label} className={className} animate={animate}/>
  }
}
