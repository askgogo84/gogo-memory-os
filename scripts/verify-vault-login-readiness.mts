import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

// Execute the actual sandbox login script with an inert Playwright transport.
// The fixture never opens a browser, retrieves credentials or submits a form.
const source=readFileSync('lib/agent/secure-computer.ts','utf8')
const start=source.indexOf('const VAULT_LOGIN_SCRIPT=String.raw`')+'const VAULT_LOGIN_SCRIPT=String.raw`'.length
const end=source.indexOf('\n`',start)
assert.ok(start>30&&end>start)
const script=source.slice(start,end)

async function fixture(options:{readyAfter:number;users:number;passwords:number}){
  let clock=0
  const fills:string[]=[]
  const output:string[]=[]
  const field=(kind:string)=>({isVisible:async()=>true,fill:async()=>{fills.push(kind)}})
  const hidden={isVisible:async()=>false}
  const page:any={
    goto:async()=>{},waitForTimeout:async(ms:number)=>{clock+=ms},
    locator:(selector:string)=>{
      const isUser=selector.includes('input[autocomplete')
      const isPass=selector==='input[type="password"]'
      const count=clock>=options.readyAfter?(isUser?options.users:isPass?options.passwords:0):0
      return {count:async()=>count,nth:()=>field(isUser?'username':'password'),first:()=>hidden}
    },
    getByText:()=>({first:()=>hidden}),
    evaluate:async()=>({url:'https://fixture.invalid/login',title:'Login',text:'Login',forms:[]}),
  }
  const context={pages:()=>[page],close:async()=>{}}
  await vm.runInNewContext(script,{
    require:(name:string)=>{assert.equal(name,'playwright');return{chromium:{launchPersistentContext:async()=>context}}},
    process:{env:{GOGO_LOGIN_URL:'https://fixture.invalid/login',GOGO_VAULT_USERNAME:'fixture-user',GOGO_VAULT_SECRET:'fixture-password'},exit:()=>{throw new Error('script failed')}},
    console:{log:(text:string)=>output.push(text),error:(text:string)=>{throw new Error(text)}},
  })
  assert.ok(output.every(line=>!line.includes('fixture-password')&&!line.includes('fixture-user')),'no credential values in diagnostics')
  return {fills,result:JSON.parse(output.at(-1)!).vaultLogin}
}

const hydrated=await fixture({readyAfter:2200,users:1,passwords:1})
assert.deepEqual(hydrated.fills,['username','password'])
assert.equal(hydrated.result.usernameFilled,true)
assert.equal(hydrated.result.passwordFilled,true)
const ambiguous=await fixture({readyAfter:0,users:2,passwords:1})
assert.deepEqual(ambiguous.fills,[],'never type either credential into an ambiguous form')
assert.ok(ambiguous.result.ambiguous.includes('username_fields'))
const ambiguousPassword=await fixture({readyAfter:0,users:1,passwords:2})
assert.deepEqual(ambiguousPassword.fills,['username'])
assert.ok(ambiguousPassword.result.ambiguous.includes('password_fields'))
const missing=await fixture({readyAfter:Infinity,users:1,passwords:1})
assert.deepEqual(missing.fills,[])
assert.equal(missing.result.usernameFilled,false)
assert.match(script,/autocomplete~="username"/,'tokenized username webauthn autocomplete supported')
console.log('Actual Vault script: delayed fields fill, ambiguous/missing fields refuse, diagnostics contain no credentials')
