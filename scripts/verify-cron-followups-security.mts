import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isCronAuthorized } from '../lib/security/cron-auth'

const request=(url:string,authorization?:string)=>new Request(url,{headers:authorization?{authorization}:{}})
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test'),{}),false)
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test','Bearer secret'),{CRON_SECRET:'secret'}),true)
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test?secret=secret'),{CRON_SECRET:'secret'}),true)
assert.equal(isCronAuthorized(request('https://app.askgogo.in/api/cron/test','Bearer wrong'),{CRON_SECRET:'secret'}),false)

for(const path of [
  'app/api/cron/daily-briefings/route.ts',
  'app/api/cron/lifecycle-emails/route.ts',
  'app/api/cron/briefing/route.ts',
]){
  const source=readFileSync(path,'utf8')
  assert.match(source,/isCronAuthorized/)
  assert.doesNotMatch(source,/if \(!expected\) return true/)
}

const followups=readFileSync('app/api/followups/route.ts','utf8')
assert.match(followups,/requireAgentMutationOrigin/)
assert.match(followups,/requireAgentSession/)
assert.match(followups,/ownerWhatsapp/)
assert.match(followups,/isCronAuthorized/)
assert.doesNotMatch(followups,/const \{ phone, contact/)

console.log('cron + followups hardening verification passed')
