import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isInternalServiceAuthorized } from '@/lib/security/cron-auth'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(req: NextRequest) {
  // Internal service call only (bot pipeline). The `phone` in the body is the
  // target owner supplied by the trusted caller, never the authorization itself.
  if (!isInternalServiceAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { phone, action, text } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  if (action === 'add') {
    await supabase.from('todos').insert({ whatsapp_id: phone, text, done: false, created_at: new Date().toISOString() })
    return NextResponse.json({ ok: true, reply: 'Added: ' + text + '\n\nSay "tasks" to see all.' })
  }

  if (action === 'done') {
    // A partial name is a hint, NOT permission to finish every task containing it.
    // SQL ILIKE also treats "%" and "_" as wildcards. Select exactly one owned
    // pending task in memory, then bind the write to that task ID + owner.
    const term = typeof text === 'string' ? text.replace(/\\s+/g, ' ').trim().toLowerCase() : ''
    if (!term || term.length > 160) return NextResponse.json({ ok: false, reply: null })

    const { data: pending, error: readError } = await supabase.from('todos')
      .select('id, text').eq('whatsapp_id', phone).eq('done', false).limit(101)
    // We cannot prove a unique match from a truncated list or a failed read.
    if (readError || !Array.isArray(pending)) {
      return NextResponse.json({ ok: false, reply: "I couldn't verify your tasks, so nothing was marked done." })
    }
    if (pending.length > 100) {
      return NextResponse.json({ ok: false, reply: 'Please use the exact task name. I could not safely identify one task.' })
    }
    const norm = (v: unknown) => String(v || '').replace(/\\s+/g, ' ').trim().toLowerCase()
    const exact = pending.filter((r: any) => norm(r.text) === term)
    const matches = exact.length ? exact : pending.filter((r: any) => norm(r.text).includes(term))
    if (matches.length !== 1) {
      return NextResponse.json({
        ok: false,
        reply: matches.length > 1 ? 'More than one task matches. Please use the full task name.' : null,
      })
    }
    const target = matches[0] as any
    // Fail closed on an imprecise BIGINT ID; never alias another task by Number rounding.
    const key = target.id
    if ((typeof key === 'number' && !Number.isSafeInteger(key)) ||
        (typeof key !== 'number' && (typeof key !== 'string' || !key.trim()))) {
      return NextResponse.json({ ok: false, reply: null })
    }

    const { data: updated, error: updateError } = await supabase.from('todos')
      .update({ done: true, done_at: new Date().toISOString() })
      .eq('id', key).eq('whatsapp_id', phone).eq('done', false)
      .select('id, text')
    // Never claim a successful action without a single matching mutation receipt.
    if (updateError || !Array.isArray(updated) || updated.length !== 1 ||
        String(updated[0].id) !== String(key)) {
      return NextResponse.json({ ok: false, reply: "I couldn't verify that task was completed, so I won't mark it done here." })
    }
    return NextResponse.json({ ok: true, reply: 'Marked done: ' + String(updated[0].text || target.text) })
  }

  if (action === 'list') {
    const { data: todos } = await supabase.from('todos').select('id, text, done').eq('whatsapp_id', phone).order('created_at', { ascending: true })
    if (!todos?.length) return NextResponse.json({ reply: 'No tasks yet! Say "add task: buy groceries" to start.' })
    const pending = todos.filter(t => !t.done).map((t, i) => (i + 1) + '. ' + t.text).join('\n')
    const done = todos.filter(t => t.done).slice(0, 2).map(t => '- ' + t.text + ' (done)').join('\n')
    return NextResponse.json({ reply: 'Your Tasks\n\n' + (pending || 'All done!') + (done ? '\n\nRecently done:\n' + done : '') })
  }

  if (action === 'clear') {
    await supabase.from('todos').delete().eq('whatsapp_id', phone).eq('done', true)
    return NextResponse.json({ ok: true, reply: 'Cleared completed tasks.' })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
