import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const BUCKET = 'pitch-assets'
const UPLOAD_KEY = 'AGP-2026-09-14-d570c78f1b0846c8915fcaa8e74e79c1'
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'text/html',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]

export async function POST(req: NextRequest) {
  if (req.headers.get('x-pitch-upload-key') !== UPLOAD_KEY) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const path = String(body?.path || '').replace(/^\/+/, '')
  const contentType = String(body?.contentType || '')
  if (!path || !ALLOWED_MIME_TYPES.includes(contentType)) {
    return NextResponse.json({ error: 'invalid_path_or_content_type' }, { status: 400 })
  }

  const { data: buckets, error: bucketListError } = await supabaseAdmin.storage.listBuckets()
  if (bucketListError) return NextResponse.json({ error: bucketListError.message }, { status: 500 })

  const exists = (buckets || []).some((b: any) => b.name === BUCKET)
  if (!exists) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 20 * 1024 * 1024,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
    })
    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true })

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || 'signed_upload_url_failed' }, { status: 500 })
  }

  const { data: publicUrl } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({
    ok: true,
    path,
    contentType,
    signedUrl: data.signedUrl,
    token: data.token,
    url: publicUrl.publicUrl,
  })
}
