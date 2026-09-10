import assert from 'node:assert/strict'
import {
  adaptiveWatcherCadence,
  initialWatcherCadence,
  isUrgentWatchRequest,
  watcherPlanLabel,
  watcherUpgradeMessage,
} from '../lib/agent/watch-cost-policy'
import type { CostBudget } from '../lib/services/cost-guard'

function budget(overrides: Partial<CostBudget>): CostBudget {
  return {
    planCode: 'free',
    monthlyBudgetPaise: 2500,
    warningPercent: 80,
    hardStopPercent: 100,
    activeWebWatchersMax: 0,
    baseWatcherCadenceMinutes: 1440,
    maxWatcherCadenceMinutes: 1440,
    burstWatcherCadenceMinutes: 1440,
    burstHours: 0,
    ...overrides,
  }
}

const essential = budget({
  planCode:'essential', monthlyBudgetPaise:12000, activeWebWatchersMax:1,
  baseWatcherCadenceMinutes:1440, maxWatcherCadenceMinutes:1440,
})
const plus = budget({
  planCode:'plus', monthlyBudgetPaise:24000, activeWebWatchersMax:3,
  baseWatcherCadenceMinutes:360, maxWatcherCadenceMinutes:1440,
  burstWatcherCadenceMinutes:60, burstHours:6,
})
const pro = budget({
  planCode:'pro', monthlyBudgetPaise:48000, activeWebWatchersMax:6,
  baseWatcherCadenceMinutes:180, maxWatcherCadenceMinutes:720,
  burstWatcherCadenceMinutes:15, burstHours:24,
})
const founder = budget({
  planCode:'founder_pro', monthlyBudgetPaise:500000, activeWebWatchersMax:20,
  baseWatcherCadenceMinutes:15, maxWatcherCadenceMinutes:180,
  burstWatcherCadenceMinutes:15, burstHours:48,
})

assert.equal(watcherPlanLabel('lite'), 'Gogo Essential')
assert.equal(watcherPlanLabel('starter'), 'Gogo Plus')
assert.equal(watcherPlanLabel('pro_annual'), 'Gogo Pro')
assert.match(watcherUpgradeMessage('free'), /₹249\/month/)

assert.equal(initialWatcherCadence({budget:essential,activeWatcherCount:1}),1440)
assert.equal(initialWatcherCadence({budget:plus,activeWatcherCount:1}),360)
assert.equal(initialWatcherCadence({budget:plus,activeWatcherCount:3}),1080)
assert.equal(initialWatcherCadence({budget:pro,activeWatcherCount:6}),720)
assert.equal(initialWatcherCadence({budget:founder,activeWatcherCount:1}),15)

assert.equal(adaptiveWatcherCadence({budget:plus,activeWatcherCount:1,quietChecks:0}),360)
assert.equal(adaptiveWatcherCadence({budget:plus,activeWatcherCount:1,quietChecks:2}),720)
assert.equal(adaptiveWatcherCadence({budget:plus,activeWatcherCount:1,quietChecks:4}),1440)
assert.equal(adaptiveWatcherCadence({budget:plus,activeWatcherCount:1,quietChecks:0,usageRatio:.85}),720)
assert.equal(adaptiveWatcherCadence({budget:plus,activeWatcherCount:1,quietChecks:0,usageRatio:.96}),1440)

const now = new Date('2026-09-10T16:00:00Z')
assert.equal(adaptiveWatcherCadence({
  budget:pro,activeWatcherCount:1,quietChecks:0,material:true,usageRatio:.1,
  burstUntil:'2026-09-11T16:00:00Z',now,
}),15)
assert.equal(adaptiveWatcherCadence({
  budget:pro,activeWatcherCount:1,quietChecks:0,material:false,usageRatio:.1,
  burstUntil:'2026-09-10T15:00:00Z',now,
}),180)

assert.equal(isUrgentWatchRequest('Watch this every 15 minutes'),true)
assert.equal(isUrgentWatchRequest('Keep a close eye on this'),true)
assert.equal(isUrgentWatchRequest('Watch this price and tell me if it changes'),false)

console.log('✅ Gogo Cost Guard + adaptive watcher policy checks passed')
