import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET() {
  const results: string[] = []

  // Create nutrition_logs table
  const { error: e1 } = await supabaseAdmin.from('nutrition_logs').select('id').limit(1)
  if (e1?.code === '42P01') {
    // Table doesn't exist - create via raw SQL using pg extension
    const { error } = await (supabaseAdmin as any).rpc('exec', {
      query: `create table nutrition_logs (
        id uuid primary key default gen_random_uuid(),
        telegram_id bigint not null,
        logged_at timestamptz default now(),
        meal_type text,
        description text not null,
        food_items jsonb default '[]'::jsonb,
        total_calories numeric default 0,
        total_protein numeric default 0,
        total_carbs numeric default 0,
        total_fat numeric default 0,
        total_fiber numeric default 0,
        image_url text,
        source text default 'text',
        raw_ai_response text,
        created_at timestamptz default now()
      )`
    })
    results.push('nutrition_logs: ' + (error?.message || 'created'))
  } else {
    results.push('nutrition_logs: already exists')
  }

  // Create nutrition_goals table
  const { error: e2 } = await supabaseAdmin.from('nutrition_goals').select('id').limit(1)
  if (e2?.code === '42P01') {
    const { error } = await (supabaseAdmin as any).rpc('exec', {
      query: `create table nutrition_goals (
        id uuid primary key default gen_random_uuid(),
        telegram_id bigint not null unique,
        goal_type text default 'balanced',
        daily_calories int default 2000,
        daily_protein int default 60,
        daily_carbs int default 250,
        daily_fat int default 65,
        daily_fiber int default 30,
        weight_kg numeric,
        target_weight_kg numeric,
        height_cm numeric,
        activity_level text default 'moderate',
        age int,
        gender text,
        created_at timestamptz default now(),
        updated_at timestamptz default now()
      )`
    })
    results.push('nutrition_goals: ' + (error?.message || 'created'))
  } else {
    results.push('nutrition_goals: already exists')
  }

  return NextResponse.json({ ok: true, results })
}
