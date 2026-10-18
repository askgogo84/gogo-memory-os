import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://notice-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.NEXT_PUBLIC_APP_URL='https://app.askgogo.in'
const {browserHandoffInUseReply,loginUnavailableMessage}=await import('../lib/agent/browser-auth-notice')
const originalFetch=globalThis.fetch
let fail=false
globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input))
  assert.equal(url.origin,'https://notice-fixture.supabase.co')
  assert.equal(init?.method||'GET','GET')
  assert.equal(url.searchParams.get('telegram_id'),'eq.123')
  assert.equal(url.searchParams.get('type'),'eq.secure_browser')
  assert.equal(url.searchParams.get('status'),'eq.paused')
  return new Response(JSON.stringify(fail?{message:'fixture failure'}:[{id:'waiting-run',metadata_json:{handoff:{}}}]),{status:fail?400:200,headers:{'Content-Type':'application/json'}})
}
try{
  const message=await browserHandoffInUseReply(123)
  assert.match(message,/Another browser task is waiting/)
  assert.match(message,/https:\/\/app.askgogo.in\/dashboard\/activity\/waiting-run\/browser/)
  assert.doesNotMatch(message,/try again in a few minutes/i)
  fail=true
  assert.match(await browserHandoffInUseReply(123),/https:\/\/app.askgogo.in\/dashboard\/tasks/)
}finally{globalThis.fetch=originalFetch}
const login=loginUnavailableMessage('instagram.com','https://app.askgogo.in/dashboard/activity/same-run/browser')
assert.match(login,/couldn't sign in to instagram.com automatically/)
assert.match(login,/continue the same question/)
assert.match(login,/not in chat/)
assert.doesNotMatch(login,/send you a sign-in code|Nothing else was entered/)
console.log('Auth notices: exact owner-bound waiting-task link, safe lookup fallback, honest sign-in reason')
