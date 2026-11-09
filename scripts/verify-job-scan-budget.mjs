// Regression for the actual job-command entry point, with inert cost and search providers.
// No remote requests, real owner accounts, or financial side effects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const requireReal = createRequire(import.meta.url)
const ts = requireReal('typescript')

const source = readFileSync('lib/agent/jobs-command.ts', 'utf8')
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const owner = '9007199254740993' // exact 64-bit owner: never use Number(owner)
const price = 100

function fixture({ remainingPaise, allowanceThrows = false, fail = [] }) {
  const checks = [], searches = [], recorded = []
  const jobs = {
    parseJobPrefsCommand: () => null,
    isJobRadarRequest: () => false,
    isJobScanNow: text => text === 'scan for jobs now',
    savedJobPrefs: async () => ({ raw: 'Head of AI' }),
    jobRadarQuery: () => 'Head of AI jobs',
    JOB_BOARD_DOMAINS: ['linkedin.com', 'naukri.com'],
    formatJobScan: (items, query) => 'RESULTS:' + query + ':' + items.map(i => i.title).join(','),
    isJobApplicationsQuery: () => false,
    parsePrepareApplication: () => null,
  }
  const guard = {
    COST_ESTIMATES_PAISE: { web_search_basic: price },
    checkCostAllowance: async (id, estimate) => {
      checks.push({ id, estimate })
      if (allowanceThrows) throw new Error('cost state unavailable')
      return { allowed: estimate <= remainingPaise }
    },
    recordCostEvent: async entry => {
      recorded.push(entry)
      return { recorded: true, estimatedCostPaise: price }
    },
  }
  const search = {
    searchWebResults: async (query, options) => {
      searches.push({ query, options })
      if (fail.includes(query.endsWith(' apply') ? 'ats' : 'boards'))
        throw new Error('inert provider failure')
      return [{ title: query.endsWith(' apply') ? 'ATS' : 'BOARD' }]
    },
  }
  const module = { exports: {} }
  const mocks = { './jobs': jobs, '@/lib/services/cost-guard': guard, '@/lib/web-search': search }
  const context = {
    module,
    exports: module.exports,
    require: spec => {
      assert.ok(Object.hasOwn(mocks, spec), 'unexpected dependency: ' + spec)
      return mocks[spec]
    },
    console,
    setTimeout,
  }
  vm.runInNewContext(js, context, { filename: 'jobs-command.js', timeout: 4_000 })
  assert.equal(typeof module.exports.tryJobCommand, 'function')
  return {
    checks, searches, recorded,
    run: () => module.exports.tryJobCommand({ actor: { legacyTelegramId: owner }, surface: 'whatsapp', text: 'scan for jobs now' }),
  }
}

{
  const f = fixture({ remainingPaise: 150 })
  const reply = await f.run()
  assert.equal(f.checks.length, 1)
  assert.equal(f.checks[0].id, owner, 'exact owner preserved')
  assert.equal(f.checks[0].estimate, 2 * price, 'allowance must cover BOTH planned paid searches')
  assert.equal(f.searches.length, 0, 'single-search balance must not authorize TWO searches')
  assert.equal(f.recorded.length, 0, 'no cost event for a blocked action')
  assert.match(reply.text, /search allowance/i)
}

{
  const f = fixture({ remainingPaise: 2 * price })
  const reply = await f.run()
  assert.equal(f.checks.length, 1)
  assert.equal(f.checks[0].estimate, 2 * price, 'exactly-two-search budget')
  assert.equal(f.searches.length, 2, 'preserve job-board and ATS recall if budget permits')
  assert.equal(f.recorded.length, 2, 'each attempted paid search has its own ledger event')
  assert.deepEqual(f.recorded.map(r => r.metadata.source), ['job_scan', 'job_scan_ats'])
  assert.ok(f.recorded.every(r => r.telegramId === owner), 'do not coerce 64-bit owner')
  assert.match(reply.text, /RESULTS:Head of AI:ATS,BOARD/)
  assert.equal(f.searches[0].options.includeDomains.includes('linkedin.com'), true)
  assert.equal(f.searches[1].options.includeDomains.includes('greenhouse.io'), true)
}

{
  const f = fixture({ remainingPaise: 199, allowanceThrows: true })
  const reply = await f.run()
  assert.equal(f.checks.length, 1)
  assert.equal(f.searches.length, 0, 'unavailable budget must fail closed before provider calls')
  assert.equal(f.recorded.length, 0)
  assert.match(reply.text, /search allowance/i)
}

{
  const f = fixture({ remainingPaise: 200, fail: ['ats'] })
  const reply = await f.run()
  assert.equal(f.searches.length, 2, 'one failed search is never blindly retried')
  assert.equal(f.recorded.length, 2, 'account for both attempted calls including failed/unknown outcome')
  assert.match(reply.text, /RESULTS:Head of AI:BOARD/, 'surviving results remain usable')
}

{
  const f = fixture({ remainingPaise: 200, fail: ['ats', 'boards'] })
  const reply = await f.run()
  assert.equal(f.searches.length, 2, 'unknown provider outcome is never retried')
  assert.equal(f.recorded.length, 2, 'both attempted searches remain charged to the estimation ledger')
  assert.match(reply.text, /couldn't reach the job boards/i)
}
console.log('Job-scan two-search allowance: original handler and inert cost/search regressions passed')
