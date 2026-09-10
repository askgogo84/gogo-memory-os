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
