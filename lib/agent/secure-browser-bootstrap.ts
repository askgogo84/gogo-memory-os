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
//  2. Working dir is /vercel (the sandbox user's HOME) — there is NO
//     /vercel/sandbox directory. Commands and the browser profile must live
//     under /vercel.
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

export const PLAYWRIGHT_VERSION = '1.63.0'

// Officially-supported managed image (replaces deprecated runtime:'node24').
export const SANDBOX_IMAGE = 'vercel/sandbox/node:24'

// Chromium persistent profile — under /vercel (HOME), NOT /vercel/sandbox.
export const BROWSER_PROFILE_DIR = '/vercel/browser-profile'

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

// Returns 'ready' only when the Playwright package AND the Chromium binary both
// exist — a persistent sandbox can retain node_modules while the browser cache
// was evicted, so a package-only check is not enough.
const READY_CHECK =
  `if [ -f node_modules/playwright/package.json ]; then node -e "const fs=require('fs');const {chromium}=require('playwright');process.stdout.write(fs.existsSync(chromium.executablePath())?'ready':'missing')"; else echo missing; fi`

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

  // 1) Install the Playwright package + Chromium binary as the sandbox user
  //    (HOME=/vercel). No --with-deps: apt is handled as root below.
  const install = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `cd "$HOME" && npm init -y >/dev/null 2>&1 || true; npm install --no-audit --no-fund playwright@${PLAYWRIGHT_VERSION} && npx playwright install chromium`],
  })
  if (install.exitCode !== 0) {
    throw new Error(`secure_browser_bootstrap_failed:${String((await install.stderr()) || '').slice(0, 500)}`)
  }

  // 2) Install Chromium's OS libraries as root via apt (over HTTPS). npx resolves
  //    the just-installed playwright from /vercel/node_modules.
  const deps = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `cd /vercel && ${APT_TO_HTTPS} && apt-get update && npx playwright install-deps chromium`],
    sudo: true,
  })
  if (deps.exitCode !== 0) {
    throw new Error(`secure_browser_bootstrap_failed:${String((await deps.stderr()) || '').slice(0, 500)}`)
  }
}
