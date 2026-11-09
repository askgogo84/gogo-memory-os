// 27 Oct live booking 27507272: Air India's edge answered "Access Denied"; the run must recognise it and go back.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { edgeBlockedPage } = await import('../lib/agent/secure-computer.ts')
assert.equal(edgeBlockedPage({ text: 'Access Denied You don\'t have permission to access "http://www.airindia.com/in/en/refx-booking.html?" on this server. Reference #18.6c68.1.bed04c52 https://errors.edgesuite.net/18.6c68' }), true)
assert.equal(edgeBlockedPage({ text: 'Sorry, you have been blocked. You are unable to access goibibo.com', title: 'Attention Required! | Cloudflare' }), true)
assert.equal(edgeBlockedPage({ text: 'Passenger details. Access Denied? Contact support. Enter your first name' }), false, 'ordinary page mentioning access')
assert.equal(edgeBlockedPage({ text: 'Hi, I\'m AI.g How can I help you?' }), false)
const src = (await import('node:fs')).readFileSync(new URL('../lib/agent/secure-computer.ts', import.meta.url), 'utf8')
assert.ok(src.includes('if(edgeBack)actions.splice(0,actions.length,...edgeBack)'), 'back navigation survives the booking goto filter')
assert.ok(src.includes('edgeBlockedHosts.length<2'), 'at most two blocked sites per run')
console.log('BOOKING_EDGE_BLOCKED_OK')
