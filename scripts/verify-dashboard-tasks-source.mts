import { readFileSync } from 'node:fs'

const data = readFileSync(new URL('../lib/dashboard/tasks.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/dashboard/(app)/tasks/page.tsx', import.meta.url), 'utf8')
const manager = readFileSync(new URL('../components/dashboard/task-manager.tsx', import.meta.url), 'utf8')
const route = readFileSync(new URL('../app/api/dashboard/tasks/route.ts', import.meta.url), 'utf8')

// Release gate: Tasks must remain a first-class in-dashboard to-do surface.
let failed = 0
function check(ok:boolean, label:string){
  if(ok) console.log(`✓ ${label}`)
  else { failed++; console.error(`✗ ${label}`) }
}

check(data.includes(".from('todos')"), 'Tasks dashboard reads the real todos table')
check(!data.includes(".from('reminders')"), 'Tasks dashboard does not duplicate reminders')
check(data.includes(".select('whatsapp_id')"), 'Tasks resolve the signed-in user to the shared WhatsApp identity')
check(page.includes('TaskManager') && page.includes('Open') && page.includes('Completed'), 'Tasks UI exposes Open and Completed boards')
check(!page.includes('title="Today"') && !page.includes('title="Upcoming"'), 'Tasks UI no longer presents reminder-style Today/Upcoming buckets')
check(manager.includes("'/api/dashboard/tasks'") && manager.includes("method:'POST'"), 'Tasks can be added directly inside the dashboard')
check(manager.includes("method:'PATCH'") && manager.includes('Mark task complete'), 'Tasks can be completed or restored directly inside the dashboard')
check(route.includes('verifySameOrigin(request)') && route.includes('getSession()'), 'Dashboard task mutations require same-origin authenticated session')
check(route.includes(".eq('whatsapp_id', whatsappId)"), 'Task updates stay scoped to the signed-in user')
check(!page.includes('Gogo, add task:'), 'Creating a task no longer requires leaving AskGogo for WhatsApp')

if(failed) process.exit(1)
console.log('✅ Dashboard Tasks source, mutation and presentation checks passed')
