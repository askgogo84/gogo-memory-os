import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(req: NextRequest) {
  const { phone, action, text } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  if (action === 'add') {
    await supabase.from('todos').insert({ whatsapp_id: phone, text, done: false, created_at: new Date().toISOString() })
    return NextResponse.json({ ok: true, reply: 'Added: ' + text + '\n\nSay "tasks" to see all.' })
  }

  if (action === 'done') {
    await supabase.from('todos').update({ done: true, done_at: new Date().toISOString() }).eq('whatsapp_id', phone).ilike('text', '%' + text + '%').eq('done', false)
    return NextResponse.json({ ok: true, reply: 'Marked done: ' + text })
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
