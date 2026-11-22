// Gmail -> open-loop completion gate: original pure export, synthetic mail only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source=readFileSync('lib/agent/open-loops.ts','utf8')
assert.match(source,/if\(!isGmailThreadCompletionEvidence\(last\)\)continue/,
  'ambiguous latest mail must not close an earlier source-bound loop')
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const actual:any={}
runInNewContext(compiled,{exports:actual,require:()=>({}),console,Date,Set,Map,BigInt},
  {filename:'lib/agent/open-loops.ts'})
const proof=actual.isGmailThreadCompletionEvidence
assert.equal(typeof proof,'function')
const mail=(snippet:string,rest:any={})=>({from:'Alice Example <alice@example.invalid>',
  subject:'Re: signed agreement',snippet,...rest})
for(const [label,message] of [
 ['empty',mail('')],
 ['auto-reply',mail('We have sent your document.',{autoSubmitted:'auto-replied'})],
 ['no-reply',mail('We have sent your document.',{from:'No Reply <noreply@example.invalid>'})],
 ['bulk mail',mail('We have sent your document.',{labelIds:['CATEGORY_PROMOTIONS']})],
 ['acknowledgment',mail('We received your email and will respond soon.')],
 ['generic human',mail('Thanks for the update. Looking into it.')],
 ['future',mail('We will send the signed agreement tomorrow.')],
 ['negative',mail('We have not sent the signed agreement.')],
 ['uncertain',mail('We might have sent the signed agreement.')],
 ['question',mail('Have we sent the signed agreement?')],
 ['other company news',mail('The vendor completed a task somewhere else.',{listUnsubscribe:'<https://example.invalid/unsubscribe>'})],
] as const) assert.equal(proof(message),false,label+' must keep the open loop unresolved')
for(const snippet of ['We sent the signed agreement.', 'I have delivered the corrected document.',
 "I've sent the signed agreement.", 'I’ve sent the signed agreement.',
 "We've delivered the corrected document.", 'We’ve delivered the corrected document.',
 "We've already approved the requested document.",
 'Our team already approved the requested document.'])
 assert.equal(proof(mail(snippet)),true,'a specific affirmative human completion can reconcile the same thread')
console.log('PASS: Gmail auto/ambiguous/future/negated reply leaves open loop active; substantive human-completed action may reconcile it. No provider or DB calls.')
