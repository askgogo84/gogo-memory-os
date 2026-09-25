const assert=require('node:assert/strict')
const fs=require('node:fs')
const {PGlite}=require('@electric-sql/pglite')
async function main(){
 const db=new PGlite()
 try{
  await db.exec('create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;')
  await db.exec(fs.readFileSync('supabase/gogo-cost-guard-v1.sql','utf8'))
  // Reproduce the observed production default grants in an isolated database.
  await db.exec('grant all on gogo_cost_budgets,gogo_cost_events to anon,authenticated,service_role;')
  await db.exec("insert into gogo_cost_events(telegram_id,category,estimated_cost_paise,metadata_json) values('owner-a','llm_haiku',100,'{\"private\":\"PRIVATE_FIXTURE\"}'),('owner-b','llm_haiku',900,'{}')")
  const before=(await db.query('select * from gogo_cost_budgets order by plan_code')).rows
  await db.exec('set role anon')
  assert.equal((await db.query('select count(*)::int as n from gogo_cost_events')).rows[0].n,2,'baseline exposes cross-owner cost rows')
  await db.exec('reset role')
  await db.exec(fs.readFileSync('supabase/migrations/20260925180847_cost_ledger_service_access.sql','utf8'))
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`)
   for(const sql of ['select * from gogo_cost_events','select * from gogo_cost_budgets',"update gogo_cost_budgets set monthly_budget_paise=999999", "insert into gogo_cost_events(telegram_id,category,estimated_cost_paise) values('owner-a','llm_haiku',0)","select gogo_monthly_cost_paise('owner-b','2000-01-01')"]){
    await assert.rejects(()=>db.query(sql),e=>e.code==='42501',`${role} must not read or alter another owner's cost decisions`)
   }
   await db.exec('reset role')
  }
  assert.deepEqual((await db.query('select * from gogo_cost_budgets order by plan_code')).rows,before,'no budget values changed')
  assert.ok((await db.query("select relrowsecurity from pg_class where relname in ('gogo_cost_events','gogo_cost_budgets')")).rows.every(r=>r.relrowsecurity))
  await db.exec('set role service_role')
  assert.equal((await db.query("select gogo_monthly_cost_paise('owner-a','2000-01-01') as cost")).rows[0].cost,100)
  await db.exec("insert into gogo_cost_events(telegram_id,category,estimated_cost_paise) values('owner-a','llm_haiku',50)")
  assert.equal((await db.query("select gogo_monthly_cost_paise('owner-a','2000-01-01') as cost")).rows[0].cost,150)
  assert.equal((await db.query('select count(*)::int as n from gogo_cost_budgets')).rows[0].n,before.length)
  console.log('Cost ledger access: reproduced public exposure; anon/auth reads, writes and arbitrary-owner RPC blocked; server reads/writes, exact-owner totals and unchanged budgets passed')
 }finally{await db.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
