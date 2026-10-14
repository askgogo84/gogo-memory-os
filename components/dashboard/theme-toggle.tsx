'use client'

import { useEffect, useState } from 'react'
import { parseTheme, THEME_STORAGE_KEY, type DashboardTheme } from '@/lib/dashboard/theme'

function applyTheme(theme: DashboardTheme) {
  const root = document.querySelector('.dashboard-root')
  if (!root) return
  root.classList.toggle('theme-dark', theme === 'dark')
  root.classList.toggle('theme-light', theme === 'light')
  root.setAttribute('data-theme', theme)
}

/** Dark / Light switch. Dark is the default; the choice stays in this browser. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<DashboardTheme>('dark')

  useEffect(() => {
    let stored: string | null = null
    try { stored = window.localStorage.getItem(THEME_STORAGE_KEY) } catch {}
    setTheme(parseTheme(stored))
  }, [])

  function choose(next: DashboardTheme) {
    setTheme(next)
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next) } catch {}
    applyTheme(next)
  }

  const option = (value: DashboardTheme, label: string) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={theme === value}
      onClick={() => choose(value)}
      className={`min-h-10 flex-1 rounded-full px-4 text-[15px] font-semibold transition ${theme === value ? 'bg-[#2fb8a6] text-[#0b0b0b]' : 'text-[#c9c9c4] hover:text-[#f2efea]'}`}
    >{label}</button>
  )

  return (
    <div role="radiogroup" aria-label="Colour theme" className={`flex gap-1 rounded-full border border-[#2a2a2a] bg-[#111111] p-1 ${compact ? 'w-full' : 'w-[220px]'}`}>
      {option('dark', 'Dark')}
      {option('light', 'Light')}
    </div>
  )
}
