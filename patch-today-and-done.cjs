const fs = require('fs')

const path = 'lib/bot/detect-intent.ts'
let file = fs.readFileSync(path, 'utf8')

if (!file.includes("lower === 'today' ||")) {
  file = file.replace(
`  if (
    lower === 'morning briefing' ||`,
`  if (
    lower === 'today' ||
    lower === 'today summary' ||
    lower === 'today briefing' ||
    lower === 'what is today' ||
    lower === 'morning briefing' ||`
  )
}

if (!file.includes("lower === 'done' ||")) {
  file = file.replace(
`  if (
    /^snooze\\b/i.test(lower) ||`,
`  if (
    lower === 'done' ||
    lower === 'mark done' ||
    lower === 'completed' ||
    lower === 'complete' ||
    lower === 'finished' ||
    lower === 'mark as done' ||
    /^snooze\\b/i.test(lower) ||`
  )
}

fs.writeFileSync(path, file, 'utf8')
console.log('✅ detect-intent.ts patched for Today + done')
