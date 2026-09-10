import { readFileSync } from 'node:fs'

const data = readFileSync(new URL('../lib/dashboard/tasks.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/dashboard/(app)/tasks/page.tsx', import.meta.url), 'utf8')

let failed = 0
function check(ok:boolean, label:string){
  if(ok) console.log(`✓ ${label}`)
  else { failed++; console.error(`✗ ${label}`) }
}

check(data.includes(".from('todos')"), 'Tasks dashboard reads the real todos table')
check(!data.includes(".from('reminders')"), 'Tasks dashboard does not duplicate reminders')
check(data.includes(".select('whatsapp_id')"), 'Tasks resolve the signed-in user to the shared WhatsApp identity')
check(page.includes('Open') && page.includes('Completed'), 'Tasks UI exposes Open and Completed boards')
check(!page.includes('title="Today"') && !page.includes('title="Upcoming"'), 'Tasks UI no longer presents reminder-style Today/Upcoming buckets')
check(page.includes('Gogo, add task:'), 'New task action uses the task command, not a reminder command')

if(failed) process.exit(1)
console.log('✅ Dashboard Tasks source and presentation checks passed')
