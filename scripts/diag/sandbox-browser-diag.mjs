// Diagnostic: prove Playwright/Chromium can launch inside a Vercel Sandbox.
// Run: node scripts/diag/sandbox-browser-diag.mjs [imageOrRuntime]
// Reads VERCEL_OIDC_TOKEN from .env.local and project/team from .vercel/project.json.
// This is a SCRATCH diagnostic (not shipped). It uses OPEN network only to
// determine the correct bootstrap; the applied production fix keeps the locked
// network policy.

import { readFileSync } from 'node:fs'
import { Sandbox } from '@vercel/sandbox'

function loadEnvLocal() {
  // Later files win, so a fresh scratch pull overrides a stale .env.local.
  const files = ['.env.local', '.env.vercel.scratch']
  const out = {}
  for (const f of files) {
    let raw = ''
    try { raw = readFileSync(f, 'utf8') } catch { continue }
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      out[m[1]] = v
    }
  }
  return out
}

function decodeExp(token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return `(not a JWT, len ${String(token || '').length})`
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    const status = p.exp < now ? `EXPIRED ${Math.round((now - p.exp) / 3600)}h ago` : `valid ${Math.round((p.exp - now) / 60)}m`
    return `exp=${p.exp} now=${now} => ${status}`
  } catch (e) { return `(decode error: ${e.message})` }
}

const env = loadEnvLocal()
const token = process.env.VERCEL_OIDC_TOKEN || env.VERCEL_OIDC_TOKEN
if (token) process.env.VERCEL_OIDC_TOKEN = token
let projectId, teamId
try {
  const pj = JSON.parse(readFileSync('.vercel/project.json', 'utf8'))
  projectId = pj.projectId; teamId = pj.orgId
} catch {}
if (!projectId || !teamId) {
  // Newer Vercel CLI writes .vercel/repo.json (multi-project "repo link") instead.
  try {
    const rj = JSON.parse(readFileSync('.vercel/repo.json', 'utf8'))
    const p = (rj.projects || []).find(p => p.directory === '.') || (rj.projects || [])[0]
    if (p) { projectId = projectId || p.id; teamId = teamId || p.orgId }
  } catch {}
}
projectId = process.env.VERCEL_PROJECT_ID || projectId
teamId = process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID || teamId

console.log('== auth ==')
console.log('token present:', !!token, token ? decodeExp(token) : '')
console.log('projectId:', projectId, 'teamId:', teamId)
if (!token) { console.error('NO VERCEL_OIDC_TOKEN — cannot run.'); process.exit(2) }

const IMAGE = process.argv[2] || 'vercel/sandbox/node:24'
const REGION = process.env.GOGO_SANDBOX_REGION || 'bom1'
const PW = '1.63.0'

const creds = { token, projectId, teamId }
const createParams = { region: REGION, timeout: 10 * 60 * 1000, resources: { vcpus: 2 }, ...creds }
if (IMAGE.startsWith('runtime:')) createParams.runtime = IMAGE.slice('runtime:'.length)
else createParams.image = IMAGE

async function run(sandbox, label, params) {
  const t0 = Date.now()
  const r = await sandbox.runCommand(params)
  const out = (await r.stdout()).trim()
  const err = (await r.stderr()).trim()
  console.log(`\n--- ${label} (exit ${r.exitCode}, ${Date.now() - t0}ms) ---`)
  if (out) console.log('stdout:', out.slice(0, 4000))
  if (err) console.log('stderr:', err.slice(0, 4000))
  return { code: r.exitCode, out, err }
}

let sandbox
try {
  console.log(`\n== creating sandbox (image/runtime="${IMAGE}", region=${REGION}) ==`)
  const t0 = Date.now()
  sandbox = await Sandbox.create(createParams)
  console.log(`created in ${Date.now() - t0}ms; name=${sandbox.name} image=${sandbox.image} runtime=${sandbox.runtime}`)

  await run(sandbox, 'os info', { cmd: 'bash', args: ['-lc', 'whoami; echo "PWD=$(pwd) HOME=$HOME"; echo "---"; uname -a; echo "---"; cat /etc/os-release 2>/dev/null | head -5; echo "---"; node -v; echo "apt-get:"; (command -v apt-get || echo none); echo "sudo:"; (command -v sudo || echo none)'] })

  await run(sandbox, 'executablePath BEFORE install', { cmd: 'bash', args: ['-lc', 'cd "$HOME" && npm init -y >/dev/null 2>&1; npm i --no-audit --no-fund playwright@' + PW + ' >/tmp/npm.log 2>&1 && node -e "const{chromium}=require(\'playwright\');const p=chromium.executablePath();const fs=require(\'fs\');console.log(p, fs.existsSync(p)?\'EXISTS\':\'MISSING\')" || (echo NPM_INSTALL_FAILED; tail -20 /tmp/npm.log)'] })

  await run(sandbox, 'playwright install chromium (NO --with-deps)', { cmd: 'bash', args: ['-lc', 'cd "$HOME" && npx playwright install chromium 2>&1 | tail -20; echo "exit:$?"'] })

  await run(sandbox, 'executablePath AFTER install', { cmd: 'bash', args: ['-lc', 'cd "$HOME" && node -e "const{chromium}=require(\'playwright\');const p=chromium.executablePath();const fs=require(\'fs\');console.log(p, fs.existsSync(p)?\'EXISTS\':\'MISSING\')"'] })

  // Attempt launch WITHOUT installing OS deps first — expected to reveal missing libs (if any).
  const launchScript = `const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ headless: true });
  const pg = await b.newPage();
  await pg.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log('TITLE:' + (await pg.title()));
  await b.close();
  console.log('LAUNCH_OK');
})().catch(e => { console.error('LAUNCH_FAIL:' + (e && e.stack || e)); process.exit(1); });`
  await sandbox.writeFiles([{ path: 'launch.js', content: Buffer.from(launchScript) }])
  const first = await run(sandbox, 'LAUNCH attempt #1 (no OS deps)', { cmd: 'bash', args: ['-lc', 'cd "$HOME" && node launch.js'] })

  if (first.code !== 0) {
    console.log('\n== launch failed — installing OS deps via playwright install-deps (sudo) ==')
    // Playwright knows the exact apt package list for chromium; run it as root.
    await run(sandbox, 'playwright install-deps chromium (sudo)', { cmd: 'bash', args: ['-lc', 'cd "$HOME" && npx playwright install-deps chromium 2>&1 | tail -30; echo "exit:$?"'], sudo: true })
    await run(sandbox, 'LAUNCH attempt #2 (after deps)', { cmd: 'bash', args: ['-lc', 'cd "$HOME" && node launch.js'] })
  }
} catch (e) {
  console.error('\nDIAG_ERROR:', e && (e.stack || e.message || e))
  process.exitCode = 1
} finally {
  if (sandbox) { try { await sandbox.stop() } catch {} console.log('\n== sandbox stopped ==') }
}
