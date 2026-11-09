import { LearnWithGogo } from '@/components/dashboard/learn-with-gogo'
import { GOGO_LESSONS } from '@/lib/dashboard/lessons'
import { getSession } from '@/lib/dashboard/session'
import { exactSessionOwnerId } from '@/lib/dashboard/owner-identity'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export default async function LearnPage() {
  const session = await getSession()
  const completedKeys: string[] = []

  if (session) {
    const tg = exactSessionOwnerId(session.telegramId)
    if (tg) {
      const { data } = await supabaseAdmin
        .from('learning_progress')
        .select('lesson_key')
        .eq('telegram_id', tg)
        .eq('completed', true)
      for (const row of data || []) completedKeys.push(String(row.lesson_key))
    }
  }

  return (
    <div className="w-full max-w-none px-0">
      <LearnWithGogo lessons={GOGO_LESSONS} completedKeys={completedKeys} />
    </div>
  )
}
