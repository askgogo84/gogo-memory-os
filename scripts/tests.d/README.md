# Per-PR test lists

Add new tests here: create `scripts/tests.d/<topic>-<date>.list` with one command per line
(`npx tsx scripts/verify-x.mts` or `node scripts/verify-y.cjs`). `npm test` is `node scripts/run-test-list.mjs`: it
runs every list here in file-name order, stopping at the first failure. `000-core.list` is the former package.json
chain. CI runs the same lists in parallel (`scripts/run-tests-parallel.mjs`).
