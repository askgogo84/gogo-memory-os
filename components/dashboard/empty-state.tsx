import type { ReactNode } from 'react'
import { GogoCharacter } from '@/components/gogo/gogo-character'

type EmptyStateProps = {
  /** One calm line. Empty states get a message, never a blank surface. */
  message: string
  /** Optional secondary line (meta weight). */
  detail?: string
  /** Usually a single primary action. */
  action?: ReactNode
}

export function EmptyState({ message, detail, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
      <GogoCharacter state="calm" size={112} showStatus={false} />
      <p className="text-base text-gogo-ink">{message}</p>
      {detail && <p className="-mt-2 text-[13px] text-gogo-ink/60">{detail}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
