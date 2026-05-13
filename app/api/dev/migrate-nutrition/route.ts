import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: Record<string, string> = {}

  // Test if tables exist already
  const { error: checkLogs } = await supabaseAdmin.from('nutrition_logs').select('id').limit(1)
  const { error: checkGoals } = await supabaseAdmin.from('nutrition_goals').select('id').limit(1)

  if (!checkLogs) { results['nutrition_logs'] = 'already exists'; }
  if (!checkGoals) { results['nutrition_goals'] = 'already exists'; }

  if (checkLogs?.code === '42P01') {
    // Create via insert then immediately structure it using Supabase's REST
    // Since we can't run raw DDL via JS client, insert a dummy row to trigger schema cache
    // Instead: use the Supabase management API
    const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)\./)?.[1]
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (projectRef && serviceKey) {
      const ddl1 = `create table if not exists nutrition_logs (id uuid default gen_random_uuid() primary key, telegram_id bigint not null, logged_at timestamptz default now(), meal_type text, description text not null, food_items jsonb, total_calories numeric default 0, total_protein numeric default 0, total_carbs numeric default 0, total_fat numeric default 0, total_fiber numeric default 0, image_url text, source text default 'text', raw_ai_response text, created_at timestamptz default now())`

      const r1 = await fetch(`https://${projectRef}.supabase.co/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ sql: ddl1 })
      })
      results['nutrition_logs'] = r1.ok ? 'created' : `error ${r1.status}: ${await r1.text()}`

      const ddl2 = `create table if not exists nutrition_goals (id uuid default gen_random_uuid() primary key, telegram_id bigint not null unique, goal_type text default 'balanced', daily_calories integer default 2000, daily_protein integer default 60, daily_carbs integer default 250, daily_fat integer default 65, daily_fiber integer default 30, weight_kg numeric, target_weight_kg numeric, height_cm numeric, activity_level text default 'moderate', age integer, gender text, created_at timestamptz default now(), updated_at timestamptz default now())`

      const r2 = await fetch(`https://${projectRef}.supabase.co/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        },
        body: JSON.stringify({ sql: ddl2 })
      })
      results['nutrition_goals'] = r2.ok ? 'created' : `error ${r2.status}: ${await r2.text()}`
    }
  }

  return NextResponse.json({ ok: true, results })
}
