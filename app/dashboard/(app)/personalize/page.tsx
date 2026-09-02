import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { PersonalizeGogo } from '@/components/dashboard/personalize-gogo'

export const dynamic = 'force-dynamic'

export default async function PersonalizePage() {
  const session = await getSession()
  const tg = parseInt(session?.telegramId || '', 10)
  let initialPersonality = 'calm_companion'
  let initialDrink = 'coffee'

  if (Number.isFinite(tg)) {
    const { data } = await supabaseAdmin
      .from('user_experience_preferences')
      .select('personality, comfort_drink')
      .eq('telegram_id', tg)
      .maybeSingle()
    initialPersonality = data?.personality || initialPersonality
    initialDrink = data?.comfort_drink || initialDrink
  }

  return (
    <div className="mx-auto w-full max-w-[1320px]">
      <div className="mb-6 flex items-end justify-between gap-5">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gogo-orange">Make it yours</div>
          <h1 className="mt-2 font-serif text-[38px] font-semibold tracking-[-.7px] text-gogo-ink sm:text-[44px]">Personalize Gogo</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-gogo-ink-3">Choose how Gogo sounds and what your calm room feels like. Your underlying memory and actions stay unchanged.</p>
        </div>
      </div>
      <PersonalizeGogo initialPersonality={initialPersonality} initialDrink={initialDrink} />
    </div>
  )
}
