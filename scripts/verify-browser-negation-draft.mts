import assert from 'node:assert/strict'
import { parseBrowserCommand } from '../lib/agent/browser-command'

const readOnly = parseBrowserCommand('Open https://example.com and inspect availability. Fill only safe non-sensitive search fields if needed. Make no provider-side changes. Stop before any final action, login, OTP, CAPTCHA, authentication challenge, or financial step.')
assert.ok(readOnly)
assert.equal(readOnly?.mode, 'draft')
assert.equal(readOnly?.approvalAction, undefined)

const execute = parseBrowserCommand('Open https://example.com and book this appointment for me.')
assert.ok(execute)
assert.equal(execute?.mode, 'execute')
assert.equal(execute?.approvalAction, 'booking')

console.log('✅ Browser appointment draft vs booking approval regression passed')