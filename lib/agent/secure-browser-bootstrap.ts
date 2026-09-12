// Shared, empirically-proven bootstrap for launching real Chromium/Playwright
// inside a Vercel Sandbox. Both the secure browser (secure-computer.ts) and the
// ticket reader (secure-ticket-reader.ts) use the IDENTICAL sequence so they can
// never drift.
//
// Why this exact shape (all points verified live against a Vercel Sandbox):
//  1. Image, not runtime. `runtime:'node24'` is deprecated in @vercel/sandbox;
//     the supported form is `image:'vercel/sandbox/node:24'` (an Ubuntu 26.04 /
//     Node 24 managed image). Both resolve to the same VM, but only `image` is
//     future-proof.
//  2. The managed node image uses /home/vercel-sandbox as its working/home
//     directory. Keep Playwright, its profile, and launch probes in that one
//     canonical location so resumed sessions do not split state across paths.
//  3. The managed image does NOT ship Chromium's shared libraries (libglib-2.0
//     et al are absent), so Chromium cannot launch until OS deps are installed.
//  4. OS deps require apt, which requires root — done via `sudo:true`. Chromium's
//     own binary is installed as the normal user (no --with-deps) so it lands in
//     the user's cache; `--with-deps` would try to apt as a non-root user and
//     fail.
//  5. The sandbox firewall is an L7 (HTTPS) proxy: plain-HTTP :80 is not
//     forwarded, so the default http:// Ubuntu apt sources must be rewritten to
//     https:// before `apt-get`.
//  6. Playwright downloads its browser blobs from cdn.playwright.dev, which
//     redirects to storage.googleapis.com — both must be reachable during setup.
//  7. `Sandbox.getOrCreate` can resume an existing persistent sandbox. Creation
//     options do not replace the network policy on a resumed session, so setup
//     egress must be explicitly restored before readiness checks or downloads.
//  8. A Chromium binary on disk is not enough: an earlier failed --with-deps run
//     can leave the binary present but its Linux libraries missing. Readiness is
//     therefore proven by actually launching and closing Chromium.

export const PLAYWRIGHT_VERSION = '1.63.0'

// Officially-supported managed image (replaces deprecated runtime:'node24').
export const SANDBOX_IMAGE = 'vercel/sandbox/node:24'

// Canonical managed-image workspace used by the Vercel Sandbox APIs/docs.
export const SANDBOX_WORKDIR = '/home/vercel-sandbox'

// Chromium persistent profile kept with the Playwright install in one workspace.
export const BROWSER_PROFILE_DIR = `${SANDBOX_WORKDIR}/browser-profile`

// Setup-phase egress allowlist. Only in effect while installing Playwright and
// Chromium's OS deps; callers MUST lock the policy down to the target host
// (updateNetworkPolicy) before navigating to any user-controlled URL.
//   - npm registry: the playwright package
//   - cdn.playwright.dev + storage.googleapis.com: the Chromium browser blobs
//   - archive/security.ubuntu.com: apt packages for `playwright install-deps`
export const BROWSER_SETUP_NETWORK = {
  allow: {
    'registry.npmjs.org': [], '*.npmjs.org': [],
    'cdn.playwright.dev': [], '*.playwright.dev': [],
    'playwright.azureedge.net': [], '*.azureedge.net': [],
    'storage.googleapis.com': [], '*.googleapis.com': [],
    'archive.ubuntu.com': [], 'security.ubuntu.com': [],
  },
} as const

// apt over the sandbox firewall must use HTTPS (the proxy does not forward
// plain-HTTP :80), so rewrite the default http:// Ubuntu sources first.
const APT_TO_HTTPS =
  'sed -i "s#http://archive.ubuntu.com#https://archive.ubuntu.com#g; s#http://security.ubuntu.com#https://security.ubuntu.com#g" /etc/apt/sources.list.d/ubuntu.sources'

// The only trustworthy readiness signal is a real launch. A browser executable
// can exist while required shared libraries are still missing.
const READY_CHECK = `cd ${SANDBOX_WORKDIR} && if [ -f node_modules/playwright/package.json ]; then node -e "const {chromium}=require('playwright');(async()=>{try{const b=await chromium.launch({headless:true});await b.close();process.stdout.write('ready')}catch{process.stdout.write('missing')}})()"; else echo missing; fi`

/**
 * Idempotently ensure a launchable Chromium exists in the sandbox. Safe to call
 * on a fresh or a reused (persistent) sandbox: it no-ops when already ready.
 * Throws Error('secure_browser_bootstrap_failed:<detail>') on failure.
 */
export async function ensureBrowserRuntime(sandbox: any): Promise<void> {
  // A named persistent sandbox may have been resumed after a prior request
  // locked egress down to a booking-provider host. getOrCreate() does not replace
  // that existing session policy, so restore bootstrap egress before touching
  // npm/Playwright/apt. Callers lock it back to the target host after setup.
  await sandbox.updateNetworkPolicy(BROWSER_SETUP_NETWORK as any)

  const check = await sandbox.runCommand({ cmd: 'bash', args: ['-lc', READY_CHECK] })
  if ((await check.stdout()).trim() === 'ready') return

  // 1) Install the Playwright package + Chromium binary as the sandbox user.
  //    No --with-deps: apt is handled as root below.
  const install = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `cd ${SANDBOX_WORKDIR} && npm init -y >/dev/null 2>&1 || true; npm install --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} && npx playwright install chromium`],
  })
  if (install.exitCode !== 0) {
    throw new Error(`secure_browser_bootstrap_failed:${String((await install.stderr()) || '').slice(0, 500)}`)
  }

  // 2) Install Chromium's OS libraries as root via apt (over HTTPS). npx resolves
  //    the just-installed Playwright package from the canonical workspace.
  const deps = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `cd ${SANDBOX_WORKDIR} && ${APT_TO_HTTPS} && apt-get update && npx playwright install-deps chromium`],
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
