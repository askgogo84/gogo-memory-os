import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const assets = join(root, 'assets')

const splashPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAADjElEQVR42u2dQXbcMAxDR3zZtYdoztks23O2h2jW7Qn6xmPLEkB8rBOPRIAgJdvy4wEAAAAAAAAAAIAUjIRJ/vn+7e/Z//368/dAACFkJ4piQHi2IAakZ4thQHy2EAakZ4thQHy2EArys+c1CFC2GwyIzxZCQX72/Avys0UwID67JBTkZ7tBQX62CArys0VQkJ8tgoL8bBEU5GeLoCA/WwQF+dkiKMjPFsFbUvC+/Ph1+G8/P94jYjI6Z/8rhLsJYtaW8ehG/kzS1cUwQwSjC/kriFcUwlURSD4S5kD+zt+V6gF2Zr8SATvd4IoLFFmf7QbDLfsdAr3DDc66QEF+j3Ge5cOmBLhZrMt4yyH7Xevr6nGf4aUIYvb4o+4FHG3QOqzvb1sFrLT/WURc6coVxnDnikC2BMwI/OfH++XAz7iGsqsMxey/Gqw7s015bGdcoMW9gJUB7vacgJwArmTYKnIUeorlAlB/1Gt1Zqo7wVG+qkP27yLj7O8quYB9D7A7E917gnLPfleozPeQAFTrv0r2qbrAEd7qAaIhIYAzdqiWdWfGo1AGcAAcgM4/eUXwVAC86+eNZ/y9EaK99fp/113lJtU1sKBpD5Dy1i4CAAgAIACAAAACAAgAIACAAEC8ANg5bCYAdvb2gptBk4X6qkPtToCnDtDpU+mJeMafZROo2gc49iesAmgCfeqrcra5PtiKA+AA1xuJ9JqrWvuP8CbjAGn7ASrztS8Bu7PPfWeyOmSF22nhSm53WADqG0KrRaCe+bZnBDkcv+JwjE3sMvBuEXS7Gyl7UOSscwK7jmdWuZZ1gFmHM14lbsY1lJe5pxo7x+NiXyFix2/uyP7HI/B5AJ4oMmsC3XcI1cd/SgCr9wRcRbB63Gd4KYKZPd5aqbaUoDp9Ncz2w5GKzdwugUZ+OLLDMXG2+wAqLqDgBruJ5+PRD7/Twts5gIILrHQDFeJnNOJTO3m1MwVnikEt22etwqYv5ZQPlnxFEMr2PnMJHnUvgBdRFzSBvEvok/23rQIQgQf5ty4DEYFHPMtx0JBvIgBEoB+/6jAJyBcXACLQjVd1nBTkiwoAEejFZysZfI9of2JU4qQhX0QAiGD//KWCn1QSVIQvmX2dhaDmeEWQsuclH+gObqAsaKtMcxKDi4tZWq2yENzKl32tVRCDc8/SrtlaIYhOTWrEJswVUbBbCQAAAAAAAACgEf4BPJDY3W/ha8YAAAAASUVORK5CYII='

await mkdir(assets, { recursive: true })
await writeFile(join(assets, 'splash-icon.png'), Buffer.from(splashPngBase64, 'base64'))
console.log('Generated AskGogo native splash asset')
