import assert from 'node:assert/strict'
import { detectHumanAuthGate } from '../lib/agent/browser-auth-gate'

const publicForm={title:'Contact us',text:'Send us a message',forms:[{inputs:[{name:'email',type:'email',label:'Email'},{name:'message',type:'textarea',label:'Message'}]}]}
assert.equal(detectHumanAuthGate(publicForm).required,false,'ordinary public form must remain automatable')

const password={title:'Sign in',text:'Log in to continue',forms:[{inputs:[{name:'password',type:'password',label:'Password'}]}]}
assert.deepEqual(detectHumanAuthGate(password),{required:true,reason:'password',message:'This site requires a human sign-in.'})

const otp={title:'Verify',text:'We sent you a code',forms:[{inputs:[{name:'otp',type:'text',label:'Verification code'}]}]}
assert.equal(detectHumanAuthGate(otp).reason,'otp')

const passkey={title:'Sign in',text:'Use your passkey or security key to continue',forms:[]}
assert.equal(detectHumanAuthGate(passkey).reason,'passkey')

const captcha={title:'Verification',text:'Verify you are human',forms:[]}
assert.equal(detectHumanAuthGate(captcha).reason,'captcha')

const payment={title:'Confirm payment',text:'3D Secure bank authentication required',forms:[]}
assert.equal(detectHumanAuthGate(payment).reason,'payment_auth')

console.log('✅ Secure browser human-auth boundary checks passed')

const deviceApproval={title:'Approve sign-in',text:'New device detected. Check your phone and tap Yes to approve this login.',forms:[]}
assert.deepEqual(detectHumanAuthGate(deviceApproval),{required:true,reason:'device_approval',message:'Approve this sign-in on your trusted device, then Gogo can continue the same task.'})

const benignNewDevice={title:'Product launch',text:'Our new device is available now. Check your phone for product updates.',forms:[]}
assert.equal(detectHumanAuthGate(benignNewDevice).required,false,'ordinary new-device/product copy must not trigger auth')

const benignTicket={title:'Your confirmed ticket',text:'Check your phone for your ticket before boarding.',forms:[]}
assert.equal(detectHumanAuthGate(benignTicket).required,false,'ordinary ticket instructions must not trigger auth')

const contextualDeviceApproval={title:'Sign in to continue',text:'We noticed a new device. Check your phone and tap Yes.',forms:[]}
assert.equal(detectHumanAuthGate(contextualDeviceApproval).reason,'device_approval','device cues with sign-in context must still pause safely')

console.log('T1b trusted-device approval auth boundary verified')

for (const text of [
  'Home | Sign in | Products\nOur new device is available; check your phone for updates.',
  'Sign in Check your phone for your ticket before boarding.',
  'Your confirmed ticket. Check your phone for your ticket. Sign in',
  'Sign in\n\nOur new device is available now.',
  `Sign in to your account ${'Browse our products and offers. '.repeat(12)}Check your phone for product updates.`,
  'Verify your identity\n\nYour ticket is confirmed. Check your phone for your ticket.',
]) {
  assert.equal(detectHumanAuthGate({ title:'Travel and products', text }).required,false,
    `navigation or unrelated auth copy must not turn device/ticket copy into authentication: ${text}`)
}

for (const page of [
  { title:'Sign in', text:'Check your phone. Tap Yes to continue.' },
  { title:'Sign in to continue', text:'We sent a notification to your phone. Tap Yes.' },
  { text:'Check your phone and tap Yes to verify your identity.' },
  { text:'Verify it’s you\nNew device detected. Check your phone.' },
  { text:'Authentication required. Approve it on your device.' },
  { text:'Approve this sign-in on your trusted device.' },
  { text:'Approve this login.' },
]) {
  assert.equal(detectHumanAuthGate(page).reason,'device_approval','real device approval must pause for human takeover')
}

for (const [text, reason] of [
  ['Enter the code', 'otp'],
  ['Use your passkey', 'passkey'],
  ['Verify you are human', 'captcha'],
  ['Approve this payment', 'payment_auth'],
] as const) {
  assert.equal(detectHumanAuthGate({text:`Sign in | ${text}`}).reason,reason,
    'secondary authentication must remain human-only')
}

console.log('T1b navigation/proximity regressions and T1c boundaries verified')
