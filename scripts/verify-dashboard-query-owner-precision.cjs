// Test-only: execute the original dashboard query module with inert service-role
// fixtures. Never connects to production DB, provider APIs, WhatsApp or real users.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const ts = require('typescript');

const A = '9007199254740992';
const B = '9007199254740993';
const NEG = '-9007199254740993';
const calls = [];
const calendarAccess = [];
const privateRows = {
  users: {
    [A]: {name:'A_PRIVATE',whatsapp_id:null,google_calendar_connected:false,gmail_connected:false},
    [B]: {name:'B_PRIVATE',whatsapp_id:null,google_calendar_connected:false,gmail_connected:false},
    '123': {name:'SAFE_PRIVATE',whatsapp_id:null,google_calendar_connected:false,gmail_connected:false},
  },
  lists: {
    [A]: [{id:'a-list',list_name:'A_PRIVATE_LIST',items:[],updated_at:'2026-10-01T00:00:00Z'}],
    [B]: [{id:'b-list',list_name:'B_PRIVATE_LIST',items:[],updated_at:'2026-10-01T00:00:00Z'}],
    '123': [{id:'safe-list',list_name:'SAFE_PRIVATE_LIST',items:[],updated_at:'2026-10-01T00:00:00Z'}],
  },
  friend_contacts: {
    [A]: [{name:'A_PRIVATE_FRIEND'}],
    [B]: [{name:'B_PRIVATE_FRIEND'}],
    '123': [{name:'SAFE_PRIVATE_FRIEND'}],
  },
};
function dataFor(table, owner) {
  assert.notEqual(owner, null, 'private table must carry owner filter: ' + table);
  const bucket = privateRows[table] || {};
  const value = bucket[String(owner)] || null;
  if (table === 'users') return value ? [value] : [];
  return value || [];
}
const db = {
  from(table) {
    if (!['users','lists','friend_contacts'].includes(table)) {
      throw Error('unexpected table query in owner isolation test: ' + table);
    }
    let predicate = null;
    const query = {
      select() { return query; },
      eq(field, value) {
        if (!['telegram_id','owner_telegram_id'].includes(field)) {
          throw Error('unexpected service-role predicate: ' + field);
        }
        assert.equal(predicate, null, 'only one owner predicate expected');
        predicate = value;
        calls.push({table,field,value});
        return query;
      },
      order() { return query; },
      gte() { return query; },
      lt() { return query; },
      limit() { return query; },
      async maybeSingle() {
        return {data: dataFor(table,predicate)[0] || null,error:null};
      },
      then(resolve, reject) {
        try { return Promise.resolve(resolve({data:dataFor(table,predicate),error:null})); }
        catch(err) { return Promise.reject(err).then(undefined,reject); }
      },
    };
    return query;
  },
};
function loadOriginal(path, mocks) {
  const source = readFileSync(path,'utf8');
  const compiled = ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    fileName:path,
  }).outputText;
  const moduleExports = {};
  runInNewContext(compiled,{
    exports:moduleExports,module:{exports:moduleExports},Date,BigInt,Number,Buffer,URL,URLSearchParams,
    console,Intl,Promise,Set,Map,JSON,String,Array,Object,Math,
    fetch:()=>{throw Error('External network prohibited in owner isolation test');},
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks,name)) return mocks[name];
      throw Error('Unexpected imported dependency: ' + name);
    },
  },{filename:path,timeout:3000});
  return moduleExports;
}
const ownerIdentity = loadOriginal('lib/dashboard/owner-identity.ts',{
  'node:crypto':{randomBytes:()=>{throw Error('random owner not needed');}},
});
const meter = {
  getPlan:async()=>({plan_code:'free'}),
  getLimits:async()=>({ai_actions_per_day:20,documents_per_month:5,friend_contacts_max:5,reminders_per_day_fair_use:20,calendars_max:1}),
  getUsage:async()=>({aiToday:0,docsThisMonth:0,friendContacts:0}),
};
const queries = loadOriginal('lib/dashboard/queries.ts',{
  '@/lib/supabase-admin':{supabaseAdmin:db},
  './owner-identity':ownerIdentity,
  '@/lib/ist':{istDayWindow:()=>({startUtc:new Date('2026-11-05T00:00:00Z'),endUtc:new Date('2026-11-06T00:00:00Z')})},
  '@/lib/services/meter':meter,
  '@/lib/data/limits':{getPlanLimits:()=>({free:{label:'Free',priceInr:0}})},
  '@/lib/services/google-calendar-accounts':{
    getCalendarAccountAccess:async owner=>{calendarAccess.push(owner);return [];},
    mergeAccountEvents:()=>({events:[],hasMore:false}),
  },
  '@/lib/calendar-intervals':{calendarInterval:()=>null,calendarBlocksTime:()=>false},
});
async function assertOwnerReads(id, expectedOwner, expectedLabel) {
  let before = calls.length;
  const lists = await queries.getLists(id);
  assert.equal(lists.ok,true);
  assert.equal(lists.lists[0]?.name,expectedLabel+'_LIST');
  assert.deepEqual(calls.slice(before).map(x=>x.value),[expectedOwner]);
  before = calls.length;
  const friends = await queries.getFriendContacts(id);
  assert.equal(friends.ok,true);
  assert.equal(friends.contacts[0]?.name,expectedLabel+'_FRIEND');
  assert.deepEqual(calls.slice(before).map(x=>x.value),[expectedOwner]);
  before = calls.length;
  const profile = await queries.getProfile(id);
  assert.equal(profile.ok,true);
  assert.equal(profile.name,expectedLabel);
  assert.deepEqual(calls.slice(before).map(x=>x.value),[expectedOwner]);
  before = calls.length;
  const usage = await queries.getUsageSummary(id);
  assert.equal(usage.ok,true);
  assert.deepEqual(calls.slice(before).map(x=>x.value),[expectedOwner]);
  before = calls.length;
  const accessBefore = calendarAccess.length;
  const calendar = await queries.getTodayCalendar(id);
  assert.equal(calendar.ok,true);
  assert.equal(calendar.connected,false);
  assert.deepEqual(calls.slice(before).map(x=>x.value),[expectedOwner]);
  assert.deepEqual(calendarAccess.slice(accessBefore),[expectedOwner]);
}
async function run() {
  // Different signed BIGINT owners must never collapse to the same IEEE-754 number.
  await assertOwnerReads(B,B,'B_PRIVATE');
  await assertOwnerReads(A,A,'A_PRIVATE');
  // Ordinary IDs retain the old numeric DB predicate for compatibility.
  await assertOwnerReads('123',123,'SAFE_PRIVATE');
  // Negative 64-bit owners also remain exact (even when not in fixture DB).
  let at = calls.length;
  await queries.getLists(NEG);
  assert.deepEqual(calls.slice(at).map(c=>c.value),[NEG]);
  // No service-role query or provider token selection for malformed/overflow IDs.
  const invalid = ['123junk',' 123','123 ','+123','000123','123e2','1.5','0','',
    '9223372036854775808','-9223372036854775809','whatsapp:+15550000123'];
  for (const id of invalid) {
    const before = calls.length, beforeCalendar = calendarAccess.length;
    const lists = await queries.getLists(id);
    assert.equal(lists.ok,true,id);
    assert.equal(lists.lists.length,0,id);
    const friends = await queries.getFriendContacts(id);
    assert.equal(friends.ok,true,id);
    assert.equal(friends.contacts.length,0,id);
    assert.equal(friends.count,0,id);
    assert.equal((await queries.getProfile(id)).ok,false,id);
    assert.equal((await queries.getUsageSummary(id)).ok,false,id);
    const cal = await queries.getTodayCalendar(id);
    assert.equal(cal.connected,false,id);
    assert.equal(calls.length,before,'malformed identity leaked into DB: '+id);
    assert.equal(calendarAccess.length,beforeCalendar,'malformed identity reached Calendar: '+id);
  }
  console.log('PASS dashboard original-source exact-owner service-role queries: adjacent 64-bit owners, negative owner, safe owner, 12 malformed IDs, five read functions');
}
run().catch(err=>{console.error(err);process.exitCode=1;});
