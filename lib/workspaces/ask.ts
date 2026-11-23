import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireWorkspaceRole, WorkspaceError } from './access'
import { UUID_RE } from './rules'

export type WorkspaceAnswer = {
  answer: string
  source: { label: string; checkedAt: string; firstRecordAt: string | null; lastRecordAt: string | null }
}

const source = () => ({ label: 'Hospitality pilot records · external provider status unverified', checkedAt: new Date().toISOString(), firstRecordAt: null as string | null, lastRecordAt: null as string | null })

async function exactCount(query: any): Promise<number> {
  const { count, error } = await query
  if (error || !Number.isSafeInteger(count) || count < 0) throw new WorkspaceError('workspace_unavailable')
  return count
}

/** Read-only answers over the pilot's own tables. No personal context or executor is reachable. */
export async function askWorkspace(owner: string, workspaceId: string, question: string): Promise<WorkspaceAnswer> {
  // This bounded preview accepts only exact owners representable by the current session contract.
  if (!/^-?[1-9]\d*$/.test(owner) || !Number.isSafeInteger(Number(owner)) || String(Number(owner)) !== owner) throw new WorkspaceError('invalid_session')
  if (!UUID_RE.test(workspaceId)) throw new WorkspaceError('workspace_not_found')
  await requireWorkspaceRole(owner, workspaceId, 'view')
  const q = typeof question === 'string' ? question.trim() : ''
  if (!q || q.length > 300) throw new WorkspaceError('invalid_question')
  const evidence = source()
  const boundary = (answer: string) => ({ answer, source: evidence })
  if (/\b(refund|pay|transfer|charge|send|publish|accept|reject|delete|update|change|book)\b|\bturn\s+(?:off|on)\b/i.test(q)) {
    return boundary('This workspace view can analyse recorded orders and stock. It cannot change orders, issue refunds, send messages or move money. Nothing was changed.')
  }
  if (/\b(today|now|live|current|bank|fintech|balance|transaction|account)\b/i.test(q)) {
    return boundary('This is a read-only view of recorded hospitality pilot data, not a live POS or banking connection. Ask for a recorded-order summary, cancellation counts or stock status. No live provider was queried.')
  }
  if (!/\b(brief|summary|summari[sz]e|overview|orders?|cancellations?|cancelled|stock|inventory|breakfast|cut.?off)\b/i.test(q)) {
    return boundary('I can summarise recorded pilot orders, count cancellations and out-of-stock reasons, or report recorded stock availability. Other industry questions need their own connected, verified source.')
  }

  const { data: workspace, error: workspaceError } = await supabaseAdmin.from('workspaces')
    .select('id,pilot_read_only').eq('id', workspaceId).maybeSingle()
  if (workspaceError) throw new WorkspaceError('workspace_unavailable')
  if (!workspace || workspace.id !== workspaceId) throw new WorkspaceError('workspace_not_found')
  if (workspace.pilot_read_only !== true) return boundary('The read-only hospitality pilot is not enabled for this workspace. No business provider was queried.')

  const { data: outlets, error: outletError } = await supabaseAdmin.from('merchant_outlets')
    .select('id,workspace_id').eq('workspace_id', workspaceId).limit(201)
  if (outletError) throw new WorkspaceError('workspace_unavailable')
  if (!outlets?.length) return boundary('This workspace has no hospitality pilot records yet. No figures or live connection are being assumed.')
  if (outlets.length > 200 || outlets.some((o: any) => o.workspace_id !== workspaceId || typeof o.id !== 'string' || !o.id || o.id.length > 100)) throw new WorkspaceError('workspace_unavailable')
  const ids = [...new Set(outlets.map((o: any) => o.id))]
  const orderCount = () => supabaseAdmin.from('merchant_orders').select('id', { count: 'exact', head: true }).in('outlet_id', ids)
  const itemCount = () => supabaseAdmin.from('merchant_items').select('id', { count: 'exact', head: true }).in('outlet_id', ids)
  const [orders, cancelled, outOfStock, items, unavailable, first, last] = await Promise.all([
    exactCount(orderCount()), exactCount(orderCount().eq('state', 'cancelled')),
    exactCount(orderCount().eq('state', 'cancelled').eq('cancel_reason', 'out_of_stock')),
    exactCount(itemCount()), exactCount(itemCount().eq('available', false)),
    supabaseAdmin.from('merchant_orders').select('created_at').in('outlet_id', ids).order('created_at', { ascending: true }).limit(1).maybeSingle(),
    supabaseAdmin.from('merchant_orders').select('created_at').in('outlet_id', ids).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (first.error || last.error || cancelled > orders || outOfStock > cancelled || unavailable > items) throw new WorkspaceError('workspace_unavailable')
  if (orders && (!first.data?.created_at || !last.data?.created_at || !Number.isFinite(Date.parse(first.data.created_at)) || !Number.isFinite(Date.parse(last.data.created_at)))) throw new WorkspaceError('workspace_unavailable')
  evidence.firstRecordAt = first.data?.created_at || null
  evidence.lastRecordAt = last.data?.created_at || null
  const format = (n: number) => n.toLocaleString('en-IN')
  const rate = orders ? `${(cancelled / orders * 100).toFixed(1)}%` : 'not available (no recorded orders)'
  const lines = /\b(stock|inventory)\b/i.test(q) && !/\bcancellations?\b/i.test(q)
    ? [`${format(items)} recorded menu items across ${ids.length} pilot outlets.`, `${format(unavailable)} marked unavailable in these records.`, 'Suggested review: check outlet-level availability against the POS before changing any menu.']
    : [`${format(orders)} recorded orders across ${ids.length} pilot outlets.`, `${format(cancelled)} cancellations; recorded cancellation rate ${rate}.`, `${format(outOfStock)} cancellations marked out of stock.`, 'Suggested review: investigate out-of-stock items and cut-off rules against the source system. These counts alone do not establish a cause or a fix.']
  return { answer: [...lines, 'Pilot records only. No order, stock setting, refund or payment was changed.'].join('\n'), source: evidence }
}
