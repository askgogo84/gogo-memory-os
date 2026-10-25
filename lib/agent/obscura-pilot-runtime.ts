import { createHash, randomUUID } from 'node:crypto'
import { Sandbox } from '@vercel/sandbox'
import { browserTargetUrl } from './sentinel'
import { browserPageAllowlist } from './browser-page-network'
import { SANDBOX_IMAGE, SANDBOX_WORKDIR } from './secure-browser-bootstrap'
import {
  readWithObscura,
  type ObscuraReadCandidate,
  type ObscuraRequest,
} from './obscura-public-read'

// Pinned upstream release (2026-10-17). This is the no-render, no-stealth
// variant: public source reading only; no human takeover or CAPTCHA solving.
// Its SHA256 comes from the release manifest, never from a moving latest URL.
export const OBSCURA_VERSION = 'v0.2.5'
export const OBSCURA_ARCHIVE_SHA256 = '405b7d1b79a94f89be1dcad03edab3c48858568b5cb03b90d9e7dcbfda449b12'
const ARCHIVE_URL = 'https://github.com/h4ckf0r0day/obscura/releases/download/v0.2.5/obscura-x86_64-linux-no-render.tar.gz'
const DIR = SANDBOX_WORKDIR + '/obscura-pilot'
const BINARY = DIR + '/obscura'
const MAX_OUTPUT = 26000
// The official Vercel node:24 Sandbox image has Node but no curl executable.
// Native fetch is available; archive SHA256 is still independently verified.
const DOWNLOAD_SCRIPT = 'const fs=require("node:fs");' +
  '(async()=>{const r=await fetch(' + JSON.stringify(ARCHIVE_URL) +
  ',{signal:AbortSignal.timeout(65000)});if(!r.ok)throw Error("download_http");' +
  'const b=Buffer.from(await r.arrayBuffer());if(b.length>60000000)throw Error("archive_too_large");' +
  'fs.writeFileSync("obscura.tgz",b)})().catch(()=>process.exit(1))'

/** Caller may safely fall back to the ordinary browser on null (read-only). */
export async function tryObscuraPublicRead(params: ObscuraRequest): Promise<ObscuraReadCandidate | null> {
  return readWithObscura(params, async ({ url, expression, timeoutSeconds }, owner) => {
    // A unique disposable compute environment means no cookie/Vault/other-owner
    // reuse. A previously started browser's CDP or profile is never attached.
    const target = browserTargetUrl(url)
    const digest = createHash('sha256').update(owner + '\0' + target.origin).digest('hex').slice(0, 16)
    const sandbox = await Sandbox.getOrCreate({
      name: 'gogo-obscura-v1-' + digest + '-' + randomUUID().slice(0, 8),
      image: SANDBOX_IMAGE,
      region: process.env.GOGO_SANDBOX_REGION || 'bom1',
      timeout: 5 * 60 * 1000,
      persistent: false,
      resources: { vcpus: 1 },
    } as any)
    try {
      // Separate one-time vendor asset egress from page-fetch egress.
      await sandbox.updateNetworkPolicy({ allow: {
        'github.com': [],
        'release-assets.githubusercontent.com': [],
        'objects.githubusercontent.com': [],
      } } as any)
      const bootstrap = await sandbox.runCommand({
        cmd: 'bash',
        args: ['-lc', [
          'set -euo pipefail',
          'mkdir -p ' + DIR,
          'cd ' + DIR,
          'node -e ' + JSON.stringify(DOWNLOAD_SCRIPT),
          'echo "' + OBSCURA_ARCHIVE_SHA256 + '  obscura.tgz" | sha256sum -c -',
          'tar xzf obscura.tgz --no-same-owner',
          'test -f obscura && chmod 700 obscura',
          './obscura --version >/dev/null',
        ].join(' && ')],
      })
      if (bootstrap.exitCode !== 0) throw new Error('obscura_binary_incompatible_or_unavailable')
      // Source-aware restrictions still apply to Obscura's subresources.
      await sandbox.updateNetworkPolicy({ allow: browserPageAllowlist(target.href) } as any)
      const result = await sandbox.runCommand({
        cmd: BINARY,
        args: ['fetch', target.href, '--eval', expression,
          '--timeout', String(timeoutSeconds), '--quiet'],
      })
      if (result.exitCode !== 0) throw new Error('obscura_public_read_failed')
      const output = await result.stdout()
      if (output.length > MAX_OUTPUT) throw new Error('obscura_output_too_large')
      return output
    } finally {
      // Never leave billable browser compute or a stale unreviewed session.
      await sandbox.stop().catch(() => {})
    }
  })
}
