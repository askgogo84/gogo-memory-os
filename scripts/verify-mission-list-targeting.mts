import assert from 'node:assert/strict'

function normalizeListName(name: string) {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

function explicitRequestedListName(instruction: string) {
  const quoted = instruction.match(/(?:list\s+)?(?:titled|called)\s+['“\"]([^'”\"]+)['”\"]/i)?.[1]
  if (quoted) return quoted.trim()
  const bare = instruction.match(/(?:list\s+)?(?:titled|called)\s+([^,.;]+?)(?=\s+with\b|\s+containing\b|\s+including\b|[.;,]|$)/i)?.[1]
  return bare?.trim() || null
}

const instruction = "Create a new list called 'Persistent Runtime Test' with the following items: Passport, Charger, Power Bank"
assert.equal(explicitRequestedListName(instruction), 'Persistent Runtime Test')
assert.equal(normalizeListName(explicitRequestedListName(instruction)!), 'persistent runtime test')
assert.notEqual(normalizeListName(explicitRequestedListName(instruction)!), 'mumbai work trip packing (15–17 sept 2026)')

console.log('✅ mission list targeting checks passed')
