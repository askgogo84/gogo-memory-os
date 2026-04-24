const fs = require('fs')

const path = 'lib/bot/handlers/whatsapp-direct-premium.ts'
let file = fs.readFileSync(path, 'utf8')

file = file.replace(
`if (/^(hi|hello|hey|start|\\/start)$/i.test(lower)) {`,
`if (/^(hi|hello|hey|start|\\/start|hi askgogo|hello askgogo|hey askgogo|start askgogo|askgogo)$/i.test(lower)) {`
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ WhatsApp website CTA welcome phrases added')
