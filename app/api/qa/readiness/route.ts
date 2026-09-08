import { NextRequest, NextResponse } from 'next/server'
import { GOGO_LESSONS } from '@/lib/dashboard/lessons'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ensureRazorpayPlanId } from '@/lib/services/razorpay-subscriptions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const QA_BRANCH = 'qa/product-readiness-2026-09-08'

function maskedId(value: string) {
  return value ? `…${value.slice(-6)}` : null
}

async function dbTable(name: string) {
  const { error, count } = await supabaseAdmin
    .from(name)
    .select('*', { count: 'exact', head: true })
    .limit(1)
  return { ok: !error, count: count ?? null, error: error?.message || null }
}

export async function GET(req: NextRequest) {
  if (process.env.VERCEL_GIT_COMMIT_REF !== QA_BRANCH) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const origin = req.nextUrl.origin

  const audio = await Promise.all(GOGO_LESSONS.map(async (lesson) => {
    try {
      const r = await fetch(`${origin}/api/dashboard/lesson-audio?probe=1&key=${encodeURIComponent(lesson.key)}`, { cache: 'no-store' })
      const body = await r.json().catch(() => ({})) as any
      return {
        key: lesson.key,
        ok: r.ok && body?.ok === true && String(body?.contentType || '').startsWith('audio/'),
        status: body?.status ?? r.status,
        contentType: body?.contentType || null,
        contentLength: body?.contentLength || null,
      }
    } catch (error: any) {
      return { key: lesson.key, ok: false, status: 0, error: error?.message || String(error) }
    }
  }))

  const billingEntries = await Promise.all(['lite', 'pro', 'power'].map(async (plan) => {
    try {
      const id = await ensureRazorpayPlanId(plan)
      return { plan, ok: true, planId: maskedId(id) }
    } catch (error: any) {
      return { plan, ok: false, error: error?.message || String(error) }
    }
  }))

  const tableNames = ['users', 'reminders', 'learning_progress', 'lists', 'documents', 'memory_embeddings']
  const tableEntries = await Promise.all(tableNames.map(async (name) => [name, await dbTable(name)] as const))

  const checks = {
    env: {
      twilioAccount: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      reminderTemplate: Boolean(process.env.TWILIO_REMINDER_BUTTONS_CONTENT_SID || process.env.TWILIO_REMINDER_CONTENT_SID),
      openai: Boolean(process.env.OPENAI_API_KEY),
      razorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET),
      googleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      cronSecret: Boolean(process.env.CRON_SECRET),
    },
    database: Object.fromEntries(tableEntries),
    lessonAudio: audio,
    billingPlans: billingEntries,
  }

  const allAudio = audio.every((x) => x.ok)
  const allBilling = billingEntries.every((x) => x.ok)
  const allDb = tableEntries.every(([, x]) => x.ok)
  const envReady = Object.values(checks.env).every(Boolean)

  return NextResponse.json({
    ok: allAudio && allBilling && allDb && envReady,
    branch: process.env.VERCEL_GIT_COMMIT_REF,
    summary: { allAudio, allBilling, allDb, envReady },
    checks,
    checkedAt: new Date().toISOString(),
  }, { status: allAudio && allBilling && allDb && envReady ? 200 : 503 })
}
