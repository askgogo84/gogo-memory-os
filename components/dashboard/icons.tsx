/** AskGogo dashboard icon set. All icons use currentColor. */
type IconProps = { className?: string }
const base = 'block h-6 w-6'

export function TodayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? base} aria-hidden="true">
      <path d="M12 3.2v4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".45" />
      <path d="M12 15.6v5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity=".45" />
      <circle cx="12" cy="11.6" r="3.1" fill="currentColor" />
      <circle cx="12" cy="11.6" r="5.6" stroke="currentColor" strokeWidth="1.5" opacity=".3" />
    </svg>
  )
}

export function MemoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? base} aria-hidden="true">
      <path d="M8.2 5.2A3.2 3.2 0 0 1 14 3.4a3.1 3.1 0 0 1 3.4 4.4A3.5 3.5 0 0 1 18 14a3.2 3.2 0 0 1-4.1 4.8A3.2 3.2 0 0 1 8 18.5a3.1 3.1 0 0 1-2.7-4.8A3.4 3.4 0 0 1 6 7.5a3.2 3.2 0 0 1 2.2-2.3Z" stroke="currentColor" strokeWidth="1.55" strokeLinejoin="round" />
      <path d="M9 8.2c1.8.3 2.8 1.3 3 3M15.2 9.5c-1.6.3-2.6 1.3-2.8 2.9M9.4 15c1.4-.2 2.3-.9 2.8-2.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" opacity=".7" />
    </svg>
  )
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? base} aria-hidden="true">
      <rect x="3.4" y="5.4" width="17.2" height="15.2" rx="4.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.2 2.9v3.6M15.8 2.9v3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="13.6" r="1.9" fill="currentColor" />
    </svg>
  )
}

export function ListsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? base} aria-hidden="true">
      <path d="M9.6 6.6h10.2M9.6 12h10.2M9.6 17.4h6.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3.2 6.5l1.5 1.5 2.4-2.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4.6" cy="12" r="1.5" fill="currentColor" />
      <circle cx="4.6" cy="17.4" r="1.5" fill="currentColor" opacity=".38" />
    </svg>
  )
}

export function UsageIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? base} aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.7" opacity=".28" />
      <path d="M12 3.6a8.4 8.4 0 0 1 7.1 12.9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </svg>
  )
}

export function YouIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className ?? base} aria-hidden="true">
      <circle cx="12" cy="6.1" r="2.9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.9 19.1c1.3-5.6 4.1-8.4 7.1-8.4s5.8 2.8 7.1 8.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.9 19.1c2.1 1.1 12.1 1.1 14.2 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function WhatsAppIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? 'block h-3.5 w-3.5'} aria-hidden="true">
      <path d="M12 2a10 10 0 00-8.6 15l-1.3 4.7 4.8-1.3A10 10 0 1012 2z" fill="currentColor" />
    </svg>
  )
}

export const TAB_ICONS = {
  today: TodayIcon,
  memory: MemoryIcon,
  calendar: CalendarIcon,
  lists: ListsIcon,
  usage: UsageIcon,
  you: YouIcon,
} as const
