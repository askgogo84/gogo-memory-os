import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const BUCKET = 'pitch-assets'
const UPLOAD_KEY = 'AGP-2026-09-14-d570c78f1b0846c8915fcaa8e74e79c1'

export async function POST(req: NextRequest) {
  if (req.headers.get('x-pitch-upload-key') !== UPLOAD_KEY) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const form = await req.formData()
  const file = form.get('file')
  const path = String(form.get('path') || '').replace(/^\/+/, '')
  const contentType = String(form.get('contentType') || '')

  if (!(file instanceof File) || !path) {
    return NextResponse.json({ error: 'file_and_path_required' }, { status: 400 })
  }

  const { data: buckets, error: bucketListError } = await supabaseAdmin.storage.listBuckets()
  if (bucketListError) return NextResponse.json({ error: bucketListError.message }, { status: 500 })
  if (!(buckets || []).some((b: any) => b.name === BUCKET)) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 20 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    })
    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, {
      upsert: true,
      contentType: contentType || file.type || 'application/octet-stream',
      cacheControl: '3600',
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: publicUrl } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ ok: true, path: data.path, url: publicUrl.publicUrl })
}
