import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { LIGHT_PALETTE } from '../lib/dashboard/light-palette.mjs'
import { buildLightCss } from './gen-dashboard-light-css.mjs'
import { parseTheme, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from '../lib/dashboard/theme'
// 14 Oct: light theme as an option, dark stays the default. Run: npx tsx scripts/verify-dashboard-light-theme.mts

// 1. The generated stylesheet matches the palette and the classes in use.
assert.equal(readFileSync('app/dashboard-light.css', 'utf8'), buildLightCss(), 'app/dashboard-light.css is stale: run node scripts/gen-dashboard-light-css.mjs')

// 2. Readable: every light text colour passes WCAG AA (4.5:1) on the light page and card colours.
const lum = (hex: string) => {
  const h = hex.replace('#', ''); const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
for (const [dark, light] of Object.entries(LIGHT_PALETTE.text)) {
  for (const surface of ['#f6f1e8', '#fffdf9', '#efe8dd']) assert.ok(contrast(light, surface) >= 4.5, `${dark} -> ${light} on ${surface} is ${contrast(light, surface).toFixed(2)}:1`)
}

// 3. Nothing dark is left unmapped: a new dark background or light-on-dark text added later fails here.
function walk(dir: string, out: string[] = []) { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : p.endsWith('.tsx') && out.push(p) } return out }
const LEAVE = new Set(['#efe6d7', '#f2efea']) // cream discs and cream buttons with dark text: right on both themes
const missing = new Set<string>()
// app/dashboard/page.tsx is the sign-in page, which is already a light cream page in both themes.
for (const file of [...walk('app/dashboard'), ...walk('components/dashboard')].filter(f => f !== join('app', 'dashboard', 'page.tsx'))) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/(?<![\w-])(?:[a-z-]+:)*(bg|text|border)-\[(#[0-9a-fA-F]{3,8})\]/g)) {
    const kind = m[1] as 'bg' | 'text' | 'border'; const hex = m[2].toLowerCase()
    if (LEAVE.has(hex) || (LIGHT_PALETTE as any)[kind][hex]) continue
    const L = lum(hex)
    if (kind === 'bg' && L < 0.03) missing.add(`${file}: bg ${hex}`)
    if (kind === 'text' && L > 0.3) missing.add(`${file}: text ${hex}`)
    if (kind === 'border' && L < 0.03) missing.add(`${file}: border ${hex}`)
  }
}
assert.deepEqual([...missing], [], 'dark colours without a light partner in lib/dashboard/light-palette.mjs')

// 4. Dark is the default; light only when chosen; no dark flash for someone who chose light.
assert.equal(parseTheme(null), 'dark'); assert.equal(parseTheme('weird'), 'dark'); assert.equal(parseTheme('light'), 'light')
assert.ok(THEME_BOOT_SCRIPT.includes(THEME_STORAGE_KEY) && THEME_BOOT_SCRIPT.includes("setAttribute('data-theme'"))
const layout = readFileSync('app/dashboard/layout.tsx', 'utf8')
assert.ok(layout.includes('data-theme="dark"') && layout.includes("import '../dashboard-light.css'") && layout.includes('THEME_BOOT_SCRIPT'))
const css = readFileSync('app/dashboard-light.css', 'utf8')
assert.ok(css.split('\n').filter(l => l.startsWith('.') || l.startsWith('@')).every(l => l.includes(".dashboard-root[data-theme='light']")), 'every light rule is scoped to the light choice')

// 5. The switch is on the You page and in the side menu.
assert.ok(readFileSync('app/dashboard/(app)/you/page.tsx', 'utf8').includes('<ThemeToggle/>'))
assert.ok(readFileSync('components/dashboard/side-rail.tsx', 'utf8').includes('<ThemeToggle compact/>'))
console.log('verify-dashboard-light-theme: ok')
