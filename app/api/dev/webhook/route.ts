import { NextRequest, NextResponse } from 'next/server'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'

const ADMIN_PHONES = ['+918310441698', '+918884501501']
const VERCEL_TOKEN = process.env.VERCEL_TOKEN
const VERCEL_PROJECT_ID = 'prj_8GdFNKeByJwYsNpoyVTL1l0CHjAy'
const VERCEL_TEAM_ID = 'team_ccXmFilB5UvuSz8FLdiuzANM'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const GITHUB_REPO = 'askgogo84/gogo-memory-os'

export const dynamic = 'force-dynamic'

function isAdmin(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return ADMIN_PHONES.some(p => p.replace(/\D/g, '') === digits)
}

async function getDeploymentStatus() {
  if (!VERCEL_TOKEN) return 'VERCEL_TOKEN not set'
  const r = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=3`,
    { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
  )
  const data = await r.json()
  const deploys = data.deployments || []
  if (!deploys.length) return 'No deployments found'
  return deploys.map((d: any) => {
    const icon = d.state === 'READY' ? '✅' : d.state === 'ERROR' ? '❌' : '🔄'
    const msg = (d.meta?.githubCommitMessage || 'deploy').slice(0, 45)
    return `${icon} ${msg}`
  }).join('\n')
}

async function triggerRedeploy() {
  if (!VERCEL_TOKEN) return '❌ VERCEL_TOKEN not set'
  const r = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=1`,
    { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
  )
  const data = await r.json()
  const latest = data.deployments?.[0]
  if (!latest) return '❌ No deployment found to redeploy'
  const redeploy = await fetch(`https://api.vercel.com/v13/deployments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'gogo-memory-os', deploymentId: latest.uid, teamId: VERCEL_TEAM_ID, target: 'production' })
  })
  return redeploy.ok ? '🚀 Redeployment triggered! Ready in ~60s.' : '❌ Redeploy failed'
}

async function createGitHubIssue(title: string, body: string) {
  if (!GITHUB_TOKEN) return '❌ GITHUB_TOKEN not set in Vercel env'
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, labels: ['bug', 'from-whatsapp'] })
  })
  const d = await r.json()
  return r.ok ? `✅ Issue #${d.number} created\n${d.html_url}` : `❌ Failed: ${d.message}`
}

async function getRuntimeErrors() {
  if (!VERCEL_TOKEN) return '❌ VERCEL_TOKEN not set'
  const r = await fetch(
    `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=1`,
    { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
  )
  const data = await r.json()
  const deployId = data.deployments?.[0]?.uid
  if (!deployId) return 'No recent deployment found'
  const logs = await fetch(
    `https://api.vercel.com/v1/deployments/${deployId}/events?teamId=${VERCEL_TEAM_ID}&type=stderr&limit=15`,
    { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
  )
  const logData: any[] = await logs.json()
  const errors = logData
    .filter((e: any) => e.payload?.text)
    .map((e: any) => e.payload.text.slice(0, 100))
    .slice(0, 5)
  return errors.length ? errors.join('\n---\n') : '✅ No errors in recent deployment'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const phone = (body.phone || '').replace(/\D/g, '')
    const text = (body.text || '').trim()

    if (!isAdmin(phone)) {
      return NextResponse.json({ ok: false, reason: 'not_admin' })
    }

    const lower = text.toLowerCase().trim()
    let reply = ''

    if (lower === '/status' || lower === 'status') {
      const status = await getDeploymentStatus()
      reply = `🔧 *AskGogo Deploy Status*\n\n${status}`
    } else if (lower === '/deploy' || lower === '/redeploy') {
      reply = await triggerRedeploy()
    } else if (lower === '/logs' || lower === '/errors') {
      const errors = await getRuntimeErrors()
      reply = `📋 *Recent Errors*\n\n${errors}`
    } else if (lower.startsWith('/fix ') || lower.startsWith('/bug ')) {
      const desc = text.slice(5).trim()
      reply = await createGitHubIssue(`[WA] ${desc}`, `Reported via WhatsApp.\n\n${desc}\n\nReported: ${new Date().toISOString()}`)
    } else if (lower === '/help' || lower === '/dev') {
      reply = `🤖 *Dev Commands*\n\n/status — deploy status\n/deploy — trigger redeploy\n/logs — runtime errors\n/fix [bug] — create issue\n/help — this menu`
    } else {
      return NextResponse.json({ ok: false, reason: 'unknown_command' })
    }

    if (reply && phone) {
      await sendWhatsAppMessage('+' + phone, reply)
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
