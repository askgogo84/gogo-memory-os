import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentSession} from '@/lib/agent/session'
import {readCommerceTask, commerceTaskView} from '@/lib/commerce/task'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: {params: Promise<{runId: string}>}) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  try {
    const task = await readCommerceTask(session.telegramId, (await context.params).runId)
    return NextResponse.json(task ? commerceTaskView(task) : {error: 'task_unavailable'}, {status: task ? 200 : 404, headers: {'Cache-Control': 'no-store'}})
  } catch {
    return NextResponse.json({error: 'task_read_failed'}, {status: 503, headers: {'Cache-Control': 'no-store'}})
  }
}
