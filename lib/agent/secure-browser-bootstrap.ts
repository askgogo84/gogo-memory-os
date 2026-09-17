// Shared, empirically-proven bootstrap for launching real Chromium/Playwright
// inside a Vercel Sandbox. Both the secure browser (secure-computer.ts) and the
// ticket reader (secure-ticket-reader.ts) use the IDENTICAL sequence so they can
// never drift.
//
// Why this exact shape (all points verified against production Vercel Sandboxes):
//  1. Image, not runtime. `runtime:'node24'` is deprecated in @vercel/sandbox;
//     the supported form is `image:'vercel/sandbox/node:24'`.
//  2. The managed node image uses /home/vercel-sandbox as its working/home
//     directory. Keep Playwright, its profile, and launch probes in that one
//     canonical location so resumed sessions do not split state across paths.
//  3. The managed image does NOT ship Chromium's full shared-library set, so a
//     downloaded browser binary can still fail to launch until OS deps exist.
//  4. OS deps require root. Fresh managed images can be Ubuntu/apt-based while
//     persisted or runtime-compatible images can expose dnf/yum instead, so the
//     bootstrap detects the available package manager rather than assuming one.
//  5. The sandbox firewall is an L7 HTTPS proxy. Bootstrap egress therefore
//     includes the npm/Playwright hosts plus Ubuntu and Amazon Linux package
//     repositories; callers lock policy back to the booking provider afterward.
//  6. Playwright downloads browser blobs from cdn.playwright.dev, which can
//     redirect to storage.googleapis.com — both must be reachable during setup.
//  7. `Sandbox.getOrCreate` can resume an existing persistent sandbox. Creation
//     options do not replace the network policy on a resumed session, so setup
//     egress must be explicitly restored before readiness checks or downloads.
//  8. A Chromium binary on disk is not enough: readiness is proven by actually
//     launching and closing Chromium in the current microVM.

import { createHash } from 'crypto'

// ONE sandbox per user, shared by every browser surface: secure-computer.ts,
// secure-ticket-reader.ts and browser-handoff.ts. They previously built their
// own names - the first two used `gogo-browser-<digest>` while the handoff used
// `gogo-browser-v2-<digest>` - so human takeover ran in a DIFFERENT microVM from
// the agent's browser and "resume the same session" could never work.
//
// The -v3- generation also forces a fresh create. A persistent named sandbox is
// resumed by getOrCreate and creation options do NOT re-image it, so sandboxes
// made before the move to image:'vercel/sandbox/node:24' still have the old
// /vercel home and fail every `cd /home/vercel-sandbox`. Bump this generation
// whenever the image or workdir changes.
export const SANDBOX_GENERATION = 'v3'

export function browserSandboxNameFor(userId: string) {
  const digest = createHash('sha256').update(String(userId)).digest('hex').slice(0, 24)
  return `gogo-browser-${SANDBOX_GENERATION}-${digest}`
}

// Declared by EVERY creator. getOrCreate will not add a port to a sandbox that
// was created without one, so a surface that omits it can lock the takeover
// server out of its own microVM.
export const BROWSER_PORTS = [3001]
export const PLAYWRIGHT_VERSION = '1.63.0'

// Officially-supported managed image (replaces deprecated runtime:'node24').
export const SANDBOX_IMAGE = 'vercel/sandbox/node:24'

// Workspace for Playwright + the Chromium profile. The image does NOT ship this
// directory - assuming it existed made every cd fail with
//   bash: line 1: cd: /home/vercel-sandbox: No such file or directory
// on fresh AND resumed sandboxes, so no browser task has ever run. Every command
// now creates it before entering it.
export const SANDBOX_WORKDIR = '/home/vercel-sandbox'

// Chromium persistent profile kept with the Playwright install in one workspace.
export const BROWSER_PROFILE_DIR = `${SANDBOX_WORKDIR}/browser-profile`

// Setup-phase egress allowlist. Only in effect while installing Playwright and
// Chromium OS deps; callers MUST lock the policy down to the target host before
// navigating to any user-controlled URL.
export const BROWSER_SETUP_NETWORK = {
  allow: {
    'registry.npmjs.org': [], '*.npmjs.org': [],
    'cdn.playwright.dev': [], '*.playwright.dev': [],
    'playwright.azureedge.net': [], '*.azureedge.net': [],
    'storage.googleapis.com': [], '*.googleapis.com': [],
    'archive.ubuntu.com': [], 'security.ubuntu.com': [],
    'cdn.amazonlinux.com': [], '*.amazonlinux.com': [], '*.amazonaws.com': [],
  },
} as const

