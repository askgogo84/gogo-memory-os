export const color = {
  orange: '#F26B1D',
  blue: '#5B8DD6',
  mint: '#3DB283',
  ink: '#1B1815',
  ink2: '#5F5A54',
  ink3: '#9A948C',
  surface: '#F7F4F0',
  hairline: '#ECE8E3',
  rowLine: '#F1EDE8',
  paper: '#FFFFFF',
}

export const dark = {
  ink: '#F5F1EC',
  ink2: '#B8B2AA',
  ink3: '#8A847C',
  surface: '#221F1B',
  hairline: '#2E2A26',
  rowLine: '#2A2723',
  paper: '#151311',
}

export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 28, 8: 48 } as const
export const radius = { icon: 10, field: 14, card: 18, sheet: 24, pill: 999 } as const

export const statusColor = {
  working: color.orange,
  watching: color.blue,
  needsYou: color.orange,
  done: color.mint,
  reminder: color.ink3,
} as const

// The Claude redesign is light-first. Keep the app light by default even when
// the Android system is dark; an explicit app appearance preference can switch
// this later without making the phone's global theme silently change AskGogo.
export function useTheme() {
  return { ...color, isDark: false }
}
