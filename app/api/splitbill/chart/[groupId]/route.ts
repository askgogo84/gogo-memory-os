import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

function clean(value: any, fallback = '-') {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim()
  return output || fallback
}

function esc(value: any) {
  return clean(value, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(value: number) {
  const rounded = Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
  return `₹${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)}`
}

function short(value: any, max = 34) {
  const output = clean(value, '')
  return output.length > max ? `${output.slice(0, max - 3).trim()}...` : output
}

async function loadGroup(groupId: string) {
  const { data: group } = await supabaseAdmin
    .from('split_groups')
    .select('id,name,currency,owner_phone,created_at')
    .eq('id', groupId)
    .maybeSingle()
  return group
}

async function loadStats(groupId: string) {
  const { data: expenses } = await supabaseAdmin
    .from('split_expenses')
    .select('id,total_amount,description,paid_by,category,created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })

  const { data: shares } = await supabaseAdmin
    .from('split_expense_shares')
    .select('member_name,owed_amount')
    .eq('group_id', groupId)

  const { data: settlements } = await supabaseAdmin
    .from('split_settlements')
    .select('from_member,to_member,amount')
    .eq('group_id', groupId)

  const balances: Record<string, number> = {}
  const categories: Record<string, number> = {}

  const add = (name: string, amount: number) => {
    balances[name] = Math.round(((balances[name] || 0) + amount) * 100) / 100
  }

  for (const expense of expenses || []) {
    add(expense.paid_by, Number(expense.total_amount))
    categories[expense.category || 'general'] = (categories[expense.category || 'general'] || 0) + Number(expense.total_amount)
  }

  for (const share of shares || []) add(share.member_name, -Number(share.owed_amount))

  for (const settlement of settlements || []) {
    add(settlement.from_member, Number(settlement.amount))
    add(settlement.to_member, -Number(settlement.amount))
  }

  const total = (expenses || []).reduce((sum, expense) => sum + Number(expense.total_amount || 0), 0)
  return { expenses: expenses || [], balances, categories, total }
}

function bar(label: string, value: number, max: number, x: number, y: number, color: string) {
  const width = max > 0 ? Math.max(8, Math.round((value / max) * 340)) : 8
  return `<text x="${x}" y="${y}" class="small" fill="#ead9b9">${esc(short(label, 16))}</text>
<rect x="${x + 130}" y="${y - 16}" width="340" height="18" rx="9" fill="#2c2d29"/>
<rect x="${x + 130}" y="${y - 16}" width="${width}" height="18" rx="9" fill="${color}"/>
<text x="${x + 490}" y="${y}" class="small" fill="#c9b88f">${esc(money(value))}</text>`
}

function buildSvg(group: any, stats: any) {
  const expenses = stats.expenses || []
  const categories = Object.entries(stats.categories || {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5) as [string, number][]
  const balances = Object.entries(stats.balances || {}).sort((a: any, b: any) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6) as [string, number][]
  const maxCategory = Math.max(...categories.map(([, value]) => Number(value)), 1)
  const maxBalance = Math.max(...balances.map(([, value]) => Math.abs(Number(value))), 1)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs>
<style>
.title{font:800 48px Arial,sans-serif;letter-spacing:2px}.sub{font:700 17px Arial,sans-serif;letter-spacing:4px}.h{font:900 24px Arial,sans-serif}.big{font:900 42px Arial,sans-serif}.small{font:700 18px Arial,sans-serif}.tiny{font:700 14px Arial,sans-serif}
</style>
</defs>
<rect width="1080" height="1350" fill="#071d18"/>
<circle cx="930" cy="120" r="280" fill="#0f8f67" opacity="0.16"/>
<circle cx="90" cy="1260" r="330" fill="#d7b86d" opacity="0.09"/>
<text x="70" y="88" class="title" fill="#e8d6b7">ASKGOGO SPLIT</text>
<text x="73" y="124" class="sub" fill="#b9a982">EXPENSE SUMMARY CARD</text>
<text x="1010" y="88" text-anchor="end" class="small" fill="#e8d6b7">${esc(new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</text>

<rect x="60" y="165" width="960" height="180" rx="34" fill="#f2e3c4"/>
<text x="100" y="225" class="h" fill="#173a31">${esc(group.name)}</text>
<text x="100" y="292" class="big" fill="#173a31">${esc(money(stats.total || 0))}</text>
<text x="100" y="322" class="tiny" fill="#43665c">Total group spend</text>
<text x="500" y="292" class="big" fill="#173a31">${expenses.length}</text>
<text x="500" y="322" class="tiny" fill="#43665c">Expenses recorded</text>
<text x="780" y="292" class="big" fill="#173a31">${balances.length}</text>
<text x="780" y="322" class="tiny" fill="#43665c">Members tracked</text>

<rect x="60" y="385" width="960" height="330" rx="34" fill="#111210" stroke="#2f312d"/>
<text x="100" y="440" class="h" fill="#c59a60">CATEGORY BREAKDOWN</text>
${categories.length ? categories.map(([label, value], i) => bar(label, Number(value), maxCategory, 100, 500 + i * 42, ['#2e8f75','#c2994b','#6485b2','#c36d67','#8b73c7'][i] || '#c2994b')).join('') : `<text x="100" y="520" class="small" fill="#ead9b9">No expenses yet</text>`}

<rect x="60" y="755" width="960" height="330" rx="34" fill="#111210" stroke="#2f312d"/>
<text x="100" y="810" class="h" fill="#c59a60">WHO OWES / GETS</text>
${balances.length ? balances.map(([name, value], i) => bar(`${name} ${Number(value) >= 0 ? 'gets' : 'owes'}`, Math.abs(Number(value)), maxBalance, 100, 870 + i * 38, Number(value) >= 0 ? '#2e8f75' : '#c36d67')).join('') : `<text x="100" y="890" class="small" fill="#ead9b9">All settled</text>`}

<rect x="60" y="1125" width="960" height="150" rx="34" fill="#f2e3c4"/>
<text x="100" y="1175" class="h" fill="#173a31">RECENT EXPENSES</text>
${expenses.slice(0, 3).map((expense: any, i: number) => `<text x="100" y="1215" class="small" fill="#173a31" transform="translate(0 ${i * 30})">${esc(short(expense.description, 34))} • ${esc(money(Number(expense.total_amount)))} • paid by ${esc(short(expense.paid_by, 14))}</text>`).join('')}
<text x="100" y="1320" class="tiny" fill="#b9a982">Generated by AskGogo on WhatsApp</text>
</svg>`
}

export async function GET(_req: NextRequest, context: { params: Promise<{ groupId: string }> }) {
  try {
    const { groupId } = await context.params
    const group = await loadGroup(groupId)
    if (!group) return new NextResponse('Split group not found', { status: 404 })
    const stats = await loadStats(groupId)
    return new NextResponse(buildSvg(group, stats), {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (error: any) {
    console.error('[split-chart] failed:', error?.message || error)
    return new NextResponse('Split chart failed', { status: 500 })
  }
}
