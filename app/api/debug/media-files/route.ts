import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const folder = path.join(process.cwd(), 'public', 'whatsapp')

  const files = [
    'thinking.gif',
    'welcome.gif',
    'referral.gif',
    'founder.gif',
    'pricing.png',
  ]

  const results = files.map((file) => {
    const fullPath = path.join(folder, file)
    const exists = fs.existsSync(fullPath)

    return {
      file,
      exists,
      url: `https://app.askgogo.in/whatsapp/${file}`,
      size: exists ? fs.statSync(fullPath).size : null,
    }
  })

  return NextResponse.json({ ok: true, results, checked_at: new Date().toISOString() })
}
