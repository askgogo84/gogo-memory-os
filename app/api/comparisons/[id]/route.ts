import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentSession} from '@/lib/agent/session'
import {readPriceComparison} from '@/lib/commerce/price-comparison'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: {params: Promise<{id: string}>}) {
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  const {id} = await context.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({error: 'invalid_comparison'}, {status: 400})
  try {
    const task = await readPriceComparison(String(session.telegramId), id)
    if (!task) return NextResponse.json({error: 'not_found'}, {status: 404})
    return NextResponse.json({id: task.id, status: task.status, subject: task.metadata_json.subject,
      request: task.metadata_json.request, providers: task.metadata_json.providers, updatedAt: task.updated_at},
      {headers: {'Cache-Control': 'private, no-store'}})
  } catch { return NextResponse.json({error: 'read_failed'}, {status: 500}) }
}