// Ubuntu apt sources can be classic sources.list/*.list or deb822 *.sources.
// Rewrite whichever files exist because the sandbox firewall does not forward
// plain HTTP package traffic.
const APT_TO_HTTPS = `for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do [ -f "$f" ] || continue; sed -i 's#http://archive.ubuntu.com#https://archive.ubuntu.com#g; s#http://security.ubuntu.com#https://security.ubuntu.com#g' "$f"; done`

// Vercel's RPM-based Sandbox images use Amazon Linux package names. Keep this
// explicit so the bootstrap can repair Chromium on resumed sandboxes that do not
// provide apt-get at all.
const DNF_CHROMIUM_DEPS = [
  'nss', 'nspr', 'glib2', 'libxkbcommon', 'atk', 'at-spi2-atk', 'at-spi2-core',
  'libX11', 'libXcomposite', 'libXdamage', 'libXrandr', 'libXfixes', 'libXcursor',
  'libXi', 'libXtst', 'libXScrnSaver', 'libXext', 'libXrender', 'libxcb',
  'libX11-xcb', 'mesa-libgbm', 'libdrm', 'mesa-libGL', 'mesa-libEGL', 'cups-libs',
  'alsa-lib', 'pango', 'cairo', 'gtk3', 'dbus-libs', 'fontconfig', 'freetype',
  'expat', 'libuuid',
].join(' ')

// The only trustworthy readiness signal is a real launch. A browser executable
// can exist while required shared libraries are still missing.
const READY_CHECK = `mkdir -p ${SANDBOX_WORKDIR} && cd ${SANDBOX_WORKDIR} && if [ -f node_modules/playwright/package.json ]; then node -e "const {chromium}=require('playwright');(async()=>{try{const b=await chromium.launch({headless:true});await b.close();process.stdout.write('ready')}catch{process.stdout.write('missing')}})()"; else echo missing; fi`

/**
 * Idempotently ensure a launchable Chromium exists in the sandbox. Safe to call
 * on a fresh or reused persistent sandbox. Throws a bounded bootstrap error on
 * failure so production logs reveal the actual missing dependency without
 * leaking booking URLs or credentials.
 */
export async function ensureBrowserRuntime(sandbox: any): Promise<void> {
  // A named persistent sandbox may have been resumed after a prior request
  // locked egress down to a booking-provider host. Restore bootstrap egress
  // before readiness checks/downloads; callers lock it back after setup.
  await sandbox.updateNetworkPolicy(BROWSER_SETUP_NETWORK as any)

  const check = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', READY_CHECK] })
  if ((await check.stdout()).trim() === 'ready') return

  // 1) Install the Playwright package + Chromium binary as the sandbox user.
  //    OS dependencies are installed separately with root below.
  const install = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `mkdir -p ${SANDBOX_WORKDIR} && cd ${SANDBOX_WORKDIR} && npm init -y >/dev/null 2>&1 || true; npm install --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} && npx playwright install chromium`],
  })
  if (install.exitCode !== 0) {
    throw new Error(`secure_browser_bootstrap_failed:${String((await install.stderr()) || '').slice(0, 500)}`)
  }

  // 2) Install Chromium OS libraries as root. Do not assume a distro/package
  //    manager: current universal images use apt, while RPM-based node/runtime
  //    images and resumed persistent sandboxes can expose dnf/yum instead.
  const depsScript = `mkdir -p ${SANDBOX_WORKDIR} && cd ${SANDBOX_WORKDIR} && if command -v apt-get >/dev/null 2>&1; then ${APT_TO_HTTPS} && apt-get update && npx playwright install-deps chromium; elif command -v dnf >/dev/null 2>&1; then dnf clean all >/dev/null 2>&1 || true; dnf install -y --skip-broken ${DNF_CHROMIUM_DEPS} && ldconfig; elif command -v yum >/dev/null 2>&1; then yum install -y ${DNF_CHROMIUM_DEPS} && ldconfig; else echo unsupported_package_manager >&2; cat /etc/os-release >&2 2>/dev/null || true; exit 127; fi`
  const deps = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', depsScript],
    sudo: true,
  })
  if (deps.exitCode !== 0) {
    throw new Error(`secure_browser_bootstrap_failed:${String((await deps.stderr()) || '').slice(0, 500)}`)
  }

  // 3) Never mark bootstrap ready until Chromium actually launches in this VM.
  const verify = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', READY_CHECK] })
  if ((await verify.stdout()).trim() !== 'ready') {
    throw new Error('secure_browser_bootstrap_failed:chromium_launch_probe_failed')
  }
}
