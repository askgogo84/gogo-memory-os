import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { GOGO_LESSONS } from '@/lib/dashboard/lessons'
import { LearnWithGogo } from '@/components/dashboard/learn-with-gogo'

export const dynamic = 'force-dynamic'

export default async function LearnPage() {
  const session = await getSession()
  const tg = parseInt(session?.telegramId || '', 10)
  let completedKeys: string[] = []

  if (Number.isFinite(tg)) {
    const { data } = await supabaseAdmin
      .from('learning_progress')
      .select('lesson_key')
      .eq('telegram_id', tg)
      .eq('completed', true)
    completedKeys = (data || []).map((r: any) => String(r.lesson_key))
  }

  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <div className="mb-6">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gogo-orange">Master Gogo</div>
        <h1 className="mt-2 font-serif text-[38px] font-semibold tracking-[-.7px] text-gogo-ink sm:text-[44px]">Learn what your second brain can do</h1>
        <p className="mt-2 max-w-3xl text-[13px] leading-6 text-gogo-ink-3">One useful behavior at a time. Watch Gogo explain it, try the skill yourself, then unlock the next lesson. The final video series will use the AskGogo character throughout.</p>
      </div>
      <LearnWithGogo lessons={GOGO_LESSONS} completedKeys={completedKeys} />
    </div>
  )
}