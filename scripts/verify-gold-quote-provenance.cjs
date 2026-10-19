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
check('sentence punctuation never truncates a rupee amount',()=>{
 for(const price of ['11,520','11,520.50']){
  const result=answer(`1. Bangalore board\n18 October 2026. 22K gold per gram Rs. ${price}.\nSource: https://synthetic.invalid/punctuation`);
  assert.match(result,price.endsWith('.50')?/22K: ₹11,520\.5\b/:/22K: ₹11,520\b/);
 }
 const invalid=answer('1. Bangalore board\n18 October 2026. 22K gold per gram ₹11,520.50.99\nSource: https://synthetic.invalid/invalid-number');assert.doesNotMatch(invalid,/22K: ₹/);
});
check('abbreviated quote dates do not borrow an earlier heading date',()=>{
 const result=answer('1. Bangalore board\nAs of 18 October 2026. 24K as of 19 Oct 2026 per gram ₹14000\nSource: https://synthetic.invalid/short-month');assert.doesNotMatch(result,/24K: ₹14,?000/);assert.match(result,/future/i);
});
check('month-first quote dates keep their own day',()=>{
 const result=answer('1. Bangalore board\nAs of 18 October 2026. 24K as of Oct 17, 2026 per gram ₹14000\nSource: https://synthetic.invalid/month-first');assert.match(result,/24K — as of 2026-10-17/);
});
check('currency before a purity label keeps the stated association',()=>{
 const result=answer('1. Bangalore rates\n18 October 2026. ₹14000 per gram for 24K and ₹12800 per gram for 22K\nSource: https://synthetic.invalid/reverse');
 assert.match(result,/24K: ₹14,?000/);assert.match(result,/22K: ₹12,?800/);assert.doesNotMatch(result,/24K: ₹12,?800/);
});
check('mixed forward and reverse quotes do not exchange prices',()=>{
 const result=answer('1. Bangalore rates\n18 October 2026. 24K gold ₹14000 per gram; ₹12800 per gram for 22K\nSource: https://synthetic.invalid/mixed');
 assert.match(result,/24K: ₹14,?000/);assert.match(result,/22K: ₹12,?800/);
});
check('explicit weights stay in their clause unless a heading or coordination shares them',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. 24K gold per 10 g ₹140000; 22K gold ₹12800\nSource: https://synthetic.invalid/explicit-weights');
 assert.match(result,/24K: ₹14,000/);assert.doesNotMatch(result,/22K: ₹/);
 const shared=answer('1. Bangalore board\n18 October 2026. Prices per 10 g: 24K ₹140000; 22K ₹128000\nSource: https://synthetic.invalid/shared-heading');
 assert.match(shared,/24K: ₹14,000/);assert.match(shared,/22K: ₹12,800/);
 const coordinated=answer('1. Bangalore board\nToday 24 Carat gold price per gram in Bangalore is Rs. 12,568 and 22 Carat is Rs. 11,520.\nSource: https://synthetic.invalid/shared-sentence');
 assert.match(coordinated,/24K: ₹12,568/);assert.match(coordinated,/22K: ₹11,520/);
});
check('reverse quotes retain suffix dates without borrowing from the next quote',()=>{
 for(const day of [17,18,19]){
  const result=answer(`1. Bangalore board\n18 October 2026. ₹14000 per gram for 24K as of ${day} October 2026\nSource: https://synthetic.invalid/reverse-date`);
  if(day===19){assert.doesNotMatch(result,/24K: ₹/);assert.match(result,/future/i);}
  else {assert.match(result,/24K: ₹14,000/);assert.match(result,new RegExp(`24K — as of 2026-10-${day}`));}
 }
 const mixed=answer('1. Bangalore board\n18 October 2026. ₹14000 per gram for 24K as of 17 October 2026; ₹12800 per gram for 22K as of 18 October 2026\nSource: https://synthetic.invalid/reverse-local-dates');
 assert.match(mixed,/24K — as of 2026-10-17/);assert.match(mixed,/22K — as of 2026-10-18/);
});
check('inline daily amounts bind to their own day or remain explicitly unverified',()=>{
 for(const columns of ['Yesterday ₹13900; Today ₹14000','Today ₹14000; Yesterday ₹13900']){
  const result=answer(`1. Bangalore board\n18 October 2026. 24K gold price per gram: ${columns}\nSource: https://synthetic.invalid/inline-days`);
  assert.doesNotMatch(result,/24K: ₹13,900/);assert(/24K: ₹14,000/.test(result)||/couldn.t verify|unverified|ambiguous/i.test(result));
 }
 const yesterday=answer('1. Bangalore board\n18 October 2026. 24K gold price per gram: Yesterday ₹13900\nSource: https://synthetic.invalid/inline-yesterday');
 assert.doesNotMatch(yesterday,/24K — as of 2026-10-18/);
});
check('reverse weights use only their own clause including suffix units',()=>{
 for(const first of ['24K gold per 10 g ₹140000','₹140000 for 24K per 10 g']){
  const result=answer(`1. Bangalore board\n18 October 2026. ${first}; ₹12800 for 22K\nSource: https://synthetic.invalid/reverse-unit`);
  assert.match(result,/24K: ₹14,000/);assert.doesNotMatch(result,/22K: ₹/);
 }
 const explicit=answer('1. Bangalore board\n18 October 2026. ₹140000 for 24K per 10 g; ₹12800 for 22K per gram\nSource: https://synthetic.invalid/reverse-own-units');
 assert.match(explicit,/24K: ₹14,000/);assert.match(explicit,/22K: ₹12,800/);
});
check('reverse historical day labels never inherit a current heading date',()=>{
 for(const quote of ['Yesterday ₹13900 per gram for 24K','₹13900 per gram for 24K yesterday']){
  const result=answer(`1. Bangalore board\n18 October 2026. ${quote}\nSource: https://synthetic.invalid/reverse-yesterday`);
  assert.doesNotMatch(result,/24K — as of 2026-10-18/);assert.match(result,/couldn.t verify|unverified|2026-10-17/i);
 }
});
check('reverse unit selection cannot use an earlier amount or purity across a comma',()=>{
 for(const first of ['24K gold per 10 g ₹1,40,000','₹1,40,000 for 24K per 10 g']){
  const result=answer(`1. Bangalore board\n18 October 2026. ${first}, ₹12,800 for 22K\nSource: https://synthetic.invalid/comma-units`);
  assert.doesNotMatch(result,/22K: ₹/);assert.match(result,/unit|weight|unverified/i);
 }
 const own=answer('1. Bangalore board\n18 October 2026. 24K per 10 g ₹140000; per gram ₹12800 for 22K\nSource: https://synthetic.invalid/reverse-prefix-unit');
 assert.match(own,/22K: ₹12,800/);
});
check('reverse suffix qualifiers stop before a comma-separated next quote',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. ₹14000 for 24K, per 10 g ₹128000 for 22K\nSource: https://synthetic.invalid/next-clause-unit');
 assert.doesNotMatch(result,/24K: ₹/);assert.match(result,/22K: ₹12,800/);
 for(const date of ['Oct 17, 2026','17 October, 2026']){
  const dated=answer(`1. Bangalore board\n18 October 2026. ₹14000 per gram for 24K as of ${date}, ₹12800 per gram for 22K as of 18 October 2026\nSource: https://synthetic.invalid/comma-date`);
  assert.match(dated,/24K — as of 2026-10-17/);assert.match(dated,/22K — as of 2026-10-18/);
 }
});
check('a clause comma preserves a complete valid amount without accepting bad grouping',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. 24K gold per 10 g ₹1,40,000, ₹12,800 per gram for 22K\nSource: https://synthetic.invalid/amount-comma');
 assert.match(result,/24K: ₹14,000/);assert.match(result,/22K: ₹12,800/);
 for(const price of ['14,00','14,000,,','14,000.50.99']){
  const invalid=answer(`1. Bangalore board\n18 October 2026. 24K gold per gram ₹${price}\nSource: https://synthetic.invalid/malformed-amount`);
  assert.doesNotMatch(invalid,/24K: ₹/);
 }
});
check('a forward quote date cannot come from the next reverse quote prefix',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. 24K gold per gram ₹14000; as of 17 October 2026 ₹12800 per gram for 22K\nSource: https://synthetic.invalid/mixed-prefix-dates');
 assert.match(result,/24K — as of 2026-10-18/);assert.match(result,/22K — as of 2026-10-17/);
});
check('a comma is number grouping only between numeric characters',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. ₹14000 for 24K,10g ₹128000 for 22K\nSource: https://synthetic.invalid/unspaced-comma');
 assert.doesNotMatch(result,/24K: ₹/);assert.match(result,/22K: ₹12,800/);
});
check('an omitted unknown-weight candidate does not deny valid shown per-gram rates',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. 24K gold per gram ₹14766; 22K gold per gram ₹13536\nSource: https://synthetic.invalid/valid\n\n2. Bangalore board\n18 October 2026. 24K gold ₹150000\nSource: https://synthetic.invalid/missing-unit');
 assert.match(result,/24K: ₹14,766/);assert.match(result,/22K: ₹13,536/);
 assert.match(result,/candidate quote was omitted.*weight\/unit is unverified/i);
 assert.doesNotMatch(result,/a per-gram rate cannot be stated/i);assert.doesNotMatch(result,/24K: ₹1,50,000/);
});
check('a missing-unit-only result retains the explicit no-verified-quote outcome',()=>{
 const result=answer('1. Bangalore board\n18 October 2026. 24K gold ₹150000\nSource: https://synthetic.invalid/missing-only');
 assert.match(result,/couldn't verify a source-bound per-gram gold quote/);
 assert.match(result,/candidate quote was omitted.*weight\/unit is unverified/i);assert.doesNotMatch(result,/24K: ₹/);
});
// 18 Oct live failure class (policybazaar Bangalore): an unrecognised 24K label
// let the 24K table row bleed into the 22K span and become a second 22K price.
const pb='https://www.policybazaar.com/gold-rate/bangalore/';
check('a hyphenated, plural, fineness or spelled-out 24K label bounds the preceding 22K row',()=>{
 for(const label of ['24-Carat Gold Rate','24 Carats Gold','24–karat gold','999 Fine Gold Rate','Twenty-four karat gold']){
  const result=answer(`1. Gold Rates in Bangalore\n18 October 2026. 22K Gold Rate 1 g | ₹13,645 ${label} 1 g | ₹14,327\nSource: ${pb}`);
  assert.match(result,/^22K: ₹13,645$/m,label);assert.doesNotMatch(result,/22K[^\n]*14,327/,label);
  assert.match(result,/^24K: ₹14,327$/m,label);
 }
});
check('an unknown-purity marker ends a purity span without inventing a purity',()=>{
 const result=answer(`1. Gold Rates in Bangalore\n18 October 2026. 22 Karat gold 1 gram | ₹13,645 Pure gold 1 gram | ₹14,327\nSource: ${pb}`);
 assert.match(result,/^22K: ₹13,645$/m);assert.doesNotMatch(result,/14,327/);
});
check('a lower purity at or above a higher purity from one source is not presented as verified',()=>{
 const result=answer(`1. Gold Rates in Bangalore\n18 October 2026. 22K gold per gram ₹14,327; 24K gold per gram ₹14,327\nSource: ${pb}`);
 assert.doesNotMatch(result,/22K: ₹14,327/);assert.doesNotMatch(result,/24K: ₹14,327/);assert.match(result,/purit/i);
 const control=answer(`1. Gold Rates in Bangalore\n18 October 2026. 22K gold per gram ₹13,645; 24K gold per gram ₹14,327\nSource: ${pb}`);
 assert.match(control,/^24K: ₹14,327$/m);assert.match(control,/^22K: ₹13,645$/m);assert.doesNotMatch(control,/purit/i);
});
check('gm and gms are explicit gram units',()=>{
 const result=answer(`1. Gold Rates in Bangalore\n18 October 2026: 22K Gold ₹13,645/gm; 24K Gold ₹14,327 per gm\nSource: ${pb}`);
 assert.match(result,/^22K: ₹13,645$/m);assert.match(result,/^24K: ₹14,327$/m);
 const ten=answer(`1. Gold Rates in Bangalore\n18 October 2026: 22K gold 10 gms | ₹1,36,450\nSource: ${pb}`);
 assert.match(ten,/^22K: ₹13,645$/m);
});
check('a matching hallmark fineness after a karat quote qualifies it instead of stealing it',()=>{
 const result=answer(`1. Gold Rates in Bangalore\n18 October 2026. 22 karat gold rate per gram ₹12,800 (916 purity). 24 karat ₹14,000 per gram\nSource: ${pb}`);
 assert.match(result,/^22K: ₹12,800$/m);assert.match(result,/^24K: ₹14,000$/m);assert.doesNotMatch(result,/weight\/unit is unverified/);
 const hallmark=answer(`1. Gold Rates in Bangalore\n18 October 2026. 24K 999 gold ₹14,327 per gram; 22K (916) gold ₹13,645 per gram\nSource: ${pb}`);
 assert.match(hallmark,/^24K: ₹14,327$/m);assert.match(hallmark,/^22K: ₹13,645$/m);
});
check('an unknown-purity phrase in the heading does not erase heading date or today evidence',()=>{
 const result=answer(`1. Gold Rates in Bangalore\nPure gold price today in Bangalore: 24K gold per gram ₹14,327; 22K gold per gram ₹13,645\nSource: ${pb}`);
 assert.match(result,/^24K: ₹14,327$/m);assert.match(result,/24K — source says today/);
});
// 19 Oct WhatsApp live replies (groww): a 10 g total shown as a per-gram 22K price,
// and an undated 22K quote equal to a dated 24K quote from the same source.
const gw='https://groww.in/gold-rates/gold-rate-today-in-bangalore';
check('a same-purity multi-gram total read as per gram is dropped, not shown as a range',()=>{
 const result=answer(`1. Gold Rate Today in Bangalore\nToday 22K gold per gram ₹13,536\nSource: ${gw}\n\n2. Gold Rate Today in Bangalore\nToday 22K gold 1 g | ₹1,35,360\nSource: ${gw}`);
 assert.match(result,/^22K: ₹13,536$/m);assert.doesNotMatch(result,/1,35,360/);assert.match(result,/multi-gram total/i);
});
check('a dated higher purity equal to an undated lower purity from one source is not presented',()=>{
 const result=answer(`1. Gold Rate Today in Pune\n24K Gold / 10gm 18 Oct 2026 ₹1,35,700\nSource: ${gw}\n\n2. Gold Rate Today in Pune\nToday 22K gold per gram ₹13,570\nSource: ${gw}`);
 assert.doesNotMatch(result,/^24K: ₹13,570$/m);assert.doesNotMatch(result,/^22K: ₹13,570$/m);assert.match(result,/lower gold purity/i);
 const control=answer(`1. Board A\n24K Gold / 10gm 18 Oct 2026 ₹1,35,700\nSource: https://synthetic.invalid/a\n\n2. Board B\nToday 22K gold per gram ₹13,570\nSource: https://synthetic.invalid/b`);
 assert.doesNotMatch(control,/lower gold purity/i);
});
check('the structured extractor returns the same selected per-gram quotes as the reply',()=>{
 const q=load(path.join(root,'gold-quotes.ts'));
 const out=q.extractGoldQuotes(question,'1. Bangalore rates\nAs of 18 October 2026: 24K gold per gram ₹14000; 22K gold per gram ₹12800\nSource: https://synthetic.invalid/current');
 assert.equal(out.selected['24'][0].perGram,14000);assert.equal(out.selected['22'][0].perGram,12800);assert.equal(out.place,'Bangalore');assert.equal(out.today,'2026-10-18');
});
check('an old history figure from another page cannot discard today\'s quotes',()=>{
 const result=answer(`1. Bangalore today\nAs of 18 October 2026: 24K gold per gram ₹13,120; 22K gold per gram ₹12,026\nSource: https://synthetic.invalid/today\n\n2. Gold history\nIn 2012 the 24K rate was ₹2,900 per gram\nSource: https://synthetic.invalid/history`);
 assert.match(result,/24K — as of 2026-10-18; 1 g quote ₹13,120/);assert.match(result,/^22K: ₹12,026$/m);assert.doesNotMatch(result,/multi-gram total/i);
});
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Actual gold quote provenance: source/row/purity boundaries, weights, dates, conflicts and silver controls passed.');
