import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`) }
  catch (error) { console.error(`  ✗ ${name}`); throw error }
}

console.log('Product readiness regression checks')

const learn = read('components/dashboard/learn-with-gogo.tsx')
const presenterRoute = read('app/api/dashboard/master-gogo-presenter/route.ts')
check('Learn uses the seated Master Gogo presenter through a same-origin route', () => {
  assert.match(learn, /<video/)
  assert.match(learn, /\/api\/dashboard\/master-gogo-presenter/)
  assert.match(learn, /presenterRef/)
  assert.doesNotMatch(learn, /cloudfront\.net|_jwt=/)
})
check('Master Gogo presenter is persisted in AskGogo storage', () => {
  assert.match(presenterRoute, /SUPABASE_DOCUMENT_BUCKET/)
  assert.match(presenterRoute, /_system\/learn\/master-gogo-presenter\.mp4/)
  assert.match(presenterRoute, /\.download\(STORAGE_PATH\)/)
  assert.match(presenterRoute, /\.upload\(/)
  assert.match(presenterRoute, /X-AskGogo-Video-Source/)
})

const pay = read('app/pay/page.tsx')
check('Pay page sells only Essential, Plus and Pro at canonical prices', () => {
  assert.match(pay, /name:'Gogo Essential'.*amount:249/s)
  assert.match(pay, /name:'Gogo Plus'.*amount:499/s)
  assert.match(pay, /name:'Gogo Pro'.*amount:999/s)
  assert.doesNotMatch(pay, /amount:\s*99\b|amount:\s*299\b|name:'Lite'|name:'Power'/)
})
check('Pay page uses recurring subscription checkout and trial copy', () => {
  assert.match(pay, /\/api\/subscription\/create/)
  assert.match(pay, /7-day free trial/)
  assert.doesNotMatch(pay, /\/api\/payments\/create-link/)
})

const upgrade = read('app/upgrade/page.tsx')
check('Dashboard upgrade uses canonical Gogo plan catalog', () => {
  assert.match(upgrade, /GOGO_INDIA_PLANS/)
  assert.match(upgrade, /'essential','plus','pro'/)
  assert.doesNotMatch(upgrade, /amount:\s*99\b|amount:\s*299\b|name:\s*'Lite'|name:\s*'Power'/)
})
check('Dashboard upgrade does not create a payment/subscription during render', () => {
  assert.doesNotMatch(upgrade, /createPaymentLink|createSubscription/)
  assert.match(upgrade, /\/pay\?plan=/)
})

const whatsapp = read('lib/bot/handlers/whatsapp-premium.ts')
check('WhatsApp pricing is Free/Essential/Plus/Pro with 7-day trial', () => {
  assert.match(whatsapp, /\*Gogo Free\* — ₹0/)
  assert.match(whatsapp, /\*Gogo Essential\* — ₹249\/month/)
  assert.match(whatsapp, /\*Gogo Plus — most popular\* — ₹499\/month/)
  assert.match(whatsapp, /\*Gogo Pro\* — ₹999\/month/)
  assert.match(whatsapp, /7-day free trial/)
  assert.doesNotMatch(whatsapp, /\*Lite\* — ₹99|\*Power\* — ₹499|₹299\/month/)
})

const subscription = read('app/api/subscription/create/route.ts')
check('Public subscription endpoint has origin, plan and phone validation', () => {
  assert.match(subscription, /sameOrigin\(req\)/)
  assert.match(subscription, /invalid_plan/)
  assert.match(subscription, /invalid_phone/)
  assert.match(subscription, /already_subscribed/)
  assert.match(subscription, /'essential' \| 'plus' \| 'pro'/)
})

const razorpaySubs = read('lib/services/razorpay-subscriptions.ts')
check('Razorpay plans are exact-price validated before checkout', () => {
  assert.match(razorpaySubs, /essential:\s*24900/)
  assert.match(razorpaySubs, /plus:\s*49900/)
  assert.match(razorpaySubs, /pro:\s*99900/)
  assert.match(razorpaySubs, /isExactPlan/)
  assert.match(razorpaySubs, /Could not create exact Razorpay/)
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
