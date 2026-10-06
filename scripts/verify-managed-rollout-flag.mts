import assert from 'node:assert/strict'
import { managedBrowserEnabledFor, managedBrowserEnabled } from '../lib/agent/managed-browser'

const bb = 'browserbase'

// 1. allowlist UNSET + runtime browserbase → enabled for ANY user (incl. no id).
assert.equal(managedBrowserEnabledFor('12345', { GOGO_BROWSER_RUNTIME: bb }), true)
assert.equal(managedBrowserEnabledFor(undefined, { GOGO_BROWSER_RUNTIME: bb }), true)
assert.equal(managedBrowserEnabledFor('-1001234567890', { GOGO_BROWSER_RUNTIME: bb }), true)

// 2. allowlist UNSET + runtime unset/other → disabled.
assert.equal(managedBrowserEnabledFor('12345', {}), false)
assert.equal(managedBrowserEnabledFor('12345', { GOGO_BROWSER_RUNTIME: 'sandbox' }), false)

// 3. allowlist SET → only listed ids (and not an unlisted id / missing id).
const envSet = { GOGO_BROWSER_RUNTIME: bb, GOGO_BROWSER_MANAGED_ALLOWLIST: '12345, -1001234567890' }
assert.equal(managedBrowserEnabledFor('12345', envSet), true)
assert.equal(managedBrowserEnabledFor('99999', envSet), false)
assert.equal(managedBrowserEnabledFor(undefined, envSet), false, 'no id + set allowlist → sandbox')

// 4. negative WhatsApp ids parse correctly (string and numeric forms).
assert.equal(managedBrowserEnabledFor('-1001234567890', envSet), true)
assert.equal(managedBrowserEnabledFor(-1001234567890, envSet), true)

// Preview: a SET allowlist additionally enables all Preview traffic, but still
// requires runtime==='browserbase'.
const envPreview = { GOGO_BROWSER_RUNTIME: bb, GOGO_BROWSER_MANAGED_ALLOWLIST: '12345', VERCEL_ENV: 'preview' }
assert.equal(managedBrowserEnabledFor('99999', envPreview), true, 'preview enables all when allowlist set')
assert.equal(managedBrowserEnabledFor('99999', { ...envPreview, GOGO_BROWSER_RUNTIME: 'sandbox' }), false)

// Back-compat wrapper: identical to pre-rollout behaviour when the allowlist is unset.
assert.equal(managedBrowserEnabled({ GOGO_BROWSER_RUNTIME: bb }), true)
assert.equal(managedBrowserEnabled({}), false)

console.log('Managed rollout flag verification passed')
