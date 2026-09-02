import { Suspense } from 'react'
import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GogoChat } from '@/components/dashboard/gogo-chat'

export const dynamic = 'force-dynamic'

export default async function ChatPage() {
  const session = await getSession()
  const tg = parseInt(session?.telegramId || '', 10)
  let comfortDrink = 'coffee'
  if (Number.isFinite(tg)) {
    const { data } = await supabaseAdmin
      .from('user_experience_preferences')
      .select('comfort_drink')
      .eq('telegram_id', tg)
      .maybeSingle()
    comfortDrink = data?.comfort_drink || 'coffee'
  }

  return (
    <Suspense fallback={<div className="p-8 text-sm text-gogo-ink-3">Opening Gogo’s room…</div>}>
      <GogoChat initialDrink={comfortDrink} />
    </Suspense>
  )
}
