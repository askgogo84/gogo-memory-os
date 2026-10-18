const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve('lib/bot/handlers'),cache={};
let instant=Date.parse('2026-10-18T12:00:00Z');
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[instant]));}static now(){return instant;}}
function load(file){
 const full=path.resolve(file);assert(full.startsWith(root+path.sep),'Unexpected dependency');if(cache[full])return cache[full];
 const exports=cache[full]={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date:FixedDate,URL,require:id=>{assert(id.startsWith('.'),'No external transport or credential dependencies');return load(path.resolve(path.dirname(full),id+'.ts'));}});return exports;
}
const actual=load(path.join(root,'formatters.ts'));
const question='what is the gold rate today in Bangalore';
const answer=context=>actual.formatGoldAnswer(question,context);
const source='https://www.tanishq.co.in/gold-rate.html?lang=en_IN';
// Short first-party table/history excerpt read 18 Oct; selector labels are not price rows.
const excerpt='22 Kt Gold Rate\n1 G | ₹13575\nGold Rate History\n22 Karat\n18 Karat\n24 Karat\n18-10-2026 | ₹13575';
const failures=[];
function check(label,fn){try{fn();console.log('PASS '+label);}catch(error){failures.push(label+': '+error.message);}}
check('first-party history selector cannot borrow the 22K historical price',()=>{
 const result=answer(`1. Tanishq rates\n${excerpt}\nSource: ${source}`);assert.match(result,/22K: ₹13,?575/);assert.doesNotMatch(result,/24K: ₹13,?575/);
});
check('whitespace-normalized provider snippet preserves the same row boundary',()=>{
 const result=answer(`1. Tanishq rates\n${excerpt.replace(/\s+/g,' ')}\nSource: ${source}`);assert.match(result,/22K: ₹13,?575/);assert.doesNotMatch(result,/24K: ₹13,?575/);
});
check('an unavailable quote cannot borrow currency from another source',()=>{
 const result=answer('1. Board\n22K per gram unavailable\nSource: https://a.test\n\n2. News\n₹14,000\nSource: https://b.test');assert.doesNotMatch(result,/22K: ₹14,?000/);
});
check('10-gram board rows are converted to an explicit per-gram quote',()=>{
 const result=answer('1. Bangalore rates\nAs of 18 October 2026. 22K gold rate: 10 g | ₹135750\nSource: https://synthetic.invalid/board');assert.match(result,/22K: ₹13,?575(?:\.00)?\b/);assert.match(result,/per gram|per 1 ?g|\/g\b/i);assert.doesNotMatch(result,/22K: ₹135,?750/);
});
check('a retail gold coin price is not substituted for a metal rate',()=>{
 const result=answer('1. Gold coin\n1 gram 24 Karat Gold Coin with motif ₹16087 Add to Cart\nSource: https://synthetic.invalid/coin');assert.doesNotMatch(result,/24K: ₹16,?087/);
});
check('a dated past quote never becomes today\'s price',()=>{
 const result=answer('1. Bangalore rates\nAs of 17 October 2026: 24K gold per gram ₹14000; 22K gold per gram ₹12800\nSource: https://synthetic.invalid/yesterday');assert.doesNotMatch(result,/Gold price today/i);assert.match(result,/17 October 2026|17 Oct 2026|2026-10-17|previous|older|not.*today/i);
});
check('valid dated purity quotes retain amount, unit, date and source',()=>{
 const result=answer('1. Bangalore rates\nAs of 18 October 2026: 24K gold per gram ₹14000; 22K gold per gram ₹12800\nSource: https://synthetic.invalid/current');assert.match(result,/24K: ₹14,?000(?:\.00)?\b/);assert.match(result,/22K: ₹12,?800(?:\.00)?\b/);assert.match(result,/per gram|per 1 ?g|\/g\b/i);assert.match(result,/18 October 2026|18 Oct 2026|2026-10-18/);assert.match(result,/https:\/\/synthetic\.invalid\/current/);
});
check('conflicting same-date source quotes remain visible or explicitly uncertain',()=>{
 const result=answer('1. Bangalore rates\n18 October 2026: 24K gold per gram ₹14000\nSource: https://synthetic.invalid/a\n\n2. Bangalore rates\n18 October 2026: 24K gold per gram ₹14100\nSource: https://synthetic.invalid/b');assert.match(result,/https:\/\/synthetic\.invalid\/a/);assert.match(result,/https:\/\/synthetic\.invalid\/b/);assert(/14,?000/.test(result)&&/14,?100/.test(result)||/conflict|differ|uncertain|couldn.t verify/i.test(result));
});
check('a rate with unknown weight is not invented as per gram',()=>{
 const result=answer('1. Bangalore rates\n18 October 2026: 24K gold ₹140000\nSource: https://synthetic.invalid/no-unit');assert.doesNotMatch(result,/24K: ₹140,?000/);assert.match(result,/unit|weight|per.gram|couldn.t|unverified|not.*verif/i);
});
check('a future quote cannot be presented as a current verified rate',()=>{
 const result=answer('1. Bangalore rates\nAs of 19 October 2026: 24K gold per gram ₹14000\nSource: https://synthetic.invalid/future');assert.doesNotMatch(result,/Gold price today/i);assert.match(result,/future|not.*verif|couldn.t|not.*current/i);
});
check('silver remains an independent supported metal read',()=>{
 const result=actual.formatGoldAnswer('silver price today','1. Silver rate\nSilver ₹250 per gram\nSource: https://synthetic.invalid/silver');assert.match(result,/Silver price/);assert.match(result,/₹250/);
});
check('table date columns are respected even in a flattened snippet',()=>{
 for(const reverse of [false,true]){
  const columns=reverse?'Yesterday | Today':'Today | Yesterday',values=reverse?'₹13555 | ₹13575':'₹13575 | ₹13555';
  const result=answer(`1. Bangalore board\nAs of 18 October 2026. 22 Kt Gold Rate Grammage | ${columns} 1 G | ${values}\nSource: https://synthetic.invalid/columns`);
  assert.match(result,/22K: ₹13,?575/);assert.doesNotMatch(result,/22K: ₹13,?555/);
 }
});
check('a different purity cannot inherit a table row weight',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. 24K gold rate: 8 g | ₹112000; 22K gold ₹12800\nSource: https://synthetic.invalid/weights');
 assert.match(result,/24K: ₹14,?000/);assert.doesNotMatch(result,/22K: ₹1,?600/);
});
check('each purity keeps its own quoted date',()=>{
 const result=answer('1. Bangalore board\n24K as of 17 October 2026 per gram ₹14000; 22K as of 18 October 2026 per gram ₹12800\nSource: https://synthetic.invalid/dates');
 assert.match(result,/24K — as of 2026-10-17/);assert.match(result,/22K — as of 2026-10-18/);
});
check('a future quote does not borrow another purity\'s current date',()=>{
 const result=answer('1. Bangalore board\n24K as of 18 October 2026 per gram ₹14000; 22K as of 19 October 2026 per gram ₹12800\nSource: https://synthetic.invalid/future-field');
 assert.match(result,/24K: ₹14,?000/);assert.doesNotMatch(result,/22K: ₹12,?800/);assert.match(result,/future/i);
});
check('Indian trading dates advance at local midnight',()=>{
 const previous=instant;try{
  instant=Date.parse('2026-10-18T20:00:00Z');const result=answer('1. Bangalore board\nAs of 19 October 2026: 24K gold per gram ₹14000\nSource: https://synthetic.invalid/local-date');
  assert.match(result,/24K: ₹14,?000/);assert.doesNotMatch(result,/future date/);
 }finally{instant=previous;}
});
check('an invalid quote-local date cannot inherit a valid heading date',()=>{
 const result=answer('1. Bangalore board\nAs of 18 October 2026. 24K as of 31 November 2026 per gram ₹14000\nSource: https://synthetic.invalid/invalid-date');
 assert.doesNotMatch(result,/24K — as of 2026-10-18/);assert.match(result,/date.*unverified|date.*invalid|couldn.t verify/i);
});
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Actual gold quote provenance: source/row/purity boundaries, weights, dates, conflicts and silver controls passed.');
