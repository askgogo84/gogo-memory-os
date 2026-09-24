import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const watchers=readFileSync(new URL('../lib/agent/watchers.ts',import.meta.url),'utf8')
const commands=readFileSync(new URL('../lib/agent/watch-command.ts',import.meta.url),'utf8')
const pulse=readFileSync(new URL('../lib/agent/autonomy-pulse.ts',import.meta.url),'utf8')

assert.match(watchers,/dismissWatcherIdeas/)
assert.match(watchers,/watcher_state_no_longer_available/)
assert.match(watchers,/availability !== 'available'/)
assert.match(commands,/dismissIdeasForWatcherIds/)
assert.match(commands,/await dismissIdeasForWatcherIds\(tg,\[String\(recoveredWatcher\.id\)\]\)/)
assert.match(commands,/update\(\{status:'dismissed'\}\)/)
assert.match(pulse,/surfacableIdeaWatchers/)
assert.match(pulse,/fetchPulseIdeas/)
assert.match(pulse,/\.range\(from,from\+pageSize-1\)/)
assert.match(pulse,/watcherRefs\.length&&!watcherRefs\.some/)
assert.match(pulse,/row\.active===true \|\| state\.triggered===true/)

console.log('watcher stale-idea lifecycle contract passed')
