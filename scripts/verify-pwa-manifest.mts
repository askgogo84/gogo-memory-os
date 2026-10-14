import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
// 14 Oct: AskGogo must be installable on a phone (Chrome "Install app"), opening straight into Gogo's chat.
// Run: npx tsx scripts/verify-pwa-manifest.mts
const module = { exports: {} as any }
runInNewContext(ts.transpileModule(readFileSync('app/manifest.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { module, exports: module.exports, require(name: string) { throw new Error(`Unmocked: ${name}`) } })
const m = JSON.parse(JSON.stringify(module.exports.default()))

assert.equal(m.display, 'standalone', 'installed app runs without the browser bar')
assert.equal(m.start_url, '/dashboard/chat', 'opens straight into Gogo')
assert.ok(m.name && m.short_name, 'needs a name and a short name for the home screen')
assert.equal(m.background_color, '#0b0b0b'); assert.equal(m.theme_color, '#0b0b0b')
// Chrome installability: a 192px and a 512px PNG icon, and a maskable one for round/squircle launchers.
for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']]) {
  const icon = m.icons.find((i: any) => i.sizes === size && i.purpose === purpose && i.type === 'image/png')
  assert.ok(icon, `missing ${size} ${purpose} png icon`)
  assert.ok(existsSync(`public${icon.src}`), `${icon.src} is listed but the file is missing`)
}
for (const s of m.shortcuts) assert.ok(s.url.startsWith('/dashboard/'), 'shortcuts stay inside the signed-in app')
assert.ok(existsSync('public/icons/apple-touch-icon.png'), 'iPhone home-screen icon')
const layout = readFileSync('app/layout.tsx', 'utf8')
assert.ok(layout.includes('apple-touch-icon.png') && layout.includes('appleWebApp'), 'iPhone needs the apple icon and web-app flag')
assert.ok(readFileSync('app/dashboard/layout.tsx', 'utf8').includes("themeColor: '#0b0b0b'"), 'dashboard browser bar is dark')
console.log('verify-pwa-manifest: ok')
