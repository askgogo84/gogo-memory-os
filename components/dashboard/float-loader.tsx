import { GogoCharacter } from '@/components/gogo/gogo-character'

type FloatLoaderProps = {
  label?: string
}

export function FloatLoader({ label }: FloatLoaderProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <GogoCharacter state="thinking" size={112} showStatus />
      {label && <p className="text-[13px] text-gogo-ink/60">{label}</p>}
    </div>
  )
}
