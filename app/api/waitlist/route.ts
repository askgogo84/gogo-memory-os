import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validateWaitlist } from '@/lib/waitlist/validate'

// POST /api/waitlist — askgogo.in waitlist signup. Spec: docs/waitlist/05-BACKEND-SCHEMA.md §4-§6.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_ORIGINS = new Set(['https://askgogo.in', 'https://www.askgogo.in'])
const MAX_BODY_BYTES = 2048

function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) })
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')

  let text: string
  try {
    text = await req.text()
  } catch {
    return reply(origin, 400, { ok: false, errors: {} })
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return reply(origin, 413, { ok: false })

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return reply(origin, 400, { ok: false, errors: {} })
  }

  // Narrow with `in`: this repo compiles with strict:false, where boolean-literal narrowing does not work.
  const result = validateWaitlist(body)
  if ('errors' in result) return reply(origin, 400, { ok: false, errors: result.errors })
  if (!('row' in result)) return reply(origin, 200, { ok: true }) // honeypot: success shape, no write

  const row = result.row

  // Insert first; on a duplicate number update only email + opt-in, leaving country,
  // consent_version, source and created_at as first written (05 §4).
  const { error: insertError } = await supabaseAdmin.from('waitlist').insert(row)
  if (insertError) {
    if (insertError.code !== '23505') {
      console.error('[waitlist] insert failed', insertError.code)
      return reply(origin, 500, { ok: false, error: 'server_error' })
    }
    const { error: updateError } = await supabaseAdmin
      .from('waitlist')
      .update({ email: row.email, whatsapp_opt_in: row.whatsapp_opt_in })
      .eq('phone_e164', row.phone_e164)
    if (updateError) {
      console.error('[waitlist] update failed', updateError.code)
      return reply(origin, 500, { ok: false, error: 'server_error' })
    }
  }

  // Same response for new and existing numbers — never reveal whether a number was already listed.
  return reply(origin, 200, { ok: true })
}
