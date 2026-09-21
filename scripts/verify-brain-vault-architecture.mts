import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const arch=readFileSync('docs/architecture/BRAIN_VAULT_ARCHITECTURE_V1.md','utf8')
const contracts=readFileSync('docs/architecture/BRAIN_VAULT_CONTRACTS_V1.md','utf8')
const migration=readFileSync('docs/architecture/BRAIN_VAULT_MIGRATION_V1.md','utf8')
const matrix=readFileSync('docs/architecture/BRAIN_VAULT_E2E_MATRIX_V1.md','utf8')

for(const [name,src] of Object.entries({arch,contracts,migration,matrix})) assert.ok(src.length>1200,name+' must be substantive')

for(const required of ['Universal Event Ingress','World Model','Focus / Salience Engine','Mission Engine','Capability Registry','Vault','Secure Computer','Policy + Sentinel','Evidence Engine','Prospective Brain','Background Runtime','Cross-surface continuity','Failure model','Migration strategy','Release gates']) assert.match(arch,new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'))

assert.match(contracts,/Vault Contract/i)
assert.match(contracts,/Approval Contract/i)
assert.match(contracts,/Evidence Contract/i)
assert.match(contracts,/Idempotency Contract/i)
assert.match(contracts,/Human Handoff Contract/i)
assert.match(contracts,/ResolvedCredential/)
assert.match(contracts,/Brain-facing VaultMetadata/)

assert.match(migration,/Shadow Context Brain/i)
assert.match(migration,/Router Retirement/i)
assert.match(migration,/Rollback/i)
assert.match(migration,/Evidence Normalization/i)

for(let i=1;i<=63;i++){ const id='J'+String(i).padStart(2,'0'); assert.match(matrix,new RegExp('\\| '+id+' \\|')) }
assert.match(matrix,/no mutation before approval/i)
assert.match(matrix,/no secret plaintext/i)
assert.match(matrix,/no success claim without evidence/i)
assert.match(matrix,/no duplicate mutation on replay/i)
assert.match(matrix,/no cross-user state access/i)

console.log('Brain + Vault architecture verification passed')
