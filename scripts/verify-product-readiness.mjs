import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (name, fn) => {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (error) {
    console.error(`  ✗ ${name}`)
    throw error
  }
}

console.log('Product readiness regression checks')

const learn = read('components/dashboard/learn-with-gogo.tsx')
check('Learn presenter uses permanent local animated Gogo asset', () => {
  assert.match(learn, /src="\/gogo-float\.gif"/)
})
check('Learn presenter has no expiring Runway/CloudFront signed URL', () => {
  assert.doesNotMatch(learn, /cloudfront\.net|_jwt=|MASTER_GOGO_PRESENTER/)
})

const pay = read('app/pay/page.tsx')
check('Pay page sells only Lite, Pro and Power', () => {
  assert.match(pay, /name: 'Lite'.*amount: 99/s)
  assert.match(pay, /name: 'Pro'.*amount: 299/s)
  assert.match(pay, /name: 'Power'.*amount: 499/s)
  assert.doesNotMatch(pay, /name: 'Starter'|name: 'Lifetime'|name: 'Founder Pro'/)
})
check('Pay page uses recurring subscription checkout and trial copy', () => {
  assert.match(pay, /\/api\/subscription\/create/)
  assert.match(pay, /7-day free trial/)
  assert.doesNotMatch(pay, /\/api\/payments\/create-link/)
})

const upgrade = read('app/upgrade/page.tsx')
check('Dashboard upgrade shows canonical Lite Pro Power prices', () => {
  assert.match(upgrade, /amount: 99/)
  assert.match(upgrade, /amount: 299/)
  assert.match(upgrade, /amount: 499/)
  assert.doesNotMatch(upgrade, /amount: 149|amount: 9999|name: 'Starter'|name: 'Lifetime'/)
})
check('Dashboard upgrade does not create a payment/subscription during render', () => {
  assert.doesNotMatch(upgrade, /createPaymentLink|createSubscription/)
  assert.match(upgrade, /\/pay\?plan=/)
})

const whatsapp = read('lib/bot/handlers/whatsapp-premium.ts')
check('WhatsApp pricing is Free/Lite/Pro/Power with 7-day trial', () => {
  assert.match(whatsapp, /\*Free\* — ₹0/)
  assert.match(whatsapp, /\*Lite\* — ₹99\/month/)
  assert.match(whatsapp, /\*Pro — most popular\* — ₹299\/month/)
  assert.match(whatsapp, /\*Power\* — ₹499\/month/)
  assert.match(whatsapp, /7-day free trial/)
  assert.doesNotMatch(whatsapp, /\*Starter\*|₹199\/month|\*Founder Pro\*/)
})

const subscription = read('app/api/subscription/create/route.ts')
check('Public subscription endpoint has origin, plan and phone validation', () => {
  assert.match(subscription, /sameOrigin\(req\)/)
  assert.match(subscription, /invalid_plan/)
  assert.match(subscription, /invalid_phone/)
  assert.match(subscription, /already_subscribed/)
})

for (const path of [
  'app/api/test/route.ts',
  'app/api/test-search/route.ts',
  'app/api/test-gmail/route.ts',
  'app/api/debug/media-env/route.ts',
  'app/api/debug/media-files/route.ts',
  'app/api/debug/pricing-limits/route.ts',
  'app/api/debug/fair-use/route.ts',
  'app/api/debug/voice-version/route.ts',
  'app/api/debug/whatsapp-version/route.ts',
  'app/api/dev/migrate-nutrition/route.ts',
  'app/api/dev/webhook/route.ts',
  'app/api/payment/trial/route.ts',
  'app/api/payment/create/route.ts',
  'app/api/payments/create-link/route.ts',
]) {
  check(`${path} is disabled or hidden in production`, () => {
    assert.match(read(path), /(?:VERCEL_ENV|NODE_ENV)\s*===\s*['"]production['"]/)
  })
}

const vercel = JSON.parse(read('vercel.json'))
check('Reminder cron is scheduled every minute', () => {
  const reminder = vercel.crons.find((cron) => cron.path === '/api/cron/reminders')
  assert.equal(reminder?.schedule, '* * * * *')
})

console.log('✅ product readiness checks passed')
