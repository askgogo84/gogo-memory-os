# Per-PR test lists

Add new tests here instead of editing `scripts.test` in package.json: create `scripts/tests.d/<topic>-<date>.list`
with one command per line (`npx tsx scripts/verify-x.mts` or `node scripts/verify-y.cjs`). `npm test` runs the
package.json chain first, then every list here in file-name order, stopping at the first failure.
