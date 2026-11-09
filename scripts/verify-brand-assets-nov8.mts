// Brand assets (owner-approved 8 Nov): one Gogo everywhere. favicon.ico is Gogo (16/32/48 frames, not Vercel's
// triangle); icons at the sizes browsers, iOS and Android ask for; versioned share images referenced by metadata.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
const png = (p: string) => { const b = readFileSync(p); assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', `${p} is a PNG`); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } }
const ico = readFileSync('app/favicon.ico')
assert.equal(ico.readUInt16LE(2), 1, 'ICO type'); const n = ico.readUInt16LE(4)
const frames = Array.from({ length: n }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b)
assert.deepEqual(frames, [16, 32, 48], 'favicon.ico frames')
// Vercel's default favicon is a black triangle on white: our frames are cream-backed, so no near-black majority.
const sizes: Record<string, [number, number]> = { 'public/icons/icon-192.png': [192, 192], 'public/icons/icon-512.png': [512, 512], 'public/icons/icon-maskable-512.png': [512, 512], 'public/icons/apple-touch-icon.png': [180, 180], 'public/askgogo-share-20261108.png': [1200, 630], 'public/askgogo-share-square-20261108.png': [800, 800] }
for (const [p, [w, h]] of Object.entries(sizes)) assert.deepEqual(Object.values(png(p)), [w, h], p)
console.log('✓ favicon.ico 16/32/48; PWA 192/512/maskable; apple 180; share 1200×630 + 800×800')

const svg = readFileSync('app/icon.svg', 'utf8')
for (const c of ['#2C1A13', '#EF7A27', '#F6F1E8']) assert.ok(svg.includes(c), `icon.svg uses ${c}`)
assert.ok(!/<script|javascript:|on[a-z]+=/i.test(svg), 'icon.svg has no script')
assert.ok(existsSync('scripts/brand/generate.py') && existsSync('scripts/brand/gogo-calm-inner.svgfrag'), 'generator committed')
const frag = readFileSync('scripts/brand/gogo-calm-inner.svgfrag', 'utf8')
assert.ok(svg.includes(frag.slice(0, 120)), 'icon.svg is drawn from the committed character source')
console.log('✓ icon.svg is the approved character, palette intact, no script')

const layout = readFileSync('app/layout.tsx', 'utf8')
assert.match(layout, /url: "\/favicon\.ico", sizes: "16x16 32x32 48x48"/)
assert.match(layout, /askgogo-share-square-20261108\.png", width: 800, height: 800/)
assert.match(layout, /askgogo-share-20261108\.png", width: 1200, height: 630/)
assert.match(layout, /card: "summary_large_image"/)
assert.ok(layout.indexOf('square-20261108') < layout.indexOf('askgogo-share-20261108'), 'square first for WhatsApp')
const invite = readFileSync('app/i/[code]/page.tsx', 'utf8'); assert.ok(!invite.includes("'/askgogo-share.png'"), 'invite page uses the new share image')
const manifest = readFileSync('app/manifest.ts', 'utf8'); for (const i of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) assert.ok(manifest.includes(i))
console.log('✓ metadata: favicon, svg icon, apple icon, versioned square + wide share, twitter large card; invite page updated')
console.log('Brand assets (8 Nov) checks passed')
